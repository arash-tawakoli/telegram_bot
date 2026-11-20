import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { createD1Client } from "../src/d1-database.js";
import { ingestImmoScoutSweep, sweepLeaves, splitLeaf, leafQuery, mergeLeaves, initialLeaves, dropRoomLeaves, coversWholeMarket } from "../src/immoscout-sweep.js";

const BASE = "Wohnung mieten in Hamburg";
const noSleep = async () => {};

// A fake MCP: parses the query like the real server maps it and returns max 20 entries.
function market(listings) {
  const calls = [];
  const search = async (query) => {
    calls.push(query);
        const price = { lo: 0, hi: Infinity, slo: 0, shi: Infinity };
    for (const part of query.split(", ").slice(1)) {
      let m;
      if ((m = part.match(/^Kaltmiete bis (\d+) Euro$/))) price.hi = Number(m[1]);
      else if ((m = part.match(/^Kaltmiete (\d+) bis (\d+) Euro$/))) { price.lo = Number(m[1]); price.hi = Number(m[2]); }
      else if ((m = part.match(/^Kaltmiete ab (\d+) Euro$/))) price.lo = Number(m[1]);
      else if ((m = part.match(/^Wohnfläche bis (\d+) m²$/))) price.shi = Number(m[1]);
      else if ((m = part.match(/^Wohnfläche (\d+) bis (\d+) m²$/))) { price.slo = Number(m[1]); price.shi = Number(m[2]); }
      else if ((m = part.match(/^Wohnfläche ab (\d+) m²$/))) price.slo = Number(m[1]);
    }
    const hits = listings.filter(l => l.price >= price.lo && l.price <= price.hi && l.entry.size >= price.slo && l.entry.size <= price.shi);
    return { total: hits.length, entries: hits.slice(0, 20).map(l => l.entry) };
  };
  return { search, calls };
}

const entry = (id, price, rooms = 2) => ({
  exposedId: String(id), exposeUrl: `https://www.immobilienscout24.de/expose/${id}`, title: `Wohnung ${id}`,
  type: "APARTMENT_RENT", price: { value: price }, totalRent: price + 100, rooms, size: 50,
  address: { city: "Hamburg", postcode: "20095" },
});
const listing = (id, price, rooms = 2, size = 50) => ({ price, rooms, entry: { ...entry(id, price, rooms), size } });

test("leaf queries use the price wording the MCP maps to exact URL filters", () => {
  assert.equal(leafQuery(BASE, { lo: 0, hi: 400 }), `${BASE}, Kaltmiete bis 400 Euro`);
  assert.equal(leafQuery(BASE, { lo: 700, hi: 720 }), `${BASE}, Kaltmiete 700 bis 720 Euro`);
  assert.equal(leafQuery(BASE, { lo: 3000, hi: null }), `${BASE}, Kaltmiete ab 3000 Euro`);
  });

test("bisection overlaps at the midpoint, grows the open top range and falls back to living area", () => {
  assert.deepEqual(splitLeaf({ lo: 400, hi: 600 }), [{ lo: 400, hi: 500 }, { lo: 500, hi: 600 }]);
  assert.deepEqual(splitLeaf({ lo: 0, hi: 401 }), [{ lo: 0, hi: 200 }, { lo: 200, hi: 401 }]);
  assert.deepEqual(splitLeaf({ lo: 3000, hi: null }), [{ lo: 3000, hi: 6000 }, { lo: 6000, hi: null }]);
  // Every child strictly shrinks, so the recursion cannot loop on the parent.
  for (const parent of [{ lo: 0, hi: 2 }, { lo: 10, hi: 13 }, { lo: 999, hi: 1001 }]) {
    for (const child of splitLeaf(parent)) assert.ok(child.hi - child.lo < parent.hi - parent.lo);
  }
  // A one-euro price range (cent rents) splits by living area with overlapping bands, not by room count,
  // which would lose 2.5-room, 6+ room and unknown-room offers.
  const bySize = splitLeaf({ lo: 800, hi: 801 });
  assert.deepEqual(bySize.map(l => [l.slo, l.shi]), [[0, 30], [30, 40], [40, 50], [50, 65], [65, 80], [80, null]]);
  assert.equal(leafQuery(BASE, bySize[0]), `${BASE}, Kaltmiete 800 bis 801 Euro, Wohnfläche bis 30 m²`);
  assert.equal(leafQuery(BASE, bySize[1]), `${BASE}, Kaltmiete 800 bis 801 Euro, Wohnfläche 30 bis 40 m²`);
  assert.equal(leafQuery(BASE, bySize[5]), `${BASE}, Kaltmiete 800 bis 801 Euro, Wohnfläche ab 80 m²`);
  assert.deepEqual(splitLeaf({ lo: 800, hi: 801, slo: 30, shi: 40 }).map(l => [l.slo, l.shi]), [[30, 35], [35, 40]]);
  assert.deepEqual(splitLeaf({ lo: 800, hi: 801, slo: 80, shi: null }).map(l => [l.slo, l.shi]), [[80, 160], [160, null]]);
  assert.equal(splitLeaf({ lo: 800, hi: 801, slo: 40, shi: 41 }), null, "nothing narrower than one m² at one rent");
});

