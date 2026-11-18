// Kleinanzeigen Hamburg through Kleinanzeigen's public MCP search
// (the server behind their ChatGPT app). Read-only and anonymous: one
// stateless tools/call per category, newest listings first.
import { queueMatches } from "./matching.js";

const MCP_URL = "https://gateway.kleinanzeigen.de/openai-app/mcp";
// The server maps free text to a category; each answer is checked against it.
export const KLEINANZEIGEN_QUERIES = Object.freeze([
  { criteria: "Wohnung mieten in Hamburg", categoryId: 203, property_type: "Wohnung" },
  { criteria: "Haus mieten in Hamburg", categoryId: 205, property_type: "Haus" },
  { criteria: "Auf Zeit & WG in Hamburg", categoryId: 199, property_type: "WG" },
]);

const OFFER_SEEKS_TENANT = /\b(?:nach|unter|zwischen)?mieter(?:in|innen)?\b|\bmitbewohner(?:in|innen)?\b|\bwg-?(?:mitglied|zuwachs)\b/;

// Kleinanzeigen mixes "Gesuche" (people looking for a flat) into the results.
export function isWantedAd(title, snippet = "") {
  const head = String(title || "").toLowerCase();
  const body = String(snippet || "").toLowerCase().slice(0, 300);
  if (/\b(?:such\w*|gesucht|wohnungssuche|belohnung)\b/.test(head)) return !OFFER_SEEKS_TENANT.test(head);
  return /\b(?:ich|wir)\s+(?:\S+\s+){0,6}?(?:suche|suchen|auf der suche)\b/.test(body) && !OFFER_SEEKS_TENANT.test(body);
}

function decimal(text, pattern) {
  const value = String(text || "").match(pattern)?.[1];
  const result = value == null ? NaN : Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(result) && result > 0 ? result : null;
}

function decode(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

// The markdown answer carries a description snippet per ad; the structured part does not.
export function snippetsById(markdown) {
  const out = new Map();
  for (const block of String(markdown || "").split(/\n(?=\d+\.\s+\*\*)/)) {
    const id = block.match(/\/s-anzeige\/[^\s/]+\/(\d+)/)?.[1];
    if (!id) continue;
    const lines = block.split("\n").map((line) => line.trim());
    const start = lines.findIndex((line) => /^Price:/i.test(line)) + 1;
    const end = lines.findIndex((line, index) => index >= start && /^(?:!\[|→)/.test(line));
    out.set(id, lines.slice(start || 1, end < 0 ? undefined : end).join(" ").slice(0, 1200));
  }
  return out;
}

export function normalizeKleinanzeigenListing(entry, sourceId, query, snippet = "") {
  const id = String(entry?.id ?? "");
  if (!/^\d{5,15}$/.test(id)) return { skip: "invalid_id" };
  const title = decode(entry.title).slice(0, 240);
  if (!title) return { skip: "no_title" };
  if (isWantedAd(title, snippet)) return { skip: "wanted_ad" };
  let url;
  try { url = new URL(String(entry.url || "")); } catch { return { skip: "invalid_url" }; }
  if (url.protocol !== "https:" || url.hostname !== "www.kleinanzeigen.de" || !url.pathname.startsWith("/s-anzeige/")) return { skip: "invalid_url" };
  const canonical = `https://www.kleinanzeigen.de${url.pathname.replace(/\/$/, "")}`;
  const location = decode(entry.location).replace(/\s+/g, " ");
  // Every query is pinned to Kleinanzeigen's Hamburg location (9409).
  const district = location.replace(/^hamburg\b\s*/i, "") || null;
  let image = null;
  try {
    const parsed = new URL(String(entry.image || ""));
    if (parsed.protocol === "https:" && parsed.hostname === "img.kleinanzeigen.de") image = parsed.href;
  } catch { /* no photo */ }
  const price = Number(entry.priceEuros);
  return {
    source_id: sourceId,
    identity: id,
    canonical_url: canonical,
    facts: {
      title,
      city: "Hamburg",
      state_code: "HH",
      district,
      search_text: [title, location, snippet].filter(Boolean).join(" ").slice(0, 2000),
      // Kleinanzeigen's rental price is the basic rent; warm rent is unknown here.
      cold_rent: Number.isFinite(price) && price > 1 ? price : null,
      warm_rent: null,
      rooms: decimal(entry.details, /([\d.,]+)\s*Zimmer/i),
      area_sqm: decimal(entry.details, /([\d.,]+)\s*m²/i),
      latitude: Number.isFinite(Number(entry.lat)) ? Number(entry.lat) : null,
      longitude: Number.isFinite(Number(entry.lon)) ? Number(entry.lon) : null,
      property_type: query.property_type,
      image_url: image,
      provider: "kleinanzeigen",
    },
  };
}

export async function searchKleinanzeigen(query, fetchImpl = fetch) {
  const response = await fetchImpl(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      "user-agent": "TraumWohnungHamburg/1.0",
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call",
      params: { name: "SEARCH_ONE_STEP", arguments: { searchCriteria: query.criteria, limit: 25 } },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`kleinanzeigen_http_${response.status}`);
  const text = await response.text();
  // Streamable HTTP answers either as JSON or as one SSE "data:" event.
  const raw = text.trimStart().startsWith("{") ? text : text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5)).join("");
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error("kleinanzeigen_response_invalid"); }
  const result = payload?.result;
  const data = result?.structuredContent;
  if (payload?.error || result?.isError || !data || !Array.isArray(data.listings)) throw new Error("kleinanzeigen_response_invalid");
  if (Number(data.categoryId) !== query.categoryId) throw new Error("kleinanzeigen_category_mismatch");
  return { listings: data.listings, total: Number(data.totalResults) || 0, searchUrl: String(data.searchUrlList || ""), markdown: result.content?.find?.((part) => part?.type === "text")?.text || "" };
}

