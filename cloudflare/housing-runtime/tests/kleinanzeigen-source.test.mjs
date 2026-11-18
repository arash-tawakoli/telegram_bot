import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { fetchKleinanzeigenSource, isWantedAd, snippetsById, KLEINANZEIGEN_QUERIES } from "../src/kleinanzeigen-source.js";
import { listingIdentity } from "../src/delivery-cutover-ledger.js";
import { listingCategory, matchesProfile } from "../src/matching.js";

const ad = (id, title, extra = {}) => ({
  id, title, topAd: false, priorityAd: false,
  image: `https://img.kleinanzeigen.de/api/v1/prod-ads/images/b7/${id}?rule=$_59.JPG`,
  url: `https://www.kleinanzeigen.de/s-anzeige/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/${id}?utm_source=chatgpt.com&utm_medium=organic`,
  price: "950 €", priceEuros: 950, details: "2,0 Zimmer · 56,5 m²", location: "Hamburg Ottensen", lat: 53.55, lon: 9.92, ...extra,
});

function mcpAnswer(categoryId, listings, snippets = {}) {
  const markdown = `Found ${listings.length} listings on Kleinanzeigen:\n\n` + listings.map((l, i) =>
    `${i + 1}. **${l.title}**\n   Price: ${l.priceEuros} EUR\n   ${snippets[l.id] || "Schöne Wohnung."}\n   ![](${l.image})\n   → ${l.url}`).join("\n\n");
  const body = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: markdown }], structuredContent: { categoryId, totalResults: 99, listings }, isError: false } };
  return new Response(`data: ${JSON.stringify(body)}\n\n`, { headers: { "content-type": "text/event-stream" } });
}

function fakeMcp(byCategory, seen = []) {
  return async (url, init) => {
    const { params } = JSON.parse(init.body);
    seen.push(params.arguments.searchCriteria);
    const query = KLEINANZEIGEN_QUERIES.find((q) => q.criteria === params.arguments.searchCriteria);
    const [listings = [], snippets] = byCategory[query.categoryId] || [];
    return mcpAnswer(query.categoryId, listings, snippets);
  };
}

test("wanted ads are dropped, tenant-seeking offers are kept", () => {
  for (const title of ["dringend eine Wohnung gesucht", "Paar sucht 2-3 Zimmer Wohnung", "Wohnungssuche", "1000 Euro Belohnung für 2-Zimmer-Wohnung", "Suchen 3,5 - 5 Zimmer"])
    assert.equal(isWantedAd(title), true, title);
  for (const title of ["Nachmieter gesucht für 2-Zimmer-Wohnung", "Mitbewohnerin gesucht", "Helle 3-Zimmer-Wohnung in Eimsbüttel"])
    assert.equal(isWantedAd(title), false, title);
  assert.equal(isWantedAd("Ruhige Wohnung", "Ich bin 42 Jahre alt und suche dringend eine eigene Wohnung"), true);
  assert.equal(isWantedAd("WG-Zimmer frei", "Wir suchen eine neue Mitbewohnerin für unsere 3er WG"), false);
});

test("the markdown snippets are matched to their ad ids", () => {
  const map = snippetsById("1. **A**\n   Price: 5 EUR\n   Text eins\n   ![](x)\n   → https://www.kleinanzeigen.de/s-anzeige/a/123456\n\n2. **B**\n   Price: 6 EUR\n   Text zwei\n   → https://www.kleinanzeigen.de/s-anzeige/b/654321?utm=1");
  assert.equal(map.get("123456"), "Text eins");
  assert.equal(map.get("654321"), "Text zwei");
});

test("one run searches flats, houses and WG rooms and normalizes Hamburg offers", async () => {
  const seen = [];
  const result = await fetchKleinanzeigenSource({ id: 2 }, fakeMcp({
    203: [[ad(3575847821, "Helle 2-Zimmer-Wohnung mit Balkon"), ad(3575889765, "Ruhige Wohnung", { location: "Hamburg Hummelsbüttel " })],
      { 3575889765: "Ich bin 42 Jahre alt und suche dringend eine eigene Wohnung" }],
    205: [[ad(3573648161, "Design-Villa in Blankenese", { details: undefined, priceEuros: 3995 })]],
    199: [[ad(3575864574, "Möbliertes Zimmer in Hummelsbüttel", { location: "Steilshoop" })]],
  }, seen));
  assert.deepEqual(seen.sort(), KLEINANZEIGEN_QUERIES.map((q) => q.criteria).sort());
  assert.equal(result.fetched, 4);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.outcomes.map((o) => o.outcome), ["stored", "wanted_ad", "stored", "stored"]);
  assert.equal(result.outcomes[1].id, "3575889765");
  const byId = new Map(result.nodes.map((node) => [node.identity, node]));
  const flat = byId.get("3575847821");
  assert.equal(flat.canonical_url, "https://www.kleinanzeigen.de/s-anzeige/helle-2-zimmer-wohnung-mit-balkon/3575847821");
  assert.deepEqual({ ...flat.facts, search_text: undefined }, {
    title: "Helle 2-Zimmer-Wohnung mit Balkon", city: "Hamburg", state_code: "HH", district: "Ottensen", search_text: undefined,
    cold_rent: 950, warm_rent: null, rooms: 2, area_sqm: 56.5, latitude: 53.55, longitude: 9.92, property_type: "Wohnung",
    image_url: "https://img.kleinanzeigen.de/api/v1/prod-ads/images/b7/3575847821?rule=$_59.JPG", provider: "kleinanzeigen",
  });
  assert.equal(listingCategory(flat.facts), "Wohnung");
  assert.equal(listingCategory(byId.get("3573648161").facts), "Haus");
  assert.equal(listingCategory(byId.get("3575864574").facts), "WG");
  assert.equal(byId.get("3575864574").facts.district, "Steilshoop");
  assert.equal(matchesProfile({ property_types: ["Wohnung"], location_mode: "neighborhoods", neighborhoods: ["Ottensen"], max_warm_rent: 1000 }, flat.facts, 2), true);
  assert.equal(matchesProfile({ property_types: ["Wohnung"], location_mode: "all_hamburg", max_warm_rent: 900 }, flat.facts, 2), false);
  assert.equal(listingIdentity(flat.canonical_url), "kleinanzeigen:3575847821");
});