test("a sweep finds every listing, including cent rents on a split boundary and equal-price clusters", async () => {
  const listings = [];
  let id = 1;
  for (let i = 0; i < 300; i++) listings.push(listing(id++, 300 + ((i * 37) % 1500)));
  listings.push(listing(id++, 500.5), listing(id++, 400.01), listing(id++, 399.99), listing(id++, 5200), listing(id++, 7000));
  // 30 listings at exactly the same price, including half rooms and 7 rooms, can only be separated by area.
  for (let i = 0; i < 30; i++) listings.push(listing(id++, 800, [1, 2, 2.5, 3.5, 7][i % 5], 20 + i * 2));
  const { search, calls } = market(listings);
  const sweep = await sweepLeaves({ search, base: BASE, sleep: noSleep });
  assert.equal(sweep.entries.size, listings.length);
  assert.equal(sweep.complete, true);
  assert.equal(sweep.errors, 0);
  assert.ok(calls.some(q => /Wohnfläche/.test(q)), "area fallback was used");
  assert.ok(calls.some(q => /Kaltmiete ab \d+ Euro/.test(q)));
  assert.ok(calls.length <= 400);
});

test("a dense price point with one room count is separated by living area", async () => {
  const listings = Array.from({ length: 60 }, (_, i) => listing(i + 1, 600, 1, 18 + i)); // same rent, same rooms, sizes 18..77
  listings.push(listing(99, 599.5, 1, 30.5), listing(98, 600, 1, 30));
  const { search, calls } = market(listings);
  const sweep = await sweepLeaves({ search, base: BASE, sleep: noSleep });
  assert.equal(sweep.entries.size, listings.length);
  assert.equal(sweep.complete, true);
  assert.ok(calls.some(q => /Wohnfläche/.test(q)));
});

test("a stored plan is reused, and a leaf that grew beyond one page is split again", async () => {
  const listings = Array.from({ length: 200 }, (_, i) => listing(i + 1, 300 + i * 5));
  const first = market(listings);
  const initial = await sweepLeaves({ search: first.search, base: BASE, sleep: noSleep });
  assert.equal(initial.complete, true);

  const steady = market(listings);
  const reused = await sweepLeaves({ search: steady.search, base: BASE, leaves: initial.leaves, sleep: noSleep });
  assert.equal(reused.entries.size, 200);
  assert.equal(steady.calls.length, initial.leaves.length, "one call per stored leaf");
  assert.ok(steady.calls.length < first.calls.length, "no re-discovery of the plan");

  const grown = [...listings, ...Array.from({ length: 40 }, (_, i) => listing(1000 + i, 500 + (i % 3), [1, 2, 2.5, 3.5, 7][i % 5], 20 + i))];
  const regrown = market(grown);
  const resplit = await sweepLeaves({ search: regrown.search, base: BASE, leaves: reused.leaves, sleep: noSleep });
  assert.equal(resplit.entries.size, grown.length);
  assert.equal(resplit.complete, true);
  assert.ok(resplit.leaves.length > reused.leaves.length, "the crowded leaf became several leaves");
});

