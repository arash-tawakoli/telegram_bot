import { queueMatches } from "./matching.js";

const MCP_URL = "https://app.chatgpt.immobilienscout24.de/v2/mcp";
const MCP_PROTOCOL = "2025-06-18";

// Select a complete JSON-RPC response, skipping SSE progress notifications.
export function parseMcpEnvelope(body, requestId) {
  const text = String(body || "").trim().replace(/^\uFEFF/, "");
  const messages = [];
  if (text.startsWith("{")) {
    messages.push(JSON.parse(text));
  } else {
    let data = [];
    const flush = () => {
      if (!data.length) return;
      const raw = data.join("\n").trim();
      data = [];
      if (!raw || raw === "[DONE]") return;
      try { messages.push(JSON.parse(raw)); }
      catch { throw new Error("immoscout_mcp_sse_invalid"); }
    };
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) { flush(); continue; }
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    flush();
  }
  const response = messages.find(item => item && item.id === requestId && (item.result || item.error))
    || messages.find(item => item && (item.result || item.error) && item.id == null);
  if (!response) throw new Error("immoscout_mcp_response_invalid");
  return response;
}

// All German Scout tools share one initialized MCP transport per Worker isolate.
// The current live server is stateless (no Mcp-Session-Id); if a session ID is
// introduced, send it on subsequent requests and recover once from expiry.
let mcpSessionPromise = null;

export function resetMcpSession() {
  mcpSessionPromise = null;
}

async function sendMcp(payload, session = null) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": session?.protocolVersion || MCP_PROTOCOL,
    "user-agent": "TraumWohnungHamburg/1.0",
  };
  if (session?.id) headers["mcp-session-id"] = session.id;
  const response = await fetch(MCP_URL, {
    method: "POST", headers, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const error = new Error("immoscout_mcp_http_" + response.status);
    error.httpStatus = response.status;
    throw error;
  }
  return response;
}

async function initializeMcp() {
  const id = crypto.randomUUID();
  const response = await sendMcp({
    jsonrpc: "2.0", id, method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL, capabilities: {},
      clientInfo: { name: "traumwohnung-housing-runtime", version: "1.0.0" },
    },
  });
  const envelope = parseMcpEnvelope(await response.text(), id);
  if (envelope.error) throw new Error("immoscout_mcp_initialize_failed");
  const protocolVersion = envelope.result?.protocolVersion;
  if (protocolVersion !== MCP_PROTOCOL) throw new Error("immoscout_mcp_protocol_unsupported");
  const session = { protocolVersion, id: response.headers.get("mcp-session-id") || null };
  // MCP notifications can return HTTP 202 with an empty body.
  await sendMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, session);
  return session;
}

async function establishedSession() {
  if (!mcpSessionPromise) {
    const pending = initializeMcp();
    mcpSessionPromise = pending.catch(error => {
      if (mcpSessionPromise === wrapped) mcpSessionPromise = null;
      throw error;
    });
    const wrapped = mcpSessionPromise;
  }
  return mcpSessionPromise;
}

async function postMcp(payload) {
  const session = await establishedSession();
  const sessionPromise = mcpSessionPromise;
  const perform = async (current) => {
    const response = await sendMcp(payload, current);
    return parseMcpEnvelope(await response.text(), payload.id);
  };
  try {
    return await perform(session);
  } catch (error) {
    if (error.httpStatus !== 404 || !session.id) throw error;
    // 404 denotes an expired stateful MCP session. Retry only this read-only
    // tool call, never reusing the retired session identifier.
    if (mcpSessionPromise === sessionPromise) resetMcpSession();
    return perform(await establishedSession());
  }
}

function entryId(entry) {
  return String(entry?.exposedId || entry?.exposeId || entry?.id || "").trim();
}