export async function fetchKleinanzeigenSource(source, fetchImpl = fetch) {
  const answers = await Promise.all(KLEINANZEIGEN_QUERIES.map((query) => searchKleinanzeigen(query, fetchImpl)));
  const nodes = new Map();
  // One outcome per listing the MCP returned, so every ad is accounted for.
  const outcomes = [];
  answers.forEach((answer, index) => {
    const query = KLEINANZEIGEN_QUERIES[index];
    const snippets = snippetsById(answer.markdown);
    for (const entry of answer.listings) {
      const node = normalizeKleinanzeigenListing(entry, source.id, query, snippets.get(String(entry?.id)) || "");
      const duplicate = !node.skip && nodes.has(node.identity);
      if (!node.skip && !duplicate) nodes.set(node.identity, node);
      outcomes.push({ id: String(entry?.id ?? ""), categoryId: query.categoryId, outcome: node.skip || (duplicate ? "duplicate" : "stored") });
    }
  });
  const skipped = outcomes.filter((o) => o.outcome !== "stored").length;
  return { nodes: [...nodes.values()], fetched: outcomes.length, skipped, outcomes, answers };
}

export async function ingestKleinanzeigenSource(sql, source, config = {}, fetchImpl = fetch) {
  const result = await fetchKleinanzeigenSource(source, fetchImpl);
  let inserted = 0, known = 0;
  const profileCache = {}; // one profile lookup per run, not per ad
  for (const node of result.nodes) {
    const identityHash = `${node.source_id}:external:${node.identity}`;
    const rows = await sql`
      INSERT INTO housing.offer_identities (id, source_id, identity_hash, external_id, canonical_url, facts, last_seen_at, expires_at)
      VALUES (gen_random_uuid(), ${node.source_id}, ${identityHash}, ${node.identity}, ${node.canonical_url}, ${JSON.stringify(node.facts)}::jsonb, now(), now() + interval '24 hours')
      ON CONFLICT (identity_hash) DO UPDATE SET facts = EXCLUDED.facts, last_seen_at = now(), expires_at = EXCLUDED.expires_at
      RETURNING id, (first_seen_at < last_seen_at) AS known
    `;
    if (!rows.length) continue;
    inserted++;
    if (Number(rows[0].known) === 1 || rows[0].known === true) known++;
    if (config.queue_matches !== false) await queueMatches(sql, rows[0].id, node.source_id, identityHash, { ...node.facts, canonical_url: node.canonical_url }, source.central_auto_apply_enabled === true, true, profileCache);
  }
  const skippedBy = {};
  for (const { outcome } of result.outcomes) if (outcome !== "stored") skippedBy[outcome] = (skippedBy[outcome] || 0) + 1;
  return { fetched: result.fetched, valid: result.nodes.length, inserted, skipped: skippedBy, previously_known_in_response: known };
}