test("neighbouring small leaves merge, crowded ones stay apart", () => {
  const leaves = [
    { lo: 0, hi: 400, total: 3, complete: true }, { lo: 400, hi: 600, total: 4, complete: true },
    { lo: 600, hi: 800, total: 18, complete: true }, { lo: 800, hi: null, total: 2, complete: true },
  ];
  assert.deepEqual(mergeLeaves(leaves).map(l => [l.lo, l.hi]), [[0, 600], [600, 800], [800, null]]);
});

test("transient MCP errors are retried; a persistent error makes the sweep incomplete", async () => {
  const listings = Array.from({ length: 30 }, (_, i) => listing(i + 1, 300 + i * 100));
  const { search } = market(listings);
  let failures = 2;
  const flaky = async (query) => { if (failures-- > 0) throw new Error("immoscout_mcp_http_503"); return search(query); };
  const retried = await sweepLeaves({ search: flaky, base: BASE, sleep: noSleep });
  assert.equal(retried.complete, true);
  assert.equal(retried.entries.size, 30);

  const broken = async (query) => { if (/bis 400 Euro$/.test(query)) throw new Error("immoscout_mcp_http_500"); return search(query); };
  const failed = await sweepLeaves({ search: broken, base: BASE, sleep: noSleep });
  assert.equal(failed.errors, 1);
  assert.equal(failed.complete, false);
});

test("the call budget leaves unvisited ranges pending instead of failing them", async () => {
  const listings = Array.from({ length: 500 }, (_, i) => listing(i + 1, 300 + i * 3));
  const { search } = market(listings);
  const first = await sweepLeaves({ search, base: BASE, maxCalls: 12, sleep: noSleep });
  assert.equal(first.truncated, true);
  assert.equal(first.complete, false);
  assert.equal(first.errors, 0);
  assert.ok(first.pending.length > 0 && first.calls <= 12 + 4 * 3);
  // Resuming with the pending ranges finds the rest; the union is the whole market.
  const found = new Map(first.entries);
  let pending = first.pending;
  const done = [...first.done];
  for (let guard = 0; pending.length && guard < 100; guard++) {
    const next = await sweepLeaves({ search, base: BASE, leaves: pending, maxCalls: 12, sleep: noSleep });
    for (const [id, entry] of next.entries) found.set(id, entry);
    done.push(...next.done);
    pending = next.pending;
  }
  assert.equal(found.size, 500);
  assert.ok(done.every(leaf => leaf.complete));
});

function database() {
  const sqlite = new DatabaseSync(":memory:");
  const dir = new URL("../schema/d1/", import.meta.url);
  for (const file of readdirSync(dir).filter(name => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file, dir), "utf8"));
  const prepare = (query) => {
    const build = (args) => ({
      all: async () => {
        const statement = sqlite.prepare(query);
        if (/^\s*(SELECT|WITH|PRAGMA)/i.test(query) || /\bRETURNING\b/i.test(query)) return { results: statement.all(...args), meta: { changes: 0 } };
        return { results: [], meta: { changes: Number(statement.run(...args).changes) } };
      },
      first: async () => sqlite.prepare(query).get(...args) || null,
      run: async () => ({ meta: { changes: Number(sqlite.prepare(query).run(...args).changes) } }),
    });
    return { bind: (...args) => build(args), ...build([]) };
  };
  sqlite.prepare("INSERT OR IGNORE INTO source_registry(id,name,family,connector) VALUES(1,'ImmoScout24 Hamburg','immoscout24','test')").run();
  return { sqlite, sql: createD1Client({ prepare, batch: async (statements) => Promise.all(statements.map(s => s.all())) }) };
}
const SOURCE = { id: 1, family: "immoscout24", central_auto_apply_enabled: false };
const BERLIN = { id: 72, family: "immoscout24", central_auto_apply_enabled: false };
const count = (sqlite, where, id = 1) => sqlite.prepare(`SELECT COUNT(*) n FROM offer_identities WHERE source_id=${id} AND ${where}`).get().n;
const noMap = async () => ({ entries: [] });
const tick = (sql, market, extra = {}, source = SOURCE) => ingestImmoScoutSweep(sql, source, {
  search: market.search, map: noMap, otherTypes: false, sleep: noSleep, ...extra,
});