test("a changed category mapping or a broken answer fails the run", async () => {
  await assert.rejects(fetchKleinanzeigenSource({ id: 2 }, async () => mcpAnswer(196, [])), /kleinanzeigen_category_mismatch/);
  await assert.rejects(fetchKleinanzeigenSource({ id: 2 }, async () => new Response("nope", { status: 429 })), /kleinanzeigen_http_429/);
  await assert.rejects(fetchKleinanzeigenSource({ id: 2 }, async () => new Response("data: {\"jsonrpc\":\"2.0\",\"error\":{}}")), /kleinanzeigen_response_invalid/);
});

test("migration 0032 widens source_registry without losing rows or foreign keys", () => {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../schema/d1/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files.filter((f) => f < "0032")) db.exec(readFileSync(new URL(file, dir), "utf8"));
  db.exec(`INSERT OR IGNORE INTO source_registry(id,name,family,connector) VALUES(3,'Immowelt Hamburg','immowelt','html_discovery');
    INSERT INTO participants(id,first_name,last_name) VALUES('p1','A','B');
    INSERT INTO search_profiles(id,participant_id,criteria,active,profile_slot) VALUES('sp1','p1','{}',1,1),('sp2','p1','{}',1,2);
    INSERT INTO source_links VALUES('sp1',3),('sp2',72);
    INSERT INTO offer_identities(id,source_id,identity_hash,canonical_url) VALUES('o1',3,'h1','https://www.immowelt.de/expose/x');
    UPDATE source_registry SET consecutive_failures=4 WHERE id=3;`);
  // D1 runs each migration file inside one transaction.
  db.exec(`BEGIN; ${readFileSync(new URL("0032_kleinanzeigen_source.sql", dir), "utf8")} COMMIT;`);
  assert.equal(db.prepare("SELECT family FROM source_registry WHERE id=2").get().family, "kleinanzeigen");
  assert.equal(db.prepare("SELECT consecutive_failures n FROM source_registry WHERE id=3").get().n, 4);
  assert.deepEqual(db.prepare("SELECT search_profile_id s FROM source_links WHERE source_id=2").all().map((r) => r.s), ["sp1"]);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM scout_coverage_jobs WHERE source_id=72").get().n, 103);
  assert.throws(() => db.exec("INSERT INTO offer_identities(id,source_id,identity_hash,canonical_url) VALUES('o2',999,'h2','x')"), /FOREIGN KEY/);
  assert.throws(() => db.exec("INSERT INTO source_registry(id,name,family,connector) VALUES(98,'x','wg_gesucht','x')"), /CHECK/);
});

test("ingest stores offers through the D1 client and recognizes them on the next run", async () => {
  const { ingestKleinanzeigenSource } = await import("../src/kleinanzeigen-source.js");
  const { createD1Client } = await import("../src/d1-database.js");
  const sqlite = new DatabaseSync(":memory:");
  const dir = new URL("../schema/d1/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file, dir), "utf8"));
  const prepare = (query) => {
    const make = (values) => ({
      all: async () => /^\s*(SELECT|WITH)/i.test(query) || /\bRETURNING\b/i.test(query)
        ? { results: sqlite.prepare(query).all(...values), meta: { changes: 0 } }
        : { results: [], meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } },
      run: async () => ({ meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } }),
      first: async () => sqlite.prepare(query).get(...values) ?? null,
    });
    return { bind: (...values) => make(values), ...make([]) };
  };
  const sql = createD1Client({ prepare, batch: async (s) => Promise.all(s.map((x) => x.all())) });
  const mcp = fakeMcp({ 203: [[ad(3575847821, "Helle 2-Zimmer-Wohnung mit Balkon")]] });
  const first = await ingestKleinanzeigenSource(sql, { id: 2 }, {}, mcp);
  assert.deepEqual(first, { fetched: 1, valid: 1, inserted: 1, skipped: {}, previously_known_in_response: 0 });
  const row = sqlite.prepare("SELECT source_id, identity_hash, external_id, canonical_url, facts FROM offer_identities").get();
  assert.equal(row.identity_hash, "2:external:3575847821");
  assert.equal(JSON.parse(row.facts).district, "Ottensen");
  sqlite.exec("UPDATE offer_identities SET first_seen_at = datetime('now','-1 hour')");
  const second = await ingestKleinanzeigenSource(sql, { id: 2 }, {}, mcp);
  assert.equal(second.previously_known_in_response, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM offer_identities").get().n, 1);
});