function numeric(value) {
  if (value == null || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function germanCoordinates(entry, sourceId) {
  const position = entry?.address?.coordinates;
  const latitude = numeric(position?.lat);
  const longitude = numeric(position?.lng);
  const country = String(entry?.address?.countryCode || entry?.address?.country || "").trim().toLowerCase();
  // A broad source-region envelope rejects foreign and unrelated German results.
  // The original MCP search remains the authority for administrative boundaries.
  const bounds = Number(sourceId) === 1
    ? { minLat: 53.35, maxLat: 53.82, minLng: 9.65, maxLng: 10.45 }
    : Number(sourceId) === 69
      ? { minLat: 53.3, maxLat: 55.14, minLng: 7.4, maxLng: 11.4 }
      : null;
  if (!bounds || latitude == null || longitude == null
    || (country && !["de", "deu", "deutschland", "germany"].includes(country))
    || latitude < bounds.minLat || latitude > bounds.maxLat
    || longitude < bounds.minLng || longitude > bounds.maxLng) return {};
  return { latitude, longitude };
}

export function germanImmoScoutQuery(source, filter = "") {
  if (![1, 69].includes(Number(source?.id)) || source?.family !== "immoscout24") {
    throw new Error("immoscout_source_not_allowlisted");
  }
  const criteria = String(filter ?? "").trim();
  if (criteria.length > 180 || /[\u0000-\u001f]/.test(criteria)
    || /(?:^|[\s,;])(?:österreich|oesterreich|austria|vienna|wien|graz|salzburg|innsbruck|linz)(?=$|[\s,;])/i.test(criteria)) {
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

const RENTAL_TYPES = Object.freeze({
  Wohnung: "Wohnungen zur Miete",
  Haus: "Häuser zur Miete",
  WG: "WG-Zimmer zur Miete",
  Tauschwohnung: "Tauschwohnungen",
});

function parseJson(value) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}
function list(value) { return Array.isArray(value) ? value : []; }
function scoutRegion(source) {
  if (source?.family !== "immoscout24" || ![1, 69].includes(Number(source?.id)))
    throw new Error("immoscout_source_not_allowlisted");
  return Number(source.id) === 1 ? "Hamburg" : "Schleswig-Holstein";
}
function safePlace(value) {
  const text = String(value ?? "").trim();
  return text.length <= 100 && /^[A-Za-zÀ-ÿ0-9 .()/-]+$/.test(text) ? text : "";
}
function queryText(type, place) {
  return (RENTAL_TYPES[type] || RENTAL_TYPES.Wohnung) +
    (place.startsWith("Kreis ") ? " im " : " in ") + place;
}

// The same planner handles both states; only the area selections differ.
export function planImmoScoutQueries(source, rawProfiles = [], areas = []) {
  const region = scoutRegion(source);
  const all = new Set();
  const add = (type, place) => {
    if (RENTAL_TYPES[type] && place) all.add(queryText(type, place));
  };
  add("Wohnung", region);
  const byCode = new Map(list(areas).map(area => [String(area.area_code), area]));
  for (const value of rawProfiles) {
    const profile = parseJson(value?.criteria ?? value);
    const type = list(profile.property_types)[0] || profile.property_type;
    const mode = String(profile.location_mode || "");
    if (!RENTAL_TYPES[type]) continue;
    if (region === "Hamburg") {
      if (mode === "all_hamburg") add(type, region);
      if (mode === "boroughs" || mode === "neighborhoods") {
        const selected = mode === "neighborhoods"
          ? list(profile.neighborhoods).length ? profile.neighborhoods : profile.districts
          : profile.boroughs;
        for (const name of list(selected)) {
          const place = safePlace(name);
          if (place) add(type, place.startsWith("Hamburg") ? place : "Hamburg-" + place);
        }
      }
    } else {
      if (mode === "all_schleswig_holstein") add(type, region);
      if (mode === "schleswig_holstein_areas") {
        for (const code of list(profile.location_area_codes)) {
          const area = byCode.get(String(code));
          const name = safePlace(area?.name);
          if (!name) continue;
          add(type, area.area_type === "county" ? "Kreis " + name : name);
        }
      }
    }
  }
  return [...all];
}

// Keep broad coverage on every second run while rotating targeted locations.
// Without this, many active districts could starve the broad discovery query.
export function chooseImmoScoutQuery(queries, now = Date.now()) {
  if (!Array.isArray(queries) || !queries.length) throw new Error("immoscout_query_plan_empty");
  if (queries.length === 1) return queries[0];
  const slot = Math.floor(now / (10 * 60_000));
  return slot % 2 === 0 ? queries[0] : queries[1 + (Math.floor(slot / 2) % (queries.length - 1))];
}

let cachedAreas = null;
async function scheduledQuery(sql, source, now = Date.now()) {
  const profiles = await sql.unsafe(
    "SELECT sp.criteria FROM housing.search_profiles sp JOIN housing.source_links sl ON sl.search_profile_id=sp.id WHERE sl.source_id=$1 AND sp.active=true ORDER BY sp.id",
    [source.id],
  );
  let areas = [];
  if (Number(source.id) === 69 && profiles.some(row => parseJson(row.criteria).location_mode === "schleswig_holstein_areas")) {
    if (!cachedAreas || cachedAreas.expires < Date.now()) {
      const rows = await sql.unsafe("SELECT payload FROM housing.coach_geo_snapshot WHERE id=$1", ["de-hh-sh"]);
      cachedAreas = { expires: Date.now() + 10 * 60_000, values: list(parseJson(rows[0]?.payload).schleswigHolsteinAreas) };
    }
    areas = cachedAreas.values;
  }
  const queries = planImmoScoutQueries(source, profiles, areas);
  return chooseImmoScoutQuery(queries, now);
}

function queryFor(source, config = {}) {
  if (config.query) return String(config.query).slice(0, 500);
  return queryText("Wohnung", scoutRegion(source));
}

export function normalizeImmoScoutEntry(entry, sourceId) {
  const id = entryId(entry);
  const url = String(entry?.exposeUrl || "");
  if (!id || !/^https:\/\/www\.immobilienscout24\.de\/expose\//i.test(url)) return null;
  const address = entry.address || {};
  const country = String(address.countryCode || address.country || "").toLowerCase();
  if (country && !["de", "deu", "deutschland", "germany"].includes(country)) return null;
  const city = String(address.city || entry.city || "").toLowerCase();
  if (city && Number(sourceId) === 1 && !city.includes("hamburg")) return null;
  if (city && Number(sourceId) === 69 && city.startsWith("hamburg")) return null;
  // Schleswig-Holstein postcodes fall in 21xxx–25xxx. Ignore clear
  // cross-region results without treating missing postcodes as invalid.
  const postcode = String(address.postcode || "");
  if (Number(sourceId) === 69 && postcode && !/^2[1-5]\d{3}$/.test(postcode)) return null;
  const cold = numeric(entry.price?.value);
  const total = numeric(entry.totalRent);
  const propertyType = String(entry.type || "").toUpperCase();
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
      // price.value is the basic rent; only totalRent is verified as warm rent.
      warm_rent: total > 0 && (cold == null || total >= cold) ? total : null,
      cold_rent: cold > 0 ? cold : null,
      additional_costs: numeric(entry.serviceCharge),
      heating_costs: numeric(entry.heatingCosts),
      rooms: numeric(entry.rooms),
      area_sqm: numeric(entry.size),
      image_url: typeof entry.titlePictureUrls?.[0]?.href === "string" ? entry.titlePictureUrls[0].href.replace(/%WIDTH%/g, "1200").replace(/%HEIGHT%/g, "800") : null,
      provider: "immoscout24",
      ...(propertyType.includes("HOUSE") ? { property_type: "Haus" }
        : propertyType.includes("APARTMENT") || propertyType.includes("FLAT") ? { property_type: "Wohnung" } : {}),
      ...germanCoordinates(entry, sourceId),
    },
  };
}

export async function fetchImmoScoutSource(source, config = {}) {
  scoutRegion(source);
  const query = queryFor(source, config);
  const search = await callTool("property_search_de", query);
  const nodes = new Map();
  for (const entry of search.entries) {
    const normalized = normalizeImmoScoutEntry(entry, source.id);
    if (normalized && !nodes.has(normalized.identity)) nodes.set(normalized.identity, normalized);
  }
  const searchCount = nodes.size;
  let mapCount = 0, enriched = 0, added = 0, mapError = null;
  if (config.enrichWithMap === true) {
    try {
      const result = await callTool("property_map_de", query);
      mapCount = result.entries.length;
      const maxExtra = Math.max(0, Math.min(20, Number(config.maxMapExtras ?? 15) || 0));
      for (const entry of result.entries) {
        const normalized = normalizeImmoScoutEntry(entry, source.id);
        if (!normalized) continue;
        const previous = nodes.get(normalized.identity);
        if (previous) {
          const facts = { ...previous.facts };
          for (const [key, value] of Object.entries(normalized.facts)) {
            if ((facts[key] == null || facts[key] === "") && value != null && value !== "") facts[key] = value;
          }
          if (Object.keys(normalized.facts).some(key => facts[key] !== previous.facts[key])) enriched++;
          nodes.set(normalized.identity, { ...previous, facts });
        } else if (added < maxExtra) {
          nodes.set(normalized.identity, normalized);
          added++;
        }
      }
    } catch (error) {
      mapError = String(error?.message || error).slice(0, 120);
      console.warn("immoscout_map_enrichment_failed", mapError);
    }
  }
  return {
    nodes: [...nodes.values()],
    fetched: search.total ?? searchCount,
    reported_total: search.total,
    query, searchCount, mapCount, enriched, added,
    ...(mapError ? { map_error: mapError } : {}),
  };
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
  const query = config.query || await scheduledQuery(sql, source);
  const result = await fetchImmoScoutSource(source, { ...config, query, enrichWithMap: true, maxMapExtras: 15 });
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
  return { fetched: result.fetched, valid: result.nodes.length, inserted, query: result.query,
    search_count: result.searchCount, map_count: result.mapCount, enriched: result.enriched,
    added: result.added, ...(result.map_error ? { map_error: result.map_error } : {}) };
}