test("offers vanish only after a complete sweep; incomplete sweeps expire nothing", async () => {
  const { sqlite, sql } = database();
  const listings = Array.from({ length: 90 }, (_, i) => listing(i + 1, 300 + i * 20));
  listings.push({ price: 1000, rooms: 2, entry: { ...entry(500, 1000), title: "Tauschwohnung gegen Haus" } });

  const first = (await tick(sql, market(listings))).sweep;
  assert.equal(first.finished, true);
  assert.equal(first.complete, true);
  assert.equal(first.found, 91);
  assert.equal(first.mcp_total, 91);
  assert.equal(first.gone, 0);
  assert.equal(first.new, 91);
  assert.equal(count(sqlite, "expires_at > datetime('now')"), 91);
  assert.ok(sqlite.prepare("SELECT leaves FROM immoscout_sweep_plans WHERE source_id=1").get(), "leaf plan stored");

  // Pretend the previous sweep happened long ago; ten offers then disappear (one is the exchange flat).
  sqlite.exec("UPDATE offer_identities SET last_seen_at=datetime('now','-1 hour') WHERE source_id=1");
  const shrunk = listings.slice(10, 90);
  const complete = (await tick(sql, market(shrunk), { limits: { maxDelistShare: 1 } })).sweep;
  assert.equal(complete.complete, true);
  assert.equal(complete.gone, 11, "the Tauschwohnung found by the sweep is delisted like a Wohnung");
  assert.equal(count(sqlite, "expires_at > datetime('now')"), 80);

  // An MCP error mid-sweep must never mark anything gone.
  sqlite.exec("UPDATE offer_identities SET last_seen_at=datetime('now','-1 hour'), expires_at=datetime('now','+1 day') WHERE source_id=1");
  const base = market(shrunk);
  const broken = (await tick(sql, { search: async (query) => { if (/Kaltmiete bis \d+ Euro$/.test(query)) throw new Error("immoscout_mcp_http_500"); return base.search(query); } })).sweep;
  assert.equal(broken.complete, false);
  assert.equal(broken.gone, 0);
  assert.equal(count(sqlite, "expires_at > datetime('now')"), 91, "nothing expired after an incomplete sweep");

  // The broad total moving during the sweep (new offers, removed offers) no longer blocks delisting.
  sqlite.exec("UPDATE offer_identities SET last_seen_at=datetime('now','-1 hour'), expires_at=datetime('now','+1 day') WHERE source_id=1");
  const moving = market(shrunk);
  const drift = (await tick(sql, { search: async (query) => { const r = await moving.search(query); return query === BASE ? { ...r, total: r.total + 3 } : r; } }, { limits: { maxDelistShare: 1 } })).sweep;
  assert.equal(drift.complete, true);
  assert.equal(drift.gone, 11);

  // Brake: a sweep that would expire more than the allowed share expires nothing.
  sqlite.exec("UPDATE offer_identities SET last_seen_at=datetime('now','-1 hour'), expires_at=datetime('now','+1 day') WHERE source_id=1");
  const braked = (await tick(sql, market(listings.slice(0, 40)))).sweep;
  assert.equal(braked.complete, true);
  assert.equal(braked.gone, 0, "51 of 91 unseen is far beyond 5%");
  assert.equal(count(sqlite, "expires_at > datetime('now')"), 91);
});

test("a size band packed back to [0, ∞) splits into the size bands again", () => {
  const parts = splitLeaf({ lo: 989, hi: 990, slo: 0, shi: null });
  assert.ok(Array.isArray(parts) && parts.length > 1);
  assert.equal(coversWholeMarket([{ lo: 0, hi: 989 }, ...parts, { lo: 990, hi: null }]), true);
});

test("whole-market check: price ranges and size bands must leave no gap", () => {
  assert.equal(coversWholeMarket(initialLeaves()), true);
  assert.equal(coversWholeMarket([{ lo: 0, hi: 600 }, { lo: 600, hi: null }]), true);
  assert.equal(coversWholeMarket([{ lo: 0, hi: 600 }, { lo: 700, hi: null }]), false, "gap 600..700");
  assert.equal(coversWholeMarket([{ lo: 0, hi: 600 }]), false, "no open top");
  const bands = [[0, 30], [30, 40], [40, 50], [50, 65], [65, 80], [80, null]].map(([slo, shi]) => ({ lo: 600, hi: 601, slo, shi }));
  assert.equal(coversWholeMarket([{ lo: 0, hi: 600 }, ...bands, { lo: 601, hi: null }]), true);
  assert.equal(coversWholeMarket([{ lo: 0, hi: 600 }, ...bands.slice(1), { lo: 601, hi: null }]), false, "size band 0..30 missing");
});

