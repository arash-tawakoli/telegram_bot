// Complete ImmoScout24 inventory sweep.
//
// The MCP has no pagination: property_search_de takes only {query} and returns at
// most 20 entries, but reports the real `total`. A search whose total is <= 20 is
// therefore complete. The sweep partitions the market into price ranges (and, for
// a single price, room counts) until every range is complete, then reads them all.
//
// One cron invocation may make at most 1,000 subrequests and 1,000 D1 queries, so a
// sweep is resumable: each tick works within a fetch and a D1 budget, persists what it
// found, and stores the unfinished ranges. Offers are expired only after a sweep that
// visited every range within WINDOW_MS and found exactly the broad total.
import {
  callTool, scoutRegion, normalizeImmoScoutEntry, persistImmoScoutNodes,
  planImmoScoutQueries, chooseImmoScoutQuery, ingestImmoScoutSource,
} from "./immoscout-source.js";
import { sqlTime } from "./application-policy.js";

export const MCP_PAGE_SIZE = 20;
export const LIMITS = Object.freeze({
  concurrency: 4,
  stepCalls: 48,          // MCP calls between two persist steps (<= ~960 entries)
  fetchBudget: 850,       // per invocation (queue consumer), below the 1,000 subrequest limit
  d1Soft: 400,            // per invocation, sweep statements only; full upserts are deferred beyond this
  d1Matching: 250,        // per invocation, queueMatches statements; matching waits beyond this
  d1Hard: 900,            // per invocation, everything; no further step starts beyond this (limit 1,000)
  tickSeconds: 270,       // wall budget of the sweep part of one tick (a region is enqueued every 5 minutes)
  windowMs: 30 * 60_000,  // a sweep must finish within this to be allowed to delist
  leaseMs: 8 * 60_000,    // another tick of the same sweep may not start while one runs
  packTotal: 18,
  maxDelistShare: 0.05,   // a sweep never expires more than this share at once (normal churn is far below)          // neighbouring complete leaves are packed into one while their combined total stays within this (< page size 20)
  rematchPerTick: 60,     // unchanged offers re-matched per tick (a hash-rotating slice plus any backlog)
});
const RETRY_DELAYS_MS = [400, 1200];
// Kaltmiete bounds in euros; null = open end.
const INITIAL_RANGES = [[0, 400], [400, 600], [600, 800], [800, 1000], [1000, 1200],
  [1200, 1500], [1500, 2000], [2000, 3000], [3000, null]];

export const initialLeaves = () => INITIAL_RANGES.map(([lo, hi]) => ({ lo, hi }));
const range = ({ lo, hi, slo = null, shi = null }) => ({ lo, hi, ...(slo != null ? { slo, shi } : {}) });
// Wohnfläche bands (m²) for price ranges that are one euro wide but still hold more than a page (dense Berlin price points).
const SIZE_BANDS = [[0, 30], [30, 40], [40, 50], [50, 65], [65, 80], [80, null]];

export function leafQuery(base, { lo, hi, slo = null, shi = null }) {
  const price = hi == null ? `Kaltmiete ab ${lo} Euro`
    : lo === 0 ? `Kaltmiete bis ${hi} Euro` : `Kaltmiete ${lo} bis ${hi} Euro`;
  const size = slo == null ? "" : shi == null ? `, Wohnfläche ab ${slo} m²`
    : slo === 0 ? `, Wohnfläche bis ${shi} m²` : `, Wohnfläche ${slo} bis ${shi} m²`;
  return `${base}, ${price}${size}`;
}

// Children of a leaf with more than one page. Price halves overlap at the midpoint
// because rents can include cents; entries are deduplicated by id. A range only one
// euro wide cannot be halved without dropping cent rents, so it splits by living area,
// again with overlapping bands. Room counts are not used: 1-5 would drop 2.5, 6+ and unknown.
export function splitLeaf(leaf) {
  const { lo, hi, slo = null, shi = null } = leaf;
  if (slo != null) {
    if (shi == null) return slo > 0 ? [{ lo, hi, slo, shi: slo * 2 }, { lo, hi, slo: slo * 2, shi: null }] : null;
    if (shi - slo < 2) return null;
    const mid = Math.floor((slo + shi) / 2);
    return [{ lo, hi, slo, shi: mid }, { lo, hi, slo: mid, shi }];
  }
  if (hi == null) return lo > 0 ? [{ lo, hi: lo * 2 }, { lo: lo * 2, hi: null }] : null;
  if (hi - lo >= 2) {
    const mid = Math.floor((lo + hi) / 2);
    return [{ lo, hi: mid }, { lo: mid, hi }];
  }
  return SIZE_BANDS.map(([from, to]) => ({ lo, hi, slo: from, shi: to }));
}

