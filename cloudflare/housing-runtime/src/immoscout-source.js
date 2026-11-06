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
  if (text.trim().startsWith("{")) return JSON.parse(text);
  for (const line of text.split(/\r?\n/)) if (line.startsWith("data:")) {
    try { return JSON.parse(line.slice(5).trim()); } catch { /* continue to the next SSE frame */ }
  }
  throw new Error("immoscout_mcp_response_invalid");
}

function entryId(entry) {
  return String(entry?.exposedId || entry?.exposeId || entry?.id || "").trim();
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function parseMcpToolResult(payload) {
  if (payload?.error) throw new Error(payload.error.message || "immoscout_mcp_error");
  if (payload?.result?.isError) throw new Error(payload.result.content?.map((item) => item?.text).filter(Boolean).join(" | ") || "immoscout_mcp_error");
  const content = payload?.result?.structuredContent || payload?.result?.structured_content || {};
  return { entries: Array.isArray(content.entries) ? content.entries : [], total: Number.isFinite(Number(content.total)) ? Number(content.total) : null };
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
    },
  };
}

export async function fetchImmoScoutSource(source, config = {}) {
  await postMcp({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "initialize", params: { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: "traumwohnung-housing-runtime", version: "1.0.0" } } });
  await postMcp({ jsonrpc: "2.0", method: "notifications/initialized" });
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
  return { nodes, fetched: result.total ?? nodes.length, query };
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