test("a sweep spread over several ticks resumes and delists only after the last tick", async () => {
  const { sqlite, sql } = database();
  const listings = Array.from({ length: 400 }, (_, i) => listing(i + 1, 300 + i * 4));
  const m = market(listings);
  const small = { limits: { stepCalls: 6, fetchBudget: 20, maxDelistShare: 1 } };
  const ticks = [];
  for (let i = 0; i < 40; i++) {
    const result = (await tick(sql, m, small)).sweep;
    ticks.push(result);
    if (result.finished) break;
    assert.equal(result.gone, undefined, "no delisting while the sweep is unfinished");
    assert.ok(result.fetches <= 20 + 8 + 3, "stays near the per-invocation fetch budget: " + result.fetches);
  }
  assert.ok(ticks.length > 2, "the sweep needed several ticks");
  const last = ticks.at(-1);
  assert.equal(last.finished, true);
  assert.equal(last.complete, true);
  assert.equal(last.found, 400);
  assert.equal(last.gone, 0);
  assert.equal(count(sqlite, "expires_at > datetime('now')"), 400);

  // Next sweep reuses the finished plan and, split over ticks again, delists the 20 vanished offers at its end.
  sqlite.exec("UPDATE offer_identities SET last_seen_at=datetime('now','-1 hour') WHERE source_id=1");
  const shrunk = market(listings.slice(20));
  let final = null;
  for (let i = 0; i < 40 && !final; i++) {
    const result = (await tick(sql, shrunk, small)).sweep;
    if (result.finished) final = result; else assert.equal(count(sqlite, "expires_at <= datetime('now')"), 0, "nothing expires mid-sweep");
  }
  assert.equal(final.complete, true);
  assert.equal(final.gone, 20);
});

test("a sweep that outlives its window cannot delist, but keeps the refined plan", async () => {
  const { sqlite, sql } = database();
  const listings = Array.from({ length: 120 }, (_, i) => listing(i + 1, 300 + i * 10));
  const m = market(listings);
  const small = { limits: { stepCalls: 6, fetchBudget: 14 } };
  const startedFirst = await tick(sql, m, small);
  assert.equal(startedFirst.sweep.finished, false);
  // Age the unfinished sweep beyond the 30 minute window.
  const stored = JSON.parse(sqlite.prepare("SELECT leaves FROM immoscout_sweep_plans WHERE source_id=1").get().leaves);
  stored.sweep.startedAt -= 31 * 60_000;
  sqlite.prepare("UPDATE immoscout_sweep_plans SET leaves=? WHERE source_id=1").run(JSON.stringify(stored));
  sqlite.exec("UPDATE offer_identities SET last_seen_at=datetime('now','-2 hours') WHERE source_id=1");
  let final = null;
  for (let i = 0; i < 40 && !final; i++) { const r = (await tick(sql, m, small)).sweep; if (r.finished) final = r; }
  assert.equal(final.complete, true, "the restarted sweep itself is complete");
  assert.equal(final.gone, 0, "listings seen in the aged sweep were touched before the restart, none are stale");
  const aged = JSON.parse(sqlite.prepare("SELECT leaves FROM immoscout_sweep_plans WHERE source_id=1").get().leaves);
  assert.ok(aged.leaves.length > 9, "the refined ranges survived as the plan");
});

test("a running tick holds a lease; a second tick of the same source does not start", async () => {
  const { sqlite, sql } = database();
  const m = market(Array.from({ length: 30 }, (_, i) => listing(i + 1, 300 + i * 50)));
  await tick(sql, m);
  sqlite.prepare("UPDATE immoscout_sweep_plans SET leaves=json_set(leaves,'$.lease',?) WHERE source_id=1").run(Date.now() + 60_000);
  const skipped = (await tick(sql, m)).sweep;
  assert.equal(skipped.skipped, "previous_tick_running");
});