// Neighbouring complete leaves are packed into one while their combined total fits in a page, so the stored
// plan costs about total/18 calls instead of one per leaf. Ranges that share a boundary (the overlap point of a
// split, counted in both) or size bands of one price range are neighbours; the sum over-counts the shared
// boundary, never under-counts. A packed leaf that holds more than a page next time is simply split again, and
// completeness is still decided per visit (entries === total).
export function mergeLeaves(leaves, maxTotal = LIMITS.packTotal) {
  const key = leaf => [leaf.lo, leaf.hi ?? Infinity, leaf.slo ?? -1];
  const sorted = [...leaves].sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  const out = [];
  for (const leaf of sorted) {
    const last = out.at(-1);
    if (last && last.complete && leaf.complete && last.total + leaf.total <= maxTotal) {
      const prices = last.slo == null && leaf.slo == null && last.hi != null && last.hi === leaf.lo;
      const sizes = last.slo != null && leaf.slo != null && last.lo === leaf.lo && last.hi === leaf.hi
        && last.shi != null && last.shi === leaf.slo;
      if (prices) { out[out.length - 1] = { lo: last.lo, hi: leaf.hi, total: last.total + leaf.total, complete: true }; continue; }
      if (sizes) { out[out.length - 1] = { lo: last.lo, hi: last.hi, slo: last.slo, shi: leaf.shi, total: last.total + leaf.total, complete: true }; continue; }
    }
    out.push(leaf);
  }
  return out;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const idOf = entry => String(entry?.exposedId || entry?.exposeId || entry?.id || "").trim();

/**
 * Visit ranges until the queue is empty or a budget is reached.
 * `search(query)` -> { entries, total }.
 * Unvisited ranges come back in `pending` so the walk can resume in the next tick;
 * a range that keeps failing is recorded as an incomplete leaf and counted in `errors`.
 */
export async function sweepLeaves({
  search, base, leaves, concurrency = LIMITS.concurrency, maxCalls = LIMITS.fetchBudget,
  deadline = Date.now() + LIMITS.tickSeconds * 1000, sleep = pause,
}) {
  const queue = (leaves?.length ? leaves : initialLeaves()).map(range);
  const entries = new Map(), done = [];
  let calls = 0, errors = 0, active = 0;

  async function query(text) {
    for (let attempt = 0; ; attempt++) {
      calls++;
      try { return await search(text); }
      catch (error) {
        if (attempt >= RETRY_DELAYS_MS.length) throw error;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  async function visit(leaf) {
    let result;
    try { result = await query(leafQuery(base, leaf)); }
    catch { errors++; done.push({ ...leaf, total: null, complete: false }); return; }
    for (const entry of result.entries) {
      const id = idOf(entry);
      if (id && !entries.has(id)) entries.set(id, entry);
    }
    const total = result.total;
    if (total != null && total <= MCP_PAGE_SIZE) {
      done.push({ ...leaf, total, complete: result.entries.length === total });
      return;
    }
    const children = splitLeaf(leaf);
    if (children) queue.push(...children);
    else done.push({ ...leaf, total, complete: false }); // price and area cannot be narrowed further
  }

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      if (calls >= maxCalls || Date.now() > deadline) return;
      const leaf = queue.shift();
      if (!leaf) { if (!active) return; await sleep(5); continue; }
      active++;
      try { await visit(leaf); } finally { active--; }
    }
  }));

  const pending = queue.map(range);
  return {
    entries, done, pending, calls, errors,
    leaves: mergeLeaves(done), truncated: pending.length > 0,
    complete: errors === 0 && !pending.length && done.every(leaf => leaf.complete),
  };
}

// Counts D1 queries so each invocation can stay below its budget and report it.
export function meterSql(sql) {
  const meter = { queries: 0 };
  const metered = Object.assign((...args) => { meter.queries++; return sql(...args); }, sql, {
    unsafe: (...args) => { meter.queries++; return sql.unsafe(...args); },
  });
  return Object.assign(metered, { meter });
}

