// Complete ImmoScout24 inventory sweep.
//
// The MCP has no pagination: property_search_de takes only {query} and returns at
// most 20 entries, but reports the real `total`. A search whose total is <= 20 is
// therefore complete. The sweep partitions the market into price ranges (and, for
// a single price, room counts) until every range is complete, then reads them all.
import {
  callTool, scoutRegion, normalizeImmoScoutEntry, persistImmoScoutNodes,
  planImmoScoutQueries, chooseImmoScoutQuery, ingestImmoScoutSource,
} from "./immoscout-source.js";
import { sqlTime } from "./application-policy.js";

export const MCP_PAGE_SIZE = 20;
const CONCURRENCY = 4;
const MAX_CALLS = 400; // one cron invocation allows 1,000 subrequests including D1
const MAX_SECONDS = 150;
const REMATCH_PER_SWEEP = 60;
const RETRY_DELAYS_MS = [400, 1200];
const ROOMS = [1, 2, 3, 4, 5];
// Kaltmiete bounds in euros; null = open end.
const INITIAL_RANGES = [[0, 400], [400, 600], [600, 800], [800, 1000], [1000, 1200],
  [1200, 1500], [1500, 2000], [2000, 3000], [3000, null]];

export const initialLeaves = () => INITIAL_RANGES.map(([lo, hi]) => ({ lo, hi, rooms: null }));

export function leafQuery(base, { lo, hi, rooms = null }) {
  const price = hi == null ? `Kaltmiete ab ${lo} Euro`
    : lo === 0 ? `Kaltmiete bis ${hi} Euro` : `Kaltmiete ${lo} bis ${hi} Euro`;
  return `${base}, ${price}${rooms ? `, ${rooms} Zimmer` : ""}`;
}

// Children of a leaf with more than one page. Price halves overlap at the midpoint
// because rents can include cents; entries are deduplicated by id. A range only one
// euro wide cannot be halved without dropping cent rents, so it splits by rooms.
export function splitLeaf({ lo, hi, rooms = null }) {
  if (rooms != null) return null;
  if (hi == null) return lo > 0 ? [{ lo, hi: lo * 2, rooms: null }, { lo: lo * 2, hi: null, rooms: null }] : null;
  if (hi - lo >= 2) {
    const mid = Math.floor((lo + hi) / 2);
    return [{ lo, hi: mid, rooms: null }, { lo: mid, hi, rooms: null }];
  }
  return ROOMS.map(count => ({ lo, hi, rooms: count }));
}

// Neighbouring empty-ish price leaves collapse so the stored plan does not only grow.
// A merged leaf that turns out to hold more than one page is simply split again.
export function mergeLeaves(leaves, maxTotal = 10) {
  const sorted = [...leaves].sort((a, b) => a.lo - b.lo || (a.hi ?? Infinity) - (b.hi ?? Infinity));
  const out = [];
  for (const leaf of sorted) {
    const last = out.at(-1);
    if (last && last.rooms == null && leaf.rooms == null && last.hi != null && last.hi === leaf.lo
      && last.complete && leaf.complete && last.total + leaf.total <= maxTotal) {
      out[out.length - 1] = { lo: last.lo, hi: leaf.hi, rooms: null, total: last.total + leaf.total, complete: true };
    } else out.push(leaf);
  }
  return out;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Walk the plan. `search(query)` -> { entries, total }.
 * Resolves with the deduplicated raw entries, the resulting leaf plan and flags
 * saying whether every leaf was complete (entries === total) without errors.
 */
export async function sweepLeaves({
  search, base, leaves, concurrency = CONCURRENCY, maxCalls = MAX_CALLS,
  deadline = Date.now() + MAX_SECONDS * 1000, sleep = pause,
}) {
  const queue = (leaves?.length ? leaves : initialLeaves()).map(({ lo, hi, rooms = null }) => ({ lo, hi, rooms }));
  const entries = new Map(), done = [];
  let calls = 0, errors = 0, truncated = false, active = 0;

  async function query(text) {
    for (let attempt = 0; ; attempt++) {
      if (calls >= maxCalls) throw Object.assign(new Error("sweep_call_budget"), { budget: true });
      calls++;
      try { return await search(text); }
      catch (error) {
        if (attempt >= RETRY_DELAYS_MS.length) throw error;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  async function visit(leaf) {
    if (Date.now() > deadline) { truncated = true; done.push({ ...leaf, total: null, complete: false }); return; }
    let result;
    try { result = await query(leafQuery(base, leaf)); }
    catch (error) {
      if (error.budget) truncated = true; else errors++;
      done.push({ ...leaf, total: null, complete: false });
      return;
    }
    for (const entry of result.entries) {
      const id = String(entry?.exposedId || entry?.exposeId || entry?.id || "").trim();
      if (id && !entries.has(id)) entries.set(id, entry);
    }
    const total = result.total;
    if (total != null && total <= MCP_PAGE_SIZE) {
      done.push({ ...leaf, total, complete: result.entries.length === total });
      return;
    }
    const children = splitLeaf(leaf);
    if (children) queue.push(...children);
    else done.push({ ...leaf, total, complete: false }); // a single price and room count above one page
  }

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const leaf = queue.shift();
      if (!leaf) { if (!active) return; await sleep(5); continue; }
      active++;
      try { await visit(leaf); } finally { active--; }
    }
  }));

  const complete = errors === 0 && !truncated && done.every(leaf => leaf.complete);
  return { entries, leaves: mergeLeaves(done), calls, errors, truncated, complete };
}