test("unchanged offers are only touched; new and changed ones are upserted and matched, coordinates alone are not", async () => {
  const { sqlite, sql } = database();
  const listings = Array.from({ length: 200 }, (_, i) => listing(i + 1, 300 + i * 10));
  const inserts = () => sqlite.prepare("SELECT 1").get(), writes = [];
  const counting = (inner) => Object.assign((...a) => inner(...a), inner, { unsafe: (q, p) => { if (/INSERT INTO housing\.offer_identities/.test(q)) writes.push(/json_each/.test(q) ? JSON.parse(p[1]).length : p.length / 5); return inner.unsafe(q, p); } });
  const csql = counting(sql);
  // Baseline: silent, nothing queued even though everything is new.
  const baseline = (await tick(csql, market(listings))).sweep;
  assert.equal(baseline.baseline, true);
  assert.equal(baseline.queuedOffers, 0, "the first inventory creates no delivery backlog");
  assert.equal(count(sqlite, "json_extract(facts,'$.sweep_type')='Wohnung'"), 200);

  // Steady state: unchanged offers are touched in bulk, not upserted.
  writes.length = 0;
  const steady = (await tick(csql, market(listings))).sweep;
  assert.equal(steady.baseline, false, "a finished sweep ends the baseline");
  assert.equal(writes.length, 0, "no row upserts for unchanged offers");
  assert.equal(steady.touched, 200);
  assert.ok(steady.queuedOffers <= 60, "only the rotating slice is matched");
  assert.ok(steady.d1_queries < 20, "200 offers cost a handful of D1 queries: " + steady.d1_queries);

  // A new offer, a price change and a coordinate fill.
  const changed = [...listings, listing(900, 450)];
  changed[0].entry.totalRent += 50;
  const withCoords = market(changed);
  const mapped = async () => ({ entries: [{ ...entry(2, 310), address: { city: "Hamburg", postcode: "20095", coordinates: { lat: 53.5, lng: 10 } } }] });
  writes.length = 0;
  const third = (await tick(csql, withCoords, { map: mapped })).sweep;
  assert.equal(writes.reduce((a, b) => a + b, 0), 3, "new + changed + coordinates are upserted");
  assert.ok(third.queuedOffers >= 2, "new and changed offers are matched");
  const coordinateOnly = JSON.parse(sqlite.prepare("SELECT facts FROM offer_identities WHERE external_id='2'").get().facts);
  assert.equal(coordinateOnly.latitude, 53.5);
});

test("beyond the D1 budget new offers wait and known ones are only touched", async () => {
  const { sqlite, sql } = database();
  const listings = Array.from({ length: 80 }, (_, i) => listing(i + 1, 300 + i * 10));
  await tick(sql, market(listings));
  sqlite.exec("UPDATE offer_identities SET last_seen_at=datetime('now','-1 hour')");
  const grown = listings.map(l => ({ ...l, entry: { ...l.entry, totalRent: l.entry.totalRent + 10 } }));
  grown.push(listing(901, 700), listing(902, 710));
  const tight = (await tick(sql, market(grown), { limits: { d1Soft: 3 } })).sweep;
  assert.equal(tight.deferred, 80, "known offers with new facts are touched only");
  assert.equal(tight.skipped, 2, "unknown offers are left for the next sweep");
  assert.equal(count(sqlite, "expires_at > datetime('now')"), 80);
  assert.equal(count(sqlite, "last_seen_at > datetime('now','-1 minute')"), 80, "touched offers stay alive");
});

test("Berlin and Schleswig-Holstein sweep their own region query", async () => {
  for (const [id, region, city, postcode] of [[72, "Berlin", "Berlin", "10115"], [69, "Schleswig-Holstein", "Kiel", "24103"]]) {
    const { sqlite, sql } = database();
    sqlite.prepare("INSERT OR IGNORE INTO source_registry(id,name,family,connector) VALUES(?,?,?,?)").run(id, "Scout " + id, "immoscout24", "test");
    const queries = [];
    const search = async (query) => {
      queries.push(query);
      const entries = Array.from({ length: 5 }, (_, i) => ({ ...entry(id * 1000 + i, 500 + i), address: { city, postcode } }));
      return { total: 5, entries };
    };
    const result = (await tick(sql, { search }, {}, { id, family: "immoscout24", central_auto_apply_enabled: false })).sweep;
    assert.ok(queries.every(q => q.startsWith(`Wohnung mieten in ${region}`)), region);
    assert.equal(result.found, 5);
    assert.equal(count(sqlite, "1=1", id), 5);
  }
});