const emptyState = () => ({ v: 2, leaves: null, baseline: true, done: [], pending: null, sweep: null, lease: 0, rematchBacklog: [] });
const hashOf = id => [...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// Plans written before the size split may hold room-count leaves, which lose 2.5-room and 6+ room offers.
// Fold them back into their price range, which is then split by size when it is crowded.
export function dropRoomLeaves(leaves) {
  const seen = new Set();
  return (leaves || []).map(leaf => (leaf.rooms != null ? { lo: leaf.lo, hi: leaf.hi } : leaf))
    .filter(leaf => { const key = `${leaf.lo}|${leaf.hi}|${leaf.slo ?? ""}|${leaf.shi ?? ""}`; return seen.has(key) ? false : (seen.add(key), true); });
}

async function loadState(sql, sourceId, type) {
  const rows = await sql`SELECT leaves FROM housing.immoscout_sweep_plans WHERE source_id = ${sourceId} AND property_type = ${type}`;
  if (!rows[0]) return emptyState();
  try {
    const stored = JSON.parse(rows[0].leaves || "null");
    // A bare array is the plan written by the first, single-tick version: a finished baseline.
    if (Array.isArray(stored)) return { ...emptyState(), leaves: dropRoomLeaves(stored), baseline: false };
    const state = { ...emptyState(), ...stored };
    state.leaves = state.leaves && dropRoomLeaves(state.leaves);
    state.pending = state.pending && dropRoomLeaves(state.pending);
    state.done = dropRoomLeaves(state.done);
    return state;
  } catch { return emptyState(); }
}

async function saveState(sql, sourceId, type, state) {
  await sql`
    INSERT INTO housing.immoscout_sweep_plans (source_id, property_type, leaves, updated_at)
    VALUES (${sourceId}, ${type}, ${JSON.stringify(state)}, now())
    ON CONFLICT (source_id, property_type) DO UPDATE SET leaves = EXCLUDED.leaves, updated_at = now()`;
}

// Offers of this sweep type that no tick of this sweep touched (every upsert/touch sets last_seen_at = now()).
// True when the visited ranges leave no gap on the price axis [0, ∞); a price range that was split by
// living area counts only when its size bands also cover [0, ∞). With every range complete this proves the sweep saw
// the whole market, independent of the broad total, which keeps moving while a large region is swept.
export function coversWholeMarket(leaves) {
  const gapless = (spans) => {
    let reach = 0;
    for (const [lo, hi] of spans.sort((a, b) => a[0] - b[0])) {
      if (lo > reach) return false;
      reach = Math.max(reach, hi ?? Infinity);
    }
    return reach === Infinity;
  };
  const prices = [], banded = new Map();
  for (const leaf of leaves) {
    if (leaf.slo == null) { prices.push([leaf.lo, leaf.hi]); continue; }
    const key = `${leaf.lo}|${leaf.hi}`;
    if (!banded.has(key)) banded.set(key, []);
    banded.get(key).push([leaf.slo, leaf.shi]);
  }
  for (const [key, bands] of banded) {
    if (!gapless(bands)) continue;
    const [lo, hi] = key.split("|");
    prices.push([Number(lo), hi === "null" ? null : Number(hi)]);
  }
  return gapless(prices);
}

async function delistUnseen(sql, sourceId, type, startedAt, maxGone) {
  // Brake against a faulty MCP answer (e.g. a range suddenly reported empty): normal churn per sweep is well below this.
  const [{ n }] = await sql.unsafe(
    `SELECT count(*) AS n FROM housing.offer_identities
      WHERE source_id = $1 AND last_seen_at < $3 AND expires_at > now()
        AND COALESCE(json_extract(facts, '$.sweep_type'), json_extract(facts, '$.property_type')) = $2`,
    [sourceId, type, sqlTime(new Date(startedAt))],
  );
  if (Number(n) > maxGone) {
    console.warn("immoscout_sweep_delist_braked", JSON.stringify({ source_id: sourceId, type, unseen: Number(n), max: maxGone }));
    return 0;
  }
  const rows = await sql.unsafe(
    `UPDATE housing.offer_identities SET expires_at = now()
      WHERE source_id = $1 AND last_seen_at < $3 AND expires_at > now()
        AND COALESCE(json_extract(facts, '$.sweep_type'), json_extract(facts, '$.property_type')) = $2
      RETURNING id`,
    [sourceId, type, sqlTime(new Date(startedAt))],
  );
  return rows.length;
}

/**
 * One tick of the sweep of an ImmoScout region for one property type.
 * Starts a sweep, or resumes the unfinished one, within the per-invocation budgets.
 */
export async function ingestImmoScoutSweep(rawSql, source, config = {}) {
  const region = scoutRegion(source), type = config.type || "Wohnung";
  const base = config.base || `${type === "Wohnung" ? "Wohnung mieten" : type} in ${region}`;
  const limits = { ...LIMITS, ...config.limits };
  const sql = meterSql(rawSql);
  const startedTick = Date.now();
  let fetches = 2; // MCP initialize + notification of a fresh isolate
  const rawSearch = config.search || (query => callTool("property_search_de", query));
  const search = query => { fetches++; return rawSearch(query); };

  const state = await loadState(sql, source.id, type);
  if (state.lease > startedTick) {
    console.log("immoscout_sweep", JSON.stringify({ source_id: source.id, type, skipped: "previous_tick_running" }));
    return { fetched: null, valid: 0, inserted: 0, query: base, coverage_partition: true, sweep: { skipped: "previous_tick_running" } };
  }
  // The window passed: keep the refined ranges as the plan, but this sweep cannot delist.
  if (state.sweep && startedTick - state.sweep.startedAt > limits.windowMs) {
    state.leaves = [...state.done, ...(state.pending || [])].map(range);
    state.sweep = null; state.pending = null; state.done = [];
  }
  state.lease = startedTick + limits.leaseMs;
  await saveState(sql, source.id, type, state);

  let tick = null;
  try {
    if (!state.sweep) {
      const total = (await search(base)).total;
      state.sweep = { id: crypto.randomUUID(), startedAt: startedTick, totalStart: total, seen: [], errors: 0, calls: 0, ticks: 0, new: 0, touched: 0 };
      state.pending = (state.leaves?.length ? state.leaves : initialLeaves()).map(range);
      state.done = [];
    }
    const sweepState = state.sweep, seen = new Set(sweepState.seen);

    // Search entries carry no coordinates: one map call per tick fills missing facts only.
    const mapFacts = new Map();
    let mapError = null;
    try {
      const map = await (config.map ? config.map(base) : (fetches++, callTool("property_map_de", base)));
      for (const entry of map.entries) {
        const mapped = normalizeImmoScoutEntry(entry, source.id, type);
        if (mapped) mapFacts.set(mapped.identity, mapped.facts);
      }
    } catch (error) {
      mapError = String(error?.message || error).slice(0, 120);
      console.warn("immoscout_map_enrichment_failed", mapError);
    }

    const deadline = startedTick + limits.tickSeconds * 1000;
    const slot = Math.floor(startedTick / (5 * 60_000));
    let foundInTick = 0, persistedTotals = { inserted: 0, previouslyKnown: 0, queuedOffers: 0, touched: 0, deferred: 0, skipped: 0, matchQueries: 0 };
    const sweepSpent = () => sql.meter.queries - persistedTotals.matchQueries;
    while (state.pending.length && fetches < limits.fetchBudget && sweepSpent() < limits.d1Soft && sql.meter.queries < limits.d1Hard && Date.now() < deadline) {
      const step = await sweepLeaves({
        search, base, leaves: state.pending, deadline, concurrency: limits.concurrency,
        maxCalls: Math.min(limits.stepCalls, limits.fetchBudget - fetches), sleep: config.sleep,
      });
      const nodes = new Map();
      for (const [entryKey, entry] of step.entries) {
        // Overlapping ranges return the same offer again; one stored per sweep is enough.
        if (seen.has(entryKey)) continue;
        const node = normalizeImmoScoutEntry(entry, source.id, type);
        if (!node || nodes.has(node.identity)) continue;
        for (const [key, value] of Object.entries(mapFacts.get(node.identity) || {})) {
          if ((node.facts[key] == null || node.facts[key] === "") && value != null && value !== "") node.facts[key] = value;
        }
        nodes.set(node.identity, node);
      }
      // Every offer is re-matched once per cycle: a stable hash picks its slot, and what a tick could not afford is carried over.
      const backlog = new Set(state.rematchBacklog);
      const cycle = Math.max(1, Math.ceil((sweepState.totalStart || nodes.size) / limits.rematchPerTick));
      const rematchIds = new Set([...nodes.keys()].filter(id => backlog.has(id) || hashOf(id) % cycle === slot % cycle));
      const persisted = await persistImmoScoutNodes(sql, source, [...nodes.values()], {
        rematchIds, rematchFirst: backlog, sweepType: type, silent: state.baseline,
        used: () => sql.meter.queries, soft: limits.d1Soft,
        matchSoft: limits.d1Matching, matchUsed: persistedTotals.matchQueries,
      });
      for (const id of persisted.rematched) backlog.delete(id);
      for (const id of persisted.rematchSkipped) backlog.add(id);
      state.rematchBacklog = [...backlog].slice(-600);
      // Progress is recorded only after the offers of this step are stored, so a failed step is redone.
      for (const id of step.entries.keys()) seen.add(id);
      state.pending = step.pending;
      state.done.push(...step.done);
      sweepState.errors += step.errors;
      sweepState.calls += step.calls;
      sweepState.new += nodes.size - persisted.previouslyKnown - persisted.skipped;
      sweepState.touched += persisted.touched;
      foundInTick += step.entries.size;
      for (const key of Object.keys(persistedTotals)) persistedTotals[key] += persisted[key];
    }
    sweepState.seen = [...seen];
    sweepState.ticks++;

    const finished = state.pending.length === 0;
    let summary = {
      source_id: source.id, type, sweep_id: sweepState.id, tick: sweepState.ticks, finished,
      pending: state.pending.length, leaves_done: state.done.length, found_in_tick: foundInTick,
      seen: seen.size, baseline: state.baseline, ...persistedTotals,
    };
    if (finished) {
      const totalStart = sweepState.totalStart;
      let totalEnd = null;
      try { totalEnd = (await search(base)).total; } catch { /* the start total alone then decides */ }
      const inWindow = Date.now() - sweepState.startedAt <= limits.windowMs;
      // Complete = every range read fully, no errors, and the ranges cover the whole price axis.
      const complete = inWindow && sweepState.errors === 0 && seen.size > 0
        && state.done.every(leaf => leaf.complete) && coversWholeMarket(state.done);
      const gone = complete
        ? await delistUnseen(sql, source.id, type, sweepState.startedAt, Math.ceil(seen.size * limits.maxDelistShare)) : 0;
      Object.assign(summary, {
        mcp_total: totalStart, found: seen.size, coverage: totalStart ? Number((seen.size / totalStart).toFixed(4)) : null,
        calls: sweepState.calls, leaves: mergeLeaves(state.done).length,
        seconds: Number(((Date.now() - sweepState.startedAt) / 1000).toFixed(1)),
        errors: sweepState.errors, in_window: inWindow, complete, new: sweepState.new, gone,
      });
      if (state.baseline && totalStart && seen.size >= totalStart * 0.9) state.baseline = false;
      state.leaves = mergeLeaves(state.done).map(range);
      state.sweep = null; state.pending = null; state.done = [];
    }
    tick = { summary, mapError };
  } finally {
    // Release the lease; unfinished work stays in the state for the next tick.
    state.lease = 0;
    await saveState(sql, source.id, type, state).catch(error => console.error("immoscout_sweep_state_save_failed", String(error?.message || error)));
  }

  // Other property types (houses, WG rooms, ...) keep the one-query rotation while budget remains.
  let other = null;
  if (config.otherTypes !== false && fetches < limits.fetchBudget && sql.meter.queries < limits.d1Hard) {
    try {
      const profiles = await sql.unsafe(
        "SELECT sp.criteria FROM housing.search_profiles sp JOIN housing.source_links sl ON sl.search_profile_id=sp.id WHERE sl.source_id=$1 AND sp.active=true ORDER BY sp.id",
        [source.id]);
      const queries = planImmoScoutQueries(source, profiles).filter(query => !query.startsWith("Wohnungen zur Miete"));
      if (queries.length) {
        other = await ingestImmoScoutSource(sql, source, { ...config, query: chooseImmoScoutQuery(queries, startedTick) });
        fetches += 2;
      }
    } catch (error) {
      console.error("immoscout_other_types_failed", String(error?.message || error).slice(0, 160));
    }
  }
  const { summary, mapError } = tick;
  Object.assign(summary, {
    fetches, d1_queries: sql.meter.queries, tick_seconds: Number(((Date.now() - startedTick) / 1000).toFixed(1)),
    ...(other ? { other_types: other.query } : {}), ...(mapError ? { map_error: mapError } : {}),
  });
  console.log("immoscout_sweep", JSON.stringify(summary));
  const found = summary.found ?? summary.seen;
  return {
    fetched: summary.mcp_total ?? null, valid: found, inserted: summary.inserted, query: base,
    missing_from_response: summary.mcp_total == null ? null : Math.max(0, summary.mcp_total - found),
    previously_known_in_response: summary.previouslyKnown,
    newly_discovered_in_response: summary.inserted - summary.previouslyKnown,
    coverage_partition: true, sweep: summary,
    ...(mapError ? { map_error: mapError } : {}),
  };
}
