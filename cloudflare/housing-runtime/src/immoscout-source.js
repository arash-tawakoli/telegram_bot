import { queueMatches } from "./matching.js";

const MCP_URL = "https://app.chatgpt.immobilienscout24.de/v2/mcp";
const MCP_PROTOCOL = "2025-06-18";

async function postMcp(payload) {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": MCP_PROTOCOL, "user-agent": "TraumWohnungHamburg/1.0" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`immoscout_mcp_http_${response.status}`);
  const trimmed = text.trim().replace(/^\uFEFF/, "");
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  for (const line of text.split(/\r?\n/)) if (line.startsWith("data:")) {
    try { return JSON.parse(line.slice(5).trim()); } catch { /* continue to the next SSE frame */ }
  }
  throw new Error(`immoscout_mcp_response_invalid:${response.headers.get("content-type") || "unknown"}:${trimmed.slice(0, 80).replace(/[\u0000-\u001f\u007f]/g, " ")}`);
}

function entryId(entry) {
  return String(entry?.exposedId || entry?.exposeId || entry?.id || "").trim();
}

function numeric(value) {
  if (value == null || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function germanCoordinates(entry) {
  const position = entry?.address?.coordinates;
  const latitude = numeric(position?.lat);
  const longitude = numeric(position?.lng);
  // The Germany tools are the only supported MCP tools. Ignore invalid/out-of-country pins.
  if (latitude == null || longitude == null
    || latitude < 47.2 || latitude > 55.2 || longitude < 5.8 || longitude > 15.1) return {};
  return { latitude, longitude };
}

export function germanImmoScoutQuery(source, filter = "") {
  if (![1, 69].includes(Number(source?.id)) || source?.family !== "immoscout24") {
    throw new Error("immoscout_source_not_allowlisted");
  }
  const criteria = String(filter ?? "").trim();
  if (criteria.length > 180 || /[\u0000-\u001f]/.test(criteria)
    || /\b(österreich|austria|vienna|wien|graz|salzburg|innsbruck|linz)\b/i.test(criteria)) {
    throw new Error("immoscout_query_invalid");
  }
  const region = Number(source.id) === 69 ? "Schleswig-Holstein" : "Hamburg";
  return `Wohnungen zur Miete in ${region}, Deutschland; ${criteria || "neueste Inserate"}`;
}

export function parseMcpToolResult(payload) {
  if (payload?.error) throw new Error(payload.error.message || "immoscout_mcp_error");
  if (payload?.result?.isError) throw new Error(payload.result.content?.map((item) => item?.text).filter(Boolean).join(" | ") || "immoscout_mcp_error");
  const content = payload?.result?.structuredContent || payload?.result?.structured_content || {};
  if (!Array.isArray(content.entries)) throw new Error("immoscout_inventory_unrecognized");
  const total = content.total == null || content.total === "" || !Number.isFinite(Number(content.total)) ? null : Number(content.total);
  if (!content.entries.length && total !== 0) throw new Error("immoscout_inventory_unrecognized");
  return { entries: content.entries, total };
}

async function callTool(name, query) {
  return parseMcpToolResult(await postMcp({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name, arguments: { query } } }));
}

function queryFor(source, config = {}) {
  if (config.query) return String(config.query).slice(0, 500);
  return /schleswig/i.test(String(source.name || ""))
    ? "Wohnungen zur Miete in Schleswig-Holstein, neueste Inserate"
    : "Wohnungen zur Miete in Hamburg, neueste Inserate";
}

export function normalizeImmoScoutEntry(entry, sourceId) {
  const id = entryId(entry);
  const url = String(entry?.exposeUrl || "");
  if (!id || !/^https:\/\/www\.immobilienscout24\.de\/expose\//i.test(url)) return null;
  const address = entry.address || {};
  return {
    source_id: sourceId,
    identity: id,
    canonical_url: url.split("#")[0],
    facts: {
      title: String(entry.title || `ImmobilienScout24 ${id}`).slice(0, 240),
      city: String(address.city || entry.city || "").slice(0, 120),
      district: String(address.quarter || entry.district || "").slice(0, 120),
      postal_code: String(address.postcode || "").slice(0, 16),
      address: [address.street, address.houseNumber].filter(Boolean).join(" ").slice(0, 240),
      warm_rent: numeric(entry.totalRent),
      cold_rent: numeric(entry.price?.value),
      additional_costs: numeric(entry.serviceCharge),
      heating_costs: numeric(entry.heatingCosts),
      rooms: numeric(entry.rooms),
      area_sqm: numeric(entry.size),
      image_url: typeof entry.titlePictureUrls?.[0]?.href === "string" ? entry.titlePictureUrls[0].href.replace(/%WIDTH%/g, "1200").replace(/%HEIGHT%/g, "800") : null,
      provider: "immoscout24",
      ...germanCoordinates(entry),
    },
  };
}

export async function fetchImmoScoutSource(source, config = {}) {
  const query = queryFor(source, config);
  const result = await callTool("property_search_de", query);
  const nodes = [];
  const seen = new Set();
  for (const entry of result.entries) {
    const normalized = normalizeImmoScoutEntry(entry, source.id);
    if (!normalized) continue;
    if (seen.has(normalized.identity)) continue;
    seen.add(normalized.identity);
    nodes.push(normalized);
  }
  return { nodes, fetched: result.total ?? nodes.length, reported_total: result.total, query };
}

/**
 * On-demand geographic results from the German property_map_de tool.
 * Does not enqueue deliveries, applications or mutate the housing database.
 */
export async function fetchImmoScoutMap(source, config = {}) {
  if (![1, 69].includes(Number(source?.id)) || source?.family !== "immoscout24") {
    throw new Error("immoscout_source_not_allowlisted");
  }
  const limit = Number(config.limit ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("immoscout_limit_invalid");
  const query = queryFor(source, config);
  const result = await callTool("property_map_de", query);
  const points = [];
  const seen = new Set();
  for (const entry of result.entries) {
    const normalized = normalizeImmoScoutEntry(entry, Number(source.id));
    if (!normalized || seen.has(normalized.identity)
      || !Number.isFinite(normalized.facts.latitude)
      || !Number.isFinite(normalized.facts.longitude)) continue;
    seen.add(normalized.identity);
    points.push({
      id: normalized.identity,
      url: normalized.canonical_url,
      ...normalized.facts,
    });
    if (points.length >= limit) break;
  }
  return {
    sourceId: Number(source.id), tool: "property_map_de", query,
    total: result.total ?? result.entries.length, count: points.length, points,
  };
}

export async function ingestImmoScoutSource(sql, source, config = {}) {
  const result = await fetchImmoScoutSource(source, config);
  let inserted = 0;
  for (const node of result.nodes) {
    const rows = await sql`
      INSERT INTO housing.offer_identities (id, source_id, identity_hash, external_id, canonical_url, facts, last_seen_at, expires_at)
      VALUES (gen_random_uuid(), ${node.source_id}, ${node.source_id + ":external:" + node.identity}, ${node.identity}, ${node.canonical_url}, ${JSON.stringify(node.facts)}::jsonb, now(), now() + interval '24 hours')
      ON CONFLICT (identity_hash) DO UPDATE SET canonical_url = EXCLUDED.canonical_url, facts = EXCLUDED.facts, last_seen_at = now(), expires_at = EXCLUDED.expires_at
      RETURNING id
    `;
    if (rows.length) {
      inserted++;
      await queueMatches(sql, rows[0].id, node.source_id, node.source_id + ":external:" + node.identity, { ...node.facts, canonical_url: node.canonical_url });
    }
  }
  return { fetched: result.fetched, valid: result.nodes.length, inserted, query: result.query };
}