test("the initial plan covers every price from 0 upwards without gaps", () => {
  const leaves = initialLeaves();
  assert.equal(leaves[0].lo, 0);
  assert.equal(leaves.at(-1).hi, null);
  for (let i = 1; i < leaves.length; i++) assert.equal(leaves[i].lo, leaves[i - 1].hi);
});

test("room-count leaves of an older stored plan fold back into their price range", () => {
  const legacy = [{ lo: 0, hi: 400, rooms: null }, { lo: 800, hi: 801, rooms: 1 }, { lo: 800, hi: 801, rooms: 2 }, { lo: 800, hi: 801, rooms: 5 }, { lo: 801, hi: 900, rooms: null }];
  assert.deepEqual(dropRoomLeaves(legacy), [{ lo: 0, hi: 400, rooms: null }, { lo: 800, hi: 801 }, { lo: 801, hi: 900, rooms: null }]);
});

function seedProfiles(sqlite, n) {
  const criteria = JSON.stringify({ boroughs: [], wbs_only: false, districts: ["Ganz Hamburg"], is_active: true, min_rooms: 1, min_area_sqm: 20,
    location_mode: "all_hamburg", max_warm_rent: 900, neighborhoods: [], property_types: ["Wohnung"], location_area_codes: [],
    location_state_code: "HH", furnished_preference: "any", require_known_warm_rent: false });
  for (let i = 0; i < n; i++) {
    sqlite.prepare("INSERT INTO participants(id,first_name,last_name,status) VALUES(?,?,?,'active')").run("p" + i, "T", "P" + i);
    sqlite.prepare("INSERT INTO search_profiles(id,participant_id,criteria,active,profile_slot) VALUES(?,?,?,1,1)").run("s" + i, "p" + i, criteria);
    sqlite.prepare("INSERT INTO source_links(search_profile_id,source_id) VALUES(?,1)").run("s" + i);
  }
  sqlite.exec("INSERT OR IGNORE INTO application_queue_cutover(id,enabled_at) VALUES(1,CURRENT_TIMESTAMP)");
}
const deliveries = sqlite => sqlite.prepare("SELECT COUNT(*) n FROM deliveries").get().n;

test("matching has its own D1 allowance: it cannot starve the sweep, and what it cannot afford is carried over", async () => {
  const { sqlite, sql } = database();
  seedProfiles(sqlite, 30);
  const listings = Array.from({ length: 60 }, (_, i) => listing(i + 1, 300 + i * 5));
  const m = market(listings);
  await tick(sql, m); // silent baseline
  assert.equal(deliveries(sqlite), 0);

  // A tiny matching allowance: every unchanged offer picked for re-matching waits in the backlog, the sweep still touches everything.
  const tight = (await tick(sql, m, { limits: { d1Matching: 10, rematchPerTick: 60 } })).sweep;
  assert.equal(tight.touched + tight.inserted >= 60, true, "the sweep itself is not held back");
  assert.ok(tight.matchQueries <= 10 + 31, "matching stops at its allowance (one offer may overshoot): " + tight.matchQueries);
  const backlog = () => JSON.parse(sqlite.prepare("SELECT leaves FROM immoscout_sweep_plans WHERE source_id=1").get().leaves).rematchBacklog;
  assert.ok(backlog().length > 0, "unaffordable re-matches are remembered");
  const before = deliveries(sqlite);

  // A generous allowance later works the backlog off first.
  const roomy = (await tick(sql, m, { limits: { d1Matching: 5000, rematchPerTick: 60 } })).sweep;
  assert.equal(backlog().length, 0, "the backlog is drained");
  assert.ok(deliveries(sqlite) > before, "carried-over offers were matched");
  assert.ok(roomy.matchQueries > tight.matchQueries);
});

