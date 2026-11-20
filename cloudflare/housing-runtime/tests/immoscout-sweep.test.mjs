import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { createD1Client } from "../src/d1-database.js";
import { ingestImmoScoutSweep, sweepLeaves, splitLeaf, leafQuery, mergeLeaves, initialLeaves } from "../src/immoscout-sweep.js";

const BASE = "Wohnung mieten in Hamburg";
const noSleep = async () => {};

// A fake MCP: parses the query like the real server maps it and returns max 20 entries.
function market(listings) {
  const calls = [];
  const search = async (query) => {
    calls.push(query);
    let [, rest] = query.split(", ");
    const price = { lo: 0, hi: Infinity, rooms: null };
    for (const part of query.split(", ").slice(1)) {
      let m;
      if ((m = part.match(/^Kaltmiete bis (\d+) Euro$/))) price.hi = Number(m[1]);
      else if ((m = part.match(/^Kaltmiete (\d+) bis (\d+) Euro$/))) { price.lo = Number(m[1]); price.hi = Number(m[2]); }
      else if ((m = part.match(/^Kaltmiete ab (\d+) Euro$/))) price.lo = Number(m[1]);
      else if ((m = part.match(/^(\d+) Zimmer$/))) price.rooms = Number(m[1]);
    }
    const hits = listings.filter(l => l.price >= price.lo && l.price <= price.hi && (price.rooms == null || l.rooms === price.rooms));
    return { total: hits.length, entries: hits.slice(0, 20).map(l => l.entry) };
  };
  return { search, calls };
}

const entry = (id, price, rooms = 2) => ({
  exposedId: String(id), exposeUrl: `https://www.immobilienscout24.de/expose/${id}`, title: `Wohnung ${id}`,
  type: "APARTMENT_RENT", price: { value: price }, totalRent: price + 100, rooms, size: 50,
  address: { city: "Hamburg", postcode: "20095" },
});
const listing = (id, price, rooms = 2) => ({ price, rooms, entry: entry(id, price, rooms) });

test("leaf queries use the price wording the MCP maps to exact URL filters", () => {
  assert.equal(leafQuery(BASE, { lo: 0, hi: 400 }), `${BASE}, Kaltmiete bis 400 Euro`);
  assert.equal(leafQuery(BASE, { lo: 700, hi: 720 }), `${BASE}, Kaltmiete 700 bis 720 Euro`);
  assert.equal(leafQuery(BASE, { lo: 3000, hi: null }), `${BASE}, Kaltmiete ab 3000 Euro`);
  assert.equal(leafQuery(BASE, { lo: 700, hi: 701, rooms: 2 }), `${BASE}, Kaltmiete 700 bis 701 Euro, 2 Zimmer`);
});

test("bisection overlaps at the midpoint, grows the open top range and falls back to rooms", () => {
  assert.deepEqual(splitLeaf({ lo: 400, hi: 600 }), [{ lo: 400, hi: 500, rooms: null }, { lo: 500, hi: 600, rooms: null }]);
  assert.deepEqual(splitLeaf({ lo: 0, hi: 401 }), [{ lo: 0, hi: 200, rooms: null }, { lo: 200, hi: 401, rooms: null }]);
  assert.deepEqual(splitLeaf({ lo: 3000, hi: null }), [{ lo: 3000, hi: 6000, rooms: null }, { lo: 6000, hi: null, rooms: null }]);
  assert.deepEqual(splitLeaf({ lo: 800, hi: 801 }).map(l => l.rooms), [1, 2, 3, 4, 5]);
  assert.equal(splitLeaf({ lo: 800, hi: 801, rooms: 2 }), null, "nothing narrower than one room count at one price");
  // Every child strictly shrinks, so the recursion cannot loop on the parent.
  for (const parent of [{ lo: 0, hi: 2 }, { lo: 10, hi: 13 }, { lo: 999, hi: 1001 }]) {
    for (const child of splitLeaf(parent)) assert.ok(child.hi - child.lo < parent.hi - parent.lo);
  }
});

test("a sweep finds every listing, including cent rents on a split boundary and equal-price clusters", async () => {
  const listings = [];
  let id = 1;
  for (let i = 0; i < 300; i++) listings.push(listing(id++, 300 + ((i * 37) % 1500)));
  listings.push(listing(id++, 500.5), listing(id++, 400.01), listing(id++, 399.99), listing(id++, 5200), listing(id++, 7000));
  // 30 listings at exactly the same price can only be separated by rooms.
  for (let i = 0; i < 30; i++) listings.push(listing(id++, 800, (i % 5) + 1));
  const { search, calls } = market(listings);
  const sweep = await sweepLeaves({ search, base: BASE, sleep: noSleep });
  assert.equal(sweep.entries.size, listings.length);
  assert.equal(sweep.complete, true);
  assert.equal(sweep.errors, 0);
  assert.ok(calls.some(q => /, \d Zimmer$/.test(q)), "rooms fallback was used");
  assert.ok(calls.some(q => /Kaltmiete ab \d+ Euro/.test(q)));
  assert.ok(calls.length <= 400);
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

  const grown = [...listings, ...Array.from({ length: 40 }, (_, i) => listing(1000 + i, 500 + (i % 3), (i % 5) + 1))];
  const regrown = market(grown);
  const resplit = await sweepLeaves({ search: regrown.search, base: BASE, leaves: reused.leaves, sleep: noSleep });
  assert.equal(resplit.entries.size, grown.length);
  assert.equal(resplit.complete, true);
  assert.ok(resplit.leaves.length > reused.leaves.length, "the crowded leaf became several leaves");
});