async function loadPlan(sql, sourceId, type) {
  const rows = await sql`SELECT leaves FROM housing.immoscout_sweep_plans WHERE source_id = ${sourceId} AND property_type = ${type}`;
  try {
    const leaves = JSON.parse(rows[0]?.leaves || "null");
    return Array.isArray(leaves) && leaves.length ? leaves : null;
  } catch { return null; }
}

async function savePlan(sql, sourceId, type, leaves) {
  await sql`
    INSERT INTO housing.immoscout_sweep_plans (source_id, property_type, leaves, updated_at)
    VALUES (${sourceId}, ${type}, ${JSON.stringify(leaves)}, now())
    ON CONFLICT (source_id, property_type) DO UPDATE SET leaves = EXCLUDED.leaves, updated_at = now()`;
}

// Offers of this type that this sweep did not touch (the upsert sets last_seen_at = now()).
async function delistUnseen(sql, sourceId, type, startedAt) {
  const rows = await sql.unsafe(
    `UPDATE housing.offer_identities SET expires_at = now()
      WHERE source_id = $1 AND json_extract(facts, '$.property_type') = $2
        AND last_seen_at < $3 AND expires_at > now()
      RETURNING id`,
    [sourceId, type, sqlTime(new Date(startedAt))],
  );
  return rows.length;
}

/**
 * One full sweep of an ImmoScout region for one property type.
 * Delisting only happens after a sweep that is provably complete.
 */
export async function ingestImmoScoutSweep(sql, source, config = {}) {
  const region = scoutRegion(source), type = config.type || "Wohnung";
  const base = config.base || `${type === "Wohnung" ? "Wohnung mieten" : type} in ${region}`;
  const search = config.search || (query => callTool("property_search_de", query));
  const startedAt = Date.now();

  const totalStart = (await search(base)).total;
  const plan = await loadPlan(sql, source.id, type);
  const sweep = await sweepLeaves({ search, base, leaves: plan, deadline: startedAt + MAX_SECONDS * 1000 });
  let totalEnd = null;
  try { totalEnd = (await search(base)).total; } catch { /* the start total alone then decides */ }

  const nodes = new Map();
  for (const entry of sweep.entries.values()) {
    const node = normalizeImmoScoutEntry(entry, source.id, type);
    if (node && !nodes.has(node.identity)) nodes.set(node.identity, node);
  }
  // Search entries carry no coordinates: one map call fills missing facts only.
  let mapError = null;
  try {
    const map = await (config.map ? config.map(base) : callTool("property_map_de", base));
    for (const entry of map.entries) {
      const mapped = normalizeImmoScoutEntry(entry, source.id, type);
      const node = mapped && nodes.get(mapped.identity);
      if (!node) continue;
      for (const [key, value] of Object.entries(mapped.facts)) {
        if ((node.facts[key] == null || node.facts[key] === "") && value != null && value !== "") node.facts[key] = value;
      }
    }
  } catch (error) {
    mapError = String(error?.message || error).slice(0, 120);
    console.warn("immoscout_map_enrichment_failed", mapError);
  }

  const found = nodes.size;
  // The broad total can move during the minute-long sweep, so either reading may match.
  const complete = sweep.complete && found > 0 && (found === totalStart || found === totalEnd);
  const identities = [...nodes.keys()].sort();
  const slot = Math.floor(startedAt / (5 * 60_000));
  const rematchIds = new Set(Array.from({ length: Math.min(REMATCH_PER_SWEEP, identities.length) },
    (_, i) => identities[(slot * REMATCH_PER_SWEEP + i) % identities.length]));
  const persisted = await persistImmoScoutNodes(sql, source, [...nodes.values()], { rematchIds });
  const gone = complete ? await delistUnseen(sql, source.id, type, startedAt) : 0;
  await savePlan(sql, source.id, type, sweep.leaves);

  const summary = {
    mcp_total: totalStart, found, coverage: totalStart ? Number((found / totalStart).toFixed(4)) : null,
    calls: sweep.calls + 2, leaves: sweep.leaves.length, seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
    errors: sweep.errors, truncated: sweep.truncated, complete,
    new: found - persisted.previouslyKnown, gone, queued_offers: persisted.queuedOffers,
    ...(mapError ? { map_error: mapError } : {}),
  };
  console.log("immoscout_sweep", JSON.stringify({ source_id: source.id, type, ...summary }));

  // Other property types (houses, WG rooms, ...) keep the one-query rotation.
  let other = null;
  if (config.otherTypes !== false) {
    try {
      const profiles = await sql.unsafe(
        "SELECT sp.criteria FROM housing.search_profiles sp JOIN housing.source_links sl ON sl.search_profile_id=sp.id WHERE sl.source_id=$1 AND sp.active=true ORDER BY sp.id",
        [source.id]);
      const queries = planImmoScoutQueries(source, profiles).filter(query => !query.startsWith("Wohnungen zur Miete"));
      if (queries.length) other = await ingestImmoScoutSource(sql, source, { ...config, query: chooseImmoScoutQuery(queries, startedAt) });
    } catch (error) {
      console.error("immoscout_other_types_failed", String(error?.message || error).slice(0, 160));
    }
  }
  return {
    fetched: totalStart, valid: found, inserted: persisted.inserted, query: base,
    missing_from_response: totalStart == null ? null : Math.max(0, totalStart - found),
    previously_known_in_response: persisted.previouslyKnown,
    newly_discovered_in_response: found - persisted.previouslyKnown,
    coverage_partition: true, sweep: summary, ...(other ? { other_types: other.query } : {}),
    ...(mapError ? { map_error: mapError } : {}),
  };
}
