import { BERLIN_BOROUGHS } from "./berlin-geography.js";
import { isHamburgPostcode, queueMatches } from "./matching.js";

const MCP_URL = "https://app.chatgpt.immobilienscout24.de/v2/mcp";
const MCP_PROTOCOL = "2025-06-18";
export const IMMOSCOUT_MCP_CONTRACT = Object.freeze({
  endpoint: MCP_URL, protocol: MCP_PROTOCOL,
  searchTool: "property_search_de", mapTool: "property_map_de",
});
// Leave headroom below Cloudflare D1's 100-variable limit for every statement.
const D1_SCOUT_LOOKUP_BATCH = 60;
const D1_SCOUT_UPSERT_BATCH = 16;

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
    const wrapped = pending.catch(error => {
      if (mcpSessionPromise === wrapped) mcpSessionPromise = null;
      throw error;
    });
    mcpSessionPromise = wrapped;
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

// A read-only comparison of the actual MCP results with the bot's normalized
// results from the SAME search/map tool calls. No extra requests or DB writes.
export function compareImmoScoutMcpIds(searchIds, mapIds, normalizedNodes) {
  const rawIds = new Set([...searchIds, ...mapIds].filter(Boolean));
  const normalizedIds = new Set(normalizedNodes.map(node => node.identity).filter(Boolean));
  const filteredIds = [...rawIds].filter(id => !normalizedIds.has(id));
  const unexpectedIds = [...normalizedIds].filter(id => !rawIds.has(id));
  return {
    search_returned: searchIds.length,
    map_returned: mapIds.length,
    mcp_unique_ids: rawIds.size,
    bot_unique_ids: normalizedIds.size,
    filtered_ids: filteredIds,
    unexpected_ids: unexpectedIds,
    same_ids: filteredIds.length === 0 && unexpectedIds.length === 0,
  };
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
      : Number(sourceId) === 72
        ? { minLat: 52.3, maxLat: 52.72, minLng: 13.05, maxLng: 13.8 }
        : null;
  if (!bounds || latitude == null || longitude == null
    || (country && !["de", "deu", "deutschland", "germany"].includes(country))
    || latitude < bounds.minLat || latitude > bounds.maxLat
    || longitude < bounds.minLng || longitude > bounds.maxLng) return {};
  return { latitude, longitude };
}

