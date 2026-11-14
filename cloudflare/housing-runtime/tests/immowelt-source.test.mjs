import test from "node:test";
import assert from "node:assert/strict";
import { fetchImmoweltSource, ingestImmoweltSource } from "../src/immowelt-source.js";
import { matchesProfile } from "../src/matching.js";

test("Immowelt source accepts an explicit empty inventory", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html><body>Keine passenden Angebote</body></html>", { status: 200, headers: { "content-type": "text/html" } });
  try {
    const result = await fetchImmoweltSource({ id: 3, search_url: "https://www.immowelt.de/suche/mieten/wohnung/hamburg" });
    assert.equal(result.fetched, 0);
    assert.equal(result.verified_empty, true);
  } finally { globalThis.fetch = original; }
});

test("Immowelt source fails closed on an unrecognized page", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html><body>unexpected</body></html>", { status: 200 });
  try {
    await assert.rejects(() => fetchImmoweltSource({ id: 3, search_url: "https://www.immowelt.de/suche/mieten/wohnung/hamburg" }), /immowelt_inventory_unrecognized/);
  } finally { globalThis.fetch = original; }
});

test("Immowelt cards retain location and distinguish cold from warm rent", async () => {
  const original = globalThis.fetch;
  const html = '<div id="classified-card-1"><a href="/expose/123" title="Wohnung zur Miete - Hamburg - 1.200 € - 2 Zimmer"></a><span>1.200 € Kaltmiete</span> 2 Zimmer<p>Jenfeld, Hamburg (22045) · 60 m²</p></div><div id="classified-card-2"><a href="https://evil.example/expose/999">Wohnung</a></div>';
  globalThis.fetch = async () => { const r = new Response(html, { status: 200 }); Object.defineProperty(r, 'url', { value: 'https://www.immowelt.de/suche/' }); return r; };
  try {
    const result = await fetchImmoweltSource({ id: 3, search_url: 'https://www.immowelt.de/suche/' });
    assert.equal(result.nodes.length, 1);
    assert.equal(result.nodes[0].facts.city, 'Hamburg');
    assert.equal(result.nodes[0].facts.postal_code, '22045');
    assert.equal(result.nodes[0].facts.cold_rent, 1200);
    assert.equal(result.nodes[0].facts.warm_rent, null);
    assert.match(result.nodes[0].facts.search_text, /Jenfeld/);
    const criteria = { property_types: ['Wohnung'], location_mode: 'neighborhoods', neighborhoods: ['Jenfeld'], max_warm_rent: 1500 };
    assert.equal(matchesProfile(criteria, result.nodes[0].facts, 3), true);
    assert.equal(matchesProfile({ ...criteria, neighborhoods: ['Langenhorn'] }, result.nodes[0].facts, 3), false);
  } finally { globalThis.fetch = original; }
});

test("Immowelt inventory can be stored without queueing match work", async () => {
  const original = globalThis.fetch;
  const html = '<div id="classified-card-1"><a href="/expose/123" title="Wohnung zur Miete - Hamburg - 1.200 € - 2 Zimmer"></a><span>1.200 € Kaltmiete</span> 2 Zimmer<p>Jenfeld, Hamburg (22045) · 60 m²</p></div>';
  globalThis.fetch = async () => { const r = new Response(html, { status: 200 }); Object.defineProperty(r, "url", { value: "https://www.immowelt.de/suche/" }); return r; };
  const calls = [];
  const sql = async (strings) => {
    const query = strings.join("?");
    calls.push(query);
    return query.includes("INSERT INTO housing.offer_identities") ? [{ id: "offer-1" }] : [];
  };
  try {
    const result = await ingestImmoweltSource(sql, { id: 3, search_url: "https://www.immowelt.de/suche/" }, { queue_matches: false });
    assert.equal(result.inserted, 1);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /INSERT INTO housing.offer_identities/);
  } finally { globalThis.fetch = original; }
});

test("Immowelt stores the real card photograph, never the agency logo", async () => {
  const original = globalThis.fetch;
  const html = '<div class="css-card" id="classified-card-1"><img src="https://mms.immowelt.de/logo.jpg?h=50" alt="Agency">'
    + '<a href="/expose/123" title="Wohnung zur Miete - Hamburg - 900 € - 2 Zimmer">Wohnung</a>'
    + '<img src="https://mms.immowelt.de/a/b/c/d/house.jpg?w=626&amp;h=470" loading="lazy"></div>';
  globalThis.fetch = async () => {
    const response = new Response(html, { status: 200 });
    Object.defineProperty(response, "url", { value: "https://www.immowelt.de/suche/" });
    return response;
  };
  try {
    const result = await fetchImmoweltSource({ id: 3, search_url: "https://www.immowelt.de/suche/" });
    assert.equal(result.nodes.length, 1);
    assert.equal(result.nodes[0].facts.image_url,
      "https://mms.immowelt.de/a/b/c/d/house.jpg?w=626&h=470");
  } finally { globalThis.fetch = original; }
});