test("a new offer is never stored without its matching: with no matching allowance it waits for the next sweep", async () => {
  const { sqlite, sql } = database();
  seedProfiles(sqlite, 5);
  const listings = Array.from({ length: 30 }, (_, i) => listing(i + 1, 300 + i * 5));
  await tick(sql, market(listings));
  const grown = [...listings, listing(901, 420)];
  const none = (await tick(sql, market(grown), { limits: { d1Matching: 0 } })).sweep;
  assert.equal(none.skipped, 1);
  assert.equal(count(sqlite, "external_id='901'"), 0, "not stored, so it is still new next time");
  const later = (await tick(sql, market(grown))).sweep;
  assert.equal(count(sqlite, "external_id='901'"), 1);
  assert.ok(sqlite.prepare("SELECT COUNT(*) n FROM deliveries d JOIN offer_identities o ON o.id=d.offer_identity_id WHERE o.external_id='901'").get().n > 0, "and it was matched when stored");
  assert.ok(later.queuedOffers >= 1);
});

test("leaf packing: neighbours merge up to 18 offers, never across a gap or over an incomplete leaf, and size bands pack too", () => {
  const done = [
    { lo: 0, hi: 400, total: 9, complete: true }, { lo: 400, hi: 600, total: 8, complete: true },   // 17 -> one leaf
    { lo: 600, hi: 800, total: 2, complete: true },                                                  // 17 + 2 > 18 -> new leaf
    { lo: 800, hi: 900, total: 3, complete: true }, { lo: 900, hi: 1000, total: 4, complete: false }, // incomplete stays apart
    { lo: 1000, hi: 1200, total: 1, complete: true }, { lo: 1300, hi: 1400, total: 1, complete: true }, // gap 1200..1300
    { lo: 2000, hi: 2001, slo: 0, shi: 30, total: 9, complete: true }, { lo: 2000, hi: 2001, slo: 30, shi: 40, total: 9, complete: true },
    { lo: 2000, hi: 2001, slo: 40, shi: 50, total: 9, complete: true },
  ];
  const packed = mergeLeaves(done);
  assert.deepEqual(packed.map(l => [l.lo, l.hi, l.slo ?? null, l.shi ?? null]), [
    [0, 600, null, null], [600, 900, null, null], [900, 1000, null, null], [1000, 1200, null, null], [1300, 1400, null, null],
    [2000, 2001, 0, 40], [2000, 2001, 40, 50],
  ]);
  assert.equal(packed[0].total, 17);
  assert.ok(packed.every(l => l.total == null || l.total <= 18 || !l.complete));
  assert.ok(mergeLeaves(done, 10).length > packed.length, "a larger pack target means fewer leaves");
});

test("a packed plan is reused with fewer calls; leaves that grew past a page re-split and nothing is lost", async () => {
  const listings = Array.from({ length: 400 }, (_, i) => listing(i + 1, 300 + i * 4));
  const first = await sweepLeaves({ search: market(listings).search, base: BASE, sleep: noSleep });
  assert.equal(first.complete, true);
  const plan10 = mergeLeaves(first.done, 10), plan18 = mergeLeaves(first.done, 18);
  assert.ok(plan18.length < plan10.length && plan18.length <= Math.ceil(400 / 9) + 2, `${plan18.length} leaves vs ${plan10.length}`);

  // Same market: the packed plan is complete in fewer calls.
  const m = market(listings);
  const again = await sweepLeaves({ search: m.search, base: BASE, leaves: plan18, sleep: noSleep });
  assert.equal(again.complete, true);
  assert.equal(again.entries.size, 400);
  assert.equal(again.calls, plan18.length);

  // 60 new offers land in one packed leaf: it exceeds a page, splits again, and every listing is still found.
  const grown = [...listings, ...Array.from({ length: 60 }, (_, i) => listing(1000 + i, 700 + (i % 3), 2, 20 + i * 2))];
  const regrown = await sweepLeaves({ search: market(grown).search, base: BASE, leaves: plan18, sleep: noSleep });
  assert.equal(regrown.complete, true);
  assert.equal(regrown.entries.size, 460);
  assert.ok(regrown.calls > plan18.length, "the overflowing leaf was split");
});