test("neighbouring small leaves merge, crowded ones stay apart", () => {
  const leaves = [
    { lo: 0, hi: 400, rooms: null, total: 3, complete: true }, { lo: 400, hi: 600, rooms: null, total: 4, complete: true },
    { lo: 600, hi: 800, rooms: null, total: 18, complete: true }, { lo: 800, hi: null, rooms: null, total: 2, complete: true },
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

test("the call budget stops a runaway sweep and reports it as incomplete", async () => {
  const { search } = market(Array.from({ length: 500 }, (_, i) => listing(i + 1, 300 + i * 3)));
  const sweep = await sweepLeaves({ search, base: BASE, maxCalls: 12, sleep: noSleep });
  assert.equal(sweep.truncated, true);
  assert.equal(sweep.complete, false);
  assert.ok(sweep.calls <= 12);
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
const count = (sqlite, where) => sqlite.prepare(`SELECT COUNT(*) n FROM offer_identities WHERE source_id=1 AND ${where}`).get().n;

test("offers vanish only after a complete sweep; incomplete sweeps expire nothing", async () => {
  const { sqlite, sql } = database();
  const listings = Array.from({ length: 90 }, (_, i) => listing(i + 1, 300 + i * 20));
  const run = (market, extra = {}) => ingestImmoScoutSweep(sql, SOURCE, {
    search: market.search, map: async () => ({ entries: [] }), otherTypes: false, ...extra,
  });

  const first = await run(market(listings));
  assert.equal(first.sweep.complete, true);
  assert.equal(first.sweep.found, 90);
  assert.equal(first.sweep.gone, 0);
  assert.equal(first.sweep.new, 90);
  assert.equal(count(sqlite, "expires_at > datetime('now')"), 90);
  assert.ok(sqlite.prepare("SELECT leaves FROM immoscout_sweep_plans WHERE source_id=1").get(), "leaf plan stored");

  // Pretend the previous sweep happened long ago; ten offers then disappear from the market.
  sqlite.exec("UPDATE offer_identities SET last_seen_at=datetime('now','-1 hour') WHERE source_id=1");
  const shrunk = listings.slice(10);
  const complete = await run(market(shrunk));
  assert.equal(complete.sweep.complete, true);
  assert.equal(complete.sweep.gone, 10);
  assert.equal(count(sqlite, "expires_at > datetime('now')"), 80);

  // An MCP error mid-sweep must never mark anything gone.
  sqlite.exec("UPDATE offer_identities SET last_seen_at=datetime('now','-1 hour'), expires_at=datetime('now','+1 day') WHERE source_id=1");
  const { search } = market(shrunk);
  const broken = await run({ search: async (query) => { if (/Kaltmiete 600 bis/.test(query) || /Kaltmiete bis 400/.test(query)) throw new Error("immoscout_mcp_http_500"); return search(query); } });
  assert.equal(broken.sweep.complete, false);
  assert.equal(broken.sweep.gone, 0);
  assert.equal(count(sqlite, "expires_at > datetime('now')"), 90, "nothing expired after an incomplete sweep");

  // Found count differing from the broad total (here: a search that hides offers) is incomplete too.
  const partial = market(listings);
  const lying = await run({ search: async (query) => { const r = await partial.search(query); return query === BASE ? { ...r, total: r.total + 5 } : r; } });
  assert.equal(lying.sweep.complete, false);
  assert.equal(lying.sweep.gone, 0);
});

test("only new, changed or re-listed offers are matched, plus a bounded rotating slice", async () => {
  const { sqlite, sql } = database();
  const listings = Array.from({ length: 150 }, (_, i) => listing(i + 1, 300 + i * 10));
  const run = () => ingestImmoScoutSweep(sql, SOURCE, { search: market(listings).search, map: async () => ({ entries: [] }), otherTypes: false });
  const first = await run();
  assert.equal(first.sweep.queued_offers, 150, "everything is new on the first sweep");
  const second = await run();
  assert.equal(second.sweep.new, 0);
  assert.ok(second.sweep.queued_offers <= 60, "unchanged offers are not re-matched beyond the rotating slice");
  listings[0].entry.totalRent += 50;
  const third = await run();
  assert.ok(third.sweep.queued_offers >= 1 && third.sweep.queued_offers <= 61);
});

test("the initial plan covers every price from 0 upwards without gaps", () => {
  const leaves = initialLeaves();
  assert.equal(leaves[0].lo, 0);
  assert.equal(leaves.at(-1).hi, null);
  for (let i = 1; i < leaves.length; i++) assert.equal(leaves[i].lo, leaves[i - 1].hi);
});