export function germanImmoScoutQuery(source, filter = "") {
  if (![1, 69, 72].includes(Number(source?.id)) || source?.family !== "immoscout24") {
    throw new Error("immoscout_source_not_allowlisted");
  }
  const criteria = String(filter ?? "").trim();
  if (criteria.length > 180 || /[\u0000-\u001f]/.test(criteria)
    || /(?:^|[\s,;])(?:österreich|oesterreich|austria|vienna|wien|graz|salzburg|innsbruck|linz)(?=$|[\s,;])/i.test(criteria)) {
    throw new Error("immoscout_query_invalid");
  }
  const region = scoutRegion(source);
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
  if (source?.family !== "immoscout24" || ![1, 69, 72].includes(Number(source?.id)))
    throw new Error("immoscout_source_not_allowlisted");
  return Number(source.id) === 1 ? "Hamburg" : Number(source.id) === 69 ? "Schleswig-Holstein" : "Berlin";
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
    } else if (region === "Berlin") {
      if (mode === "all_berlin") add(type, region);
      if (mode === "berlin_boroughs" || mode === "berlin_localities") {
        const selected = mode === "berlin_localities" ? profile.berlin_localities : profile.berlin_boroughs;
        for (const name of list(selected)) {
          const place = safePlace(name);
          if (place) add(type, place.startsWith("Berlin-") ? place : "Berlin-" + place);
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

// The public MCP tools expose the global count but return only the visible
// subset, and do not expose a page cursor. Rotate smaller, overlapping searches
// to discover additional IDs without guessing undocumented pagination params.
const HAMBURG_BOROUGHS = Object.freeze([
  "Hamburg-Mitte", "Altona", "Eimsbüttel", "Hamburg-Nord",
  "Wandsbek", "Bergedorf", "Harburg",
]);
const HAMBURG_RENT_BANDS = Object.freeze([
  "Kaltmiete bis 1000 Euro",
  "Kaltmiete 1000 bis 2000 Euro",
  "Kaltmiete ab 2000 Euro",
]);
export function hamburgCoverageQueries() {
  return HAMBURG_BOROUGHS.flatMap(borough =>
    HAMBURG_RENT_BANDS.map(band =>
      `Wohnungen zur Miete in ${borough.startsWith("Hamburg-") ? borough : "Hamburg-" + borough}, Deutschland, ${band}`
    )
  );
}

export function berlinCoverageQueries() {
  return BERLIN_BOROUGHS.flatMap(borough =>
    HAMBURG_RENT_BANDS.map(band => `Wohnungen zur Miete in Berlin-${borough}, Deutschland, ${band}`)
  );
}

// Keep broad coverage on every second run while rotating targeted locations.
// Without this, many active districts could starve the broad discovery query.
export function chooseImmoScoutQuery(queries, now = Date.now()) {
  if (!Array.isArray(queries) || !queries.length) throw new Error("immoscout_query_plan_empty");
  if (queries.length === 1) return queries[0];
  // Schleswig-Holstein keeps its established broad/targeted rotation.
  const slot = Math.floor(now / (5 * 60_000));
  return slot % 2 === 0 ? queries[0] : queries[1 + (Math.floor(slot / 2) % (queries.length - 1))];
}

// A stable Hamburg schedule prevents growing profile-specific query lists from
// starving the seven borough x three rent-band coverage partitions. No extra
// MCP requests are made: each scheduled source run still fetches one query.
export function chooseHamburgCoverageQuery(profileQueries, coverageQueries, now = Date.now()) {
  if (!Array.isArray(profileQueries) || !profileQueries.length) throw new Error("immoscout_query_plan_empty");
  if (!Array.isArray(coverageQueries) || !coverageQueries.length) return chooseImmoScoutQuery(profileQueries, now);
  const slot = Math.floor(now / (5 * 60_000));
  const phase = ((slot % 4) + 4) % 4;
  const cycle = Math.floor(slot / 4);
  if (phase === 0) return profileQueries[0]; // Broad Hamburg every 20 minutes.
  if (phase === 1) return coverageQueries[cycle % coverageQueries.length];
  const coverage = new Set(coverageQueries);
  const specific = profileQueries.slice(1).filter(query => !coverage.has(query));
  if (!specific.length) return coverageQueries[(cycle * 2 + phase - 2) % coverageQueries.length];
  return specific[(cycle * 2 + phase - 2) % specific.length];
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
  // For Hamburg, prioritize stable borough/rent partitions alongside active
  // profile searches. Unlike a shared growing list, each category cycles
  // independently and cannot be starved by unrelated new search profiles.
  if (Number(source.id) === 1) return chooseHamburgCoverageQuery(queries, hamburgCoverageQueries(), now);
  if (Number(source.id) === 72) return chooseHamburgCoverageQuery(queries, berlinCoverageQueries(), now);
  return chooseImmoScoutQuery(queries, now);
}

function queryFor(source, config = {}) {
  if (config.query) return String(config.query).slice(0, 500);
  return queryText("Wohnung", scoutRegion(source));
}

export function normalizeImmoScoutEntry(entry, sourceId, requestedType = null) {
  const id = entryId(entry);
  const url = String(entry?.exposeUrl || "");
  if (!id || !/^https:\/\/www\.immobilienscout24\.de\/expose\//i.test(url)) return null;
  const address = entry.address || {};
  const country = String(address.countryCode || address.country || "").toLowerCase();
  if (country && !["de", "deu", "deutschland", "germany"].includes(country)) return null;
  const city = String(address.city || entry.city || "").toLowerCase();
  // Hamburg districts are sometimes returned as city names by the MCP.
  if (city && Number(sourceId) === 1 && !city.includes("hamburg")
    && !isHamburgPostcode(address.postcode)) return null;
  if (city && Number(sourceId) === 69 && (city.startsWith("hamburg") || city.startsWith("berlin"))) return null;
  if (Number(sourceId) === 72 && city && !/^berlin(?:$|[\s,/-])/.test(city)) return null;
  // Schleswig-Holstein postcodes fall in 21xxx–25xxx. Ignore clear
  // cross-region results without treating missing postcodes as invalid.
  const postcode = String(address.postcode || "");
  if (Number(sourceId) === 69 && postcode && !/^2[1-5]\d{3}$/.test(postcode)) return null;
  const cold = numeric(entry.price?.value);
  const total = numeric(entry.totalRent);
  const propertyType = String(entry.type || entry.realEstateType || entry.estateType || "").toUpperCase();
  const title = String(entry.title || "");
  const exchangeLike = /tauschwohnung|wohnungstausch|tauschangebot|\btausche\b/i.test(title);
  const sharedLike = /\bwg[\s-]*zimmer\b|\bwohngemeinschaft\b|\bzimmer\s+in\s+wg\b/i.test(title);
  const houseLike = /(?:einfamilienhaus|reihenhaus|doppelhaus|villa|bungalow|haus\s+zur\s+miete)/i.test(title);
  // Provider titles can identify exchange/room offers even when the search
  // query is for apartments. Do not incorrectly classify these as Wohnungen.
  const category = exchangeLike ? "Tauschwohnung"
    : sharedLike ? "WG"
    : propertyType.includes("HOUSE") || houseLike ? "Haus"
    : propertyType.includes("APARTMENT") || propertyType.includes("FLAT") ? "Wohnung"
    : requestedType === "WG" || requestedType === "Tauschwohnung" ? requestedType
    : requestedType === "Wohnung" ? "Wohnung"
    : requestedType === "Haus" ? "Haus" : null;
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
      ...(category ? { property_type: category } : {}),
      ...germanCoordinates(entry, sourceId),
    },
  };
}

export async function fetchImmoScoutSource(source, config = {}) {
  scoutRegion(source);
  const query = queryFor(source, config);
  const requestedType = Object.entries(RENTAL_TYPES)
    .find(([, label]) => query.startsWith(label))?.[0] || null;
  const search = await callTool("property_search_de", query);
  const auditSearchIds = config.auditMcpIds === true ? search.entries.map(entryId).filter(Boolean) : null;
  let auditMapIds = [];
  const nodes = new Map();
  for (const entry of search.entries) {
    const normalized = normalizeImmoScoutEntry(entry, source.id, requestedType);
    if (normalized && !nodes.has(normalized.identity)) nodes.set(normalized.identity, normalized);
  }
  const searchCount = nodes.size;
  let mapCount = 0, enriched = 0, added = 0, mapError = null;
  if (config.enrichWithMap === true) {
    try {
      const result = await callTool("property_map_de", query);
      if (auditSearchIds) auditMapIds = result.entries.map(entryId).filter(Boolean);
      mapCount = result.entries.length;
      // Include the entire map subset (usually ~100 entries), not the old
      // 15-extra truncation. The MCP response itself remains bounded.
      const maxExtra = Math.max(0, Math.min(250, Number(config.maxMapExtras ?? 200) || 0));
      for (const entry of result.entries) {
        const normalized = normalizeImmoScoutEntry(entry, source.id, requestedType);
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
    ...(auditSearchIds ? { mcp_parity: compareImmoScoutMcpIds(auditSearchIds, auditMapIds, [...nodes.values()]) } : {}),
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
  if (![1, 69, 72].includes(Number(source?.id)) || source?.family !== "immoscout24") {
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
  const isCoveragePartition = Number(source.id) === 1
    ? hamburgCoverageQueries().includes(query)
    : Number(source.id) === 72 && berlinCoverageQueries().includes(query);
  const result = await fetchImmoScoutSource(source, { ...config, query, enrichWithMap: true, maxMapExtras: 200 });

  // One bounded lookup replaces hundreds of individual reads while retaining
  // verified facts omitted by a later, smaller MCP result.
  const identities = result.nodes.map(node => node.identity);
  const priorRows = [];
  // D1 limits bound SQL variables. Partition the existing-record lookup to
  // keep each query safely below the cap even when the MCP returns 200 cards.
  for (let offset = 0; offset < identities.length; offset += D1_SCOUT_LOOKUP_BATCH) {
    const chunk = identities.slice(offset, offset + D1_SCOUT_LOOKUP_BATCH);
    const rows = await sql.unsafe(
      `SELECT external_id, facts FROM housing.offer_identities
         WHERE source_id=$1 AND external_id IN (${chunk.map((_, i) => "$" + (i + 2)).join(",")})`,
      [source.id, ...chunk],
    );
    priorRows.push(...rows);
  }
  const prior = new Map(priorRows.map(row => [String(row.external_id), parseJson(row.facts)]));
  const previouslyKnown = identities.filter(id => prior.has(id)).length;
  const prepared = result.nodes.map(node => {
    const facts = { ...(prior.get(node.identity) || {}) };
    for (const [key, value] of Object.entries(node.facts)) {
      if (value != null && value !== "") facts[key] = value;
      else if (!(key in facts)) facts[key] = value;
    }
    return { ...node, facts };
  });

  // Each offer in this call is freshly verified by the MCP and its D1
  // upsert sets expires_at = now() + 24h. Check the application cutover once.
  const cutover = await sql`SELECT enabled_at FROM housing.application_queue_cutover WHERE id = 1`;
  const profileCache = { freshMcpUpsert: true, cutoverEnabled: cutover.length > 0 };
  let inserted = 0;
  // An atomic multi-row D1 upsert avoids one round-trip for every Scout card.
  // Matching still uses the original per-user idempotency keys and permissions.
  for (let offset = 0; offset < prepared.length; offset += D1_SCOUT_UPSERT_BATCH) {
    const chunk = prepared.slice(offset, offset + D1_SCOUT_UPSERT_BATCH);
    const params = [];
    const tuples = chunk.map(node => {
      const index = params.length + 1;
      params.push(node.source_id, node.source_id + ":external:" + node.identity,
        node.identity, node.canonical_url, JSON.stringify(node.facts));
      return `(gen_random_uuid(), $${index}, $${index + 1}, $${index + 2},
        $${index + 3}, $${index + 4}, now(), now() + interval '24 hours')`;
    });
    const rows = await sql.unsafe(
      `INSERT INTO housing.offer_identities
       (id,source_id,identity_hash,external_id,canonical_url,facts,last_seen_at,expires_at)
       VALUES ${tuples.join(",")}
       ON CONFLICT (identity_hash) DO UPDATE SET
         canonical_url=EXCLUDED.canonical_url,
         facts=json_set(EXCLUDED.facts,
           '$.warm_rent',COALESCE(json_extract(EXCLUDED.facts,'$.warm_rent'),json_extract(offer_identities.facts,'$.warm_rent')),
           '$.property_type',COALESCE(json_extract(EXCLUDED.facts,'$.property_type'),json_extract(offer_identities.facts,'$.property_type')),
           '$.image_url',COALESCE(json_extract(EXCLUDED.facts,'$.image_url'),json_extract(offer_identities.facts,'$.image_url')),
           '$.rooms',COALESCE(json_extract(EXCLUDED.facts,'$.rooms'),json_extract(offer_identities.facts,'$.rooms')),
           '$.area_sqm',COALESCE(json_extract(EXCLUDED.facts,'$.area_sqm'),json_extract(offer_identities.facts,'$.area_sqm'))
         ),
         last_seen_at=now(),expires_at=EXCLUDED.expires_at
       RETURNING id,external_id`,
      params,
    );
    inserted += rows.length;
    const byExternalId = new Map(rows.map(row => [String(row.external_id), row.id]));
    for (const node of chunk) {
      const offerId = byExternalId.get(node.identity);
      if (!offerId) continue;
      // Broad and partition scans follow the same search-profile, applicant-
      // profile and AutoApply rules. Idempotency prevents duplicate sends.
      await queueMatches(sql, offerId, node.source_id,
        node.source_id + ":external:" + node.identity,
        { ...node.facts, canonical_url: node.canonical_url },
        source.central_auto_apply_enabled === true,
        true, profileCache);
    }
  }
  return {
    fetched: result.fetched, valid: result.nodes.length, inserted, query: result.query,
    search_count: result.searchCount, map_count: result.mapCount, enriched: result.enriched,
    added: result.added, coverage_partition: isCoveragePartition,
    previously_known_in_response: previouslyKnown,
    newly_discovered_in_response: identities.length - previouslyKnown,
    property_types_in_response: result.nodes.reduce((counts, node) => {
      const type = node.facts.property_type || "unclassified";
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {}),
    missing_from_response: result.reported_total == null ? null
      : Math.max(0, result.reported_total - result.nodes.length),
    ...(result.map_error ? { map_error: result.map_error } : {}),
  };
}
