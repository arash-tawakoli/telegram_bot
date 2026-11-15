import test from "node:test";
import assert from "node:assert/strict";
import { normalizeImmoScoutEntry, parseMcpToolResult, germanImmoScoutQuery, fetchImmoScoutSource, fetchImmoScoutMap, ingestImmoScoutSource, planImmoScoutQueries, parseMcpEnvelope, chooseImmoScoutQuery } from "../src/immoscout-source.js";
import { sourceForId } from "../src/source-allowlist.js";

test("ImmoScout MCP entries become minimal offer facts", () => {
  const result = normalizeImmoScoutEntry({
    exposedId: "123",
    exposeUrl: "https://www.immobilienscout24.de/expose/123#details",
    title: "Wohnung Hamburg",
    totalRent: 1200,
    rooms: 2,
    size: 55,
    address: { city: "Hamburg", postcode: "20095" },
  }, 1);
  assert.equal(result.identity, "123");
  assert.equal(result.facts.warm_rent, 1200);
  assert.equal(result.canonical_url, "https://www.immobilienscout24.de/expose/123");
});

test("ImmoScout MCP errors fail closed", () => {
  assert.throws(() => parseMcpToolResult({ result: { isError: true, content: [{ text: "bad" }] } }), /bad/);
  assert.throws(() => parseMcpToolResult({ result: {} }), /immoscout_inventory_unrecognized/);
  assert.throws(() => parseMcpToolResult({ result: { structuredContent: { entries: [], total: null } } }), /immoscout_inventory_unrecognized/);
  assert.throws(() => parseMcpToolResult({ result: { structuredContent: { entries: [], total: 10 } } }), /immoscout_inventory_unrecognized/);
  assert.deepEqual(parseMcpToolResult({ result: { structuredContent: { entries: [], total: 0 } } }), { entries: [], total: 0 });
});

test("missing ImmoScout facts remain unknown rather than becoming zero", () => {
  const result = normalizeImmoScoutEntry({ exposedId: "123", exposeUrl: "https://www.immobilienscout24.de/expose/123", totalRent: null, rooms: "", size: null }, 1);
  assert.equal(result.facts.warm_rent, null);
  assert.equal(result.facts.rooms, null);
  assert.equal(result.facts.area_sqm, null);
});

test("the on-demand Scout MCP actions only support German regions", () => {
  assert.match(germanImmoScoutQuery(sourceForId(1)), /Hamburg, Deutschland/);
  assert.match(germanImmoScoutQuery(sourceForId(69), "maximal 800 Euro"), /Schleswig-Holstein, Deutschland; maximal 800 Euro/);
  assert.throws(() => germanImmoScoutQuery({ id: 999, family: "immoscout24" }), /immoscout_source_not_allowlisted/);
  assert.throws(() => germanImmoScoutQuery(sourceForId(3)), /immoscout_source_not_allowlisted/);
  assert.throws(() => germanImmoScoutQuery(sourceForId(1), "Wohnungen in Wien"), /immoscout_query_invalid/);
  assert.throws(() => germanImmoScoutQuery(sourceForId(1), "in Österreich"), /immoscout_query_invalid/);
  assert.throws(() => germanImmoScoutQuery(sourceForId(1), "x".repeat(181)), /immoscout_query_invalid/);
});

test("the German Scout search and map use distinct MCP tools", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  const entries = [
    {
      exposedId: "123456", exposeUrl: "https://www.immobilienscout24.de/expose/123456",
      title: "Mietwohnung", rooms: 2, size: 54, totalRent: 890,
      address: { city: "Hamburg", postcode: "20095", coordinates: { lat: 53.551, lng: 10.012 } },
      descriptionNote: "Not retained in minimal map results",
    },
    {
      exposedId: "123457", exposeUrl: "https://www.immobilienscout24.de/expose/123457",
      address: { city: "Hamburg", coordinates: { lat: 53.56, lng: 10.04 } },
    },
  ];
  globalThis.fetch = async (url, request) => {
    assert.equal(url, "https://app.chatgpt.immobilienscout24.de/v2/mcp");
    const payload = JSON.parse(request.body);
    calls.push(payload);
    return new Response(JSON.stringify({
      jsonrpc: "2.0", id: payload.id,
      result: { structuredContent: { entries, total: 2 } },
    }), { headers: { "content-type": "application/json" } });
  };
  try {
    const source = sourceForId(1);
    const query = germanImmoScoutQuery(source, "2 Zimmer");
    const search = await fetchImmoScoutSource(source, { query });
    const map = await fetchImmoScoutMap(source, { query, limit: 1 });
    assert.equal(search.nodes.length, 2);
    assert.equal(map.count, 1);
    assert.equal(map.total, 2);
    assert.equal(map.tool, "property_map_de");
    assert.deepEqual([map.points[0].latitude, map.points[0].longitude], [53.551, 10.012]);
    assert.equal(map.points[0].descriptionNote, undefined);
    assert.deepEqual(calls.map((call) => call.params.name), ["property_search_de", "property_map_de"]);
    assert.deepEqual(calls.map((call) => call.params.arguments), [{ query }, { query }]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("the German MCP map drops invalid coordinates and enforces result limits", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, request) => {
    const payload = JSON.parse(request.body);
    return new Response(JSON.stringify({
      jsonrpc: "2.0", id: payload.id, result: { structuredContent: {
        entries: [
          { exposedId: "123456", exposeUrl: "https://www.immobilienscout24.de/expose/123456", address: { coordinates: { lat: 53.55, lng: 10.0 } } },
          { exposedId: "123456", exposeUrl: "https://www.immobilienscout24.de/expose/123456", address: { coordinates: { lat: 53.55, lng: 10.0 } } },
          { exposedId: "123457", exposeUrl: "https://www.immobilienscout24.de/expose/123457", address: { coordinates: { lat: 0, lng: 0 } } },
          { exposedId: "123458", exposeUrl: "https://example.org/expose/123458", address: { coordinates: { lat: 53.5, lng: 10 } } },
          { exposedId: "123459", exposeUrl: "https://www.immobilienscout24.de/expose/123459", address: { city: "München", coordinates: { lat: 48.14, lng: 11.58 } } },
          { exposedId: "123460", exposeUrl: "https://www.immobilienscout24.de/expose/123460", address: { countryCode: "AT", coordinates: { lat: 53.55, lng: 10 } } },
          { exposedId: "123461", exposeUrl: "https://www.immobilienscout24.de/expose/123461", address: { city: "Wien", coordinates: { lat: 48.21, lng: 16.37 } } },
        ], total: 7,
      } },
    }), { headers: { "content-type": "application/json" } });
  };
  try {
    await assert.rejects(fetchImmoScoutMap(sourceForId(1), { limit: 0 }), /immoscout_limit_invalid/);
    await assert.rejects(fetchImmoScoutMap(sourceForId(1), { limit: 201 }), /immoscout_limit_invalid/);
    await assert.rejects(fetchImmoScoutMap(sourceForId(3)), /immoscout_source_not_allowlisted/);
    const result = await fetchImmoScoutMap(sourceForId(1), { limit: 100 });
    assert.equal(result.count, 1);
    assert.equal(result.points[0].id, "123456");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Schleswig-Holstein map accepts northern coordinates but rejects Austria", () => {
  const valid = normalizeImmoScoutEntry({
    exposedId: "333333", exposeUrl: "https://www.immobilienscout24.de/expose/333333",
    address: { city: "Kiel", countryCode: "DE", coordinates: { lat: 54.323, lng: 10.139 } },
  }, 69);
  assert.equal(valid.facts.latitude, 54.323);
  const crossBorder = normalizeImmoScoutEntry({
    exposedId: "444444", exposeUrl: "https://www.immobilienscout24.de/expose/444444",
    address: { countryCode: "AT", coordinates: { lat: 54.323, lng: 10.139 } },
  }, 69);
  assert.equal(crossBorder, null, "foreign-country offers are excluded before the matching pipeline");
});


test("unified query planner applies identical logic to Hamburg and Schleswig-Holstein", () => {
  const hamburg = sourceForId(1), schleswig = sourceForId(69);
  const profiles = [
    { property_types: ["Wohnung"], location_mode: "all_hamburg" },
    { property_types: ["Wohnung"], location_mode: "boroughs", boroughs: ["Harburg"] },
    { property_types: ["Wohnung"], location_mode: "neighborhoods", neighborhoods: ["Eidelstedt"] },
    { property_types: ["Haus"], location_mode: "all_hamburg" },
    { property_types: ["Wohnung"], location_mode: "schleswig_holstein_areas", location_area_codes: ["01060","01002"] },
    { property_types: ["Haus"], location_mode: "all_schleswig_holstein" },
  ];
  const areas = [
    { area_code: "01060", name: "Segeberg", area_type: "county" },
    { area_code: "01002", name: "Kiel", area_type: "independent_city" },
  ];
  assert.deepEqual(planImmoScoutQueries(hamburg, profiles, areas), [
    "Wohnungen zur Miete in Hamburg",
    "Wohnungen zur Miete in Hamburg-Harburg",
    "Wohnungen zur Miete in Hamburg-Eidelstedt",
    "Häuser zur Miete in Hamburg",
  ]);
  assert.deepEqual(planImmoScoutQueries(schleswig, profiles, areas), [
    "Wohnungen zur Miete in Schleswig-Holstein",
    "Wohnungen zur Miete im Kreis Segeberg",
    "Wohnungen zur Miete in Kiel",
    "Häuser zur Miete in Schleswig-Holstein",
  ]);
  assert.deepEqual(planImmoScoutQueries(schleswig, [
    { property_types: ["Wohnung"], location_mode: "schleswig_holstein_areas", location_area_codes: ["nonexistent"] },
  ]), ["Wohnungen zur Miete in Schleswig-Holstein"], "missing geographic data falls back to a broad query");
  assert.throws(() => planImmoScoutQueries(sourceForId(3), profiles), /not_allowlisted/);
});

test("SSE progress events cannot replace the correlated JSON-RPC tool result", () => {
  const notification = JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 0.5 } });
  const response = JSON.stringify({ jsonrpc: "2.0", id: "expected", result: { structuredContent: { entries: [], total: 0 } } });
  const stream = "event: message\ndata: " + notification + "\n\nevent: message\ndata: " + response + "\n\n";
  assert.equal(parseMcpEnvelope(stream, "expected").id, "expected");
  assert.throws(() => parseMcpEnvelope(stream, "different"), /response_invalid/);
  assert.throws(() => parseMcpEnvelope("data: not-json\n\n", "expected"), /sse_invalid/);
  assert.deepEqual(parseMcpEnvelope(response, "expected").result.structuredContent, { entries: [], total: 0 });
});

test("both regions share bounded search + map enrichment with stable IDs and correct warm rent", async () => {
  const original = globalThis.fetch;
  const calls = [];
  const e = (id, city, cold, warm, coords) => ({
    exposedId: id, exposeUrl: "https://www.immobilienscout24.de/expose/" + id,
    title: "Wohnung in " + city, address: { city, postcode: city === "Kiel" ? "24105" : "20095", ...(coords ? { coordinates: coords } : {}) },
    price: { value: cold }, ...(warm == null ? {} : { totalRent: warm }),
  });
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    calls.push({ method: payload.params.name, query: payload.params.arguments.query });
    const city = payload.params.arguments.query.includes("Schleswig-Holstein") ? "Kiel" : "Hamburg";
    const entries = payload.params.name === "property_search_de"
      ? [e("123", city, 800, null), e("124", city, 900, 1100)]
      : [e("123", city, 800, 1030, { lat: city === "Kiel" ? 54.3 : 53.56, lng: 10.02 }),
        e("124", city, 900, 1100), e("125", city, 650, 770), e("126", "Wien", 200, 250)];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { structuredContent: { total: entries.length, entries } } }), { headers: { "content-type": "application/json" } });
  };
  try {
    for (const source of [sourceForId(1), sourceForId(69)]) {
      const result = await fetchImmoScoutSource(source, { enrichWithMap: true, maxMapExtras: 1 });
      assert.equal(result.searchCount, 2);
      assert.equal(result.mapCount, 4);
      assert.equal(result.added, 1);
      assert.equal(result.enriched, 1);
      assert.equal(result.nodes.length, 3);
      assert.equal(result.nodes.find(n => n.identity === "123").facts.warm_rent, 1030);
      assert.equal(result.nodes.find(n => n.identity === "123").facts.cold_rent, 800);
      assert.equal(result.nodes.find(n => n.identity === "123").facts.latitude, source.id === 1 ? 53.56 : 54.3);
      assert.ok(result.nodes.every(n => n.source_id === source.id));
    }
    assert.deepEqual(calls.map(c => c.method), ["property_search_de","property_map_de","property_search_de","property_map_de"]);
    assert.equal(calls[0].query, calls[1].query);
    assert.equal(calls[2].query, calls[3].query);
  } finally { globalThis.fetch = original; }
});

test("map outage does not prevent search-only delivery preparation", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    const result = payload.params.name === "property_map_de"
      ? { isError: true, content: [{ text: "map temporarily unavailable" }] }
      : { structuredContent: { total: 1, entries: [{ exposedId: "100", exposeUrl: "https://www.immobilienscout24.de/expose/100", title: "Wohnung in Hamburg", address: { city: "Hamburg" }, price: { value: 500 } }] } };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }));
  };
  try {
    const result = await fetchImmoScoutSource(sourceForId(1), { enrichWithMap: true });
    assert.equal(result.nodes.length, 1);
    assert.equal(result.nodes[0].facts.warm_rent, null);
    assert.match(result.map_error, /temporarily unavailable/);
  } finally { globalThis.fetch = previous; }
});

test("scheduled ingestion uses the same profile-driven pipeline in both regions", async () => {
  const previous = globalThis.fetch, calls = [];
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    calls.push({ method: payload.params.name, query: payload.params.arguments.query });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: { structuredContent: { entries: [], total: 0 } } }));
  };
  const sql = async () => [];
  sql.unsafe = async (statement) => {
    if (statement.includes("search_profiles")) return [
      { criteria: JSON.stringify({ property_types: ["Wohnung"], location_mode: "boroughs", boroughs: ["Harburg"] }) },
      { criteria: JSON.stringify({ property_types: ["Wohnung"], location_mode: "schleswig_holstein_areas", location_area_codes: ["01060"] }) },
    ];
    if (statement.includes("coach_geo_snapshot")) return [{ payload: JSON.stringify({ schleswigHolsteinAreas: [{ area_code: "01060", name: "Segeberg", area_type: "county" }] }) }];
    return [];
  };
  try {
    for (const source of [sourceForId(1), sourceForId(69)]) {
      const out = await ingestImmoScoutSource(sql, source);
      assert.equal(out.inserted, 0);
      assert.equal(out.valid, 0);
      assert.equal(out.map_count, 0);
      assert.ok(planImmoScoutQueries(source, [
        { property_types: ["Wohnung"], location_mode: "boroughs", boroughs: ["Harburg"] },
        { property_types: ["Wohnung"], location_mode: "schleswig_holstein_areas", location_area_codes: ["01060"] },
      ], [{ area_code: "01060", name: "Segeberg", area_type: "county" }]).includes(out.query));
    }
    assert.equal(calls.length, 4);
    for (let i = 0; i < 4; i += 2) {
      assert.equal(calls[i].method, "property_search_de");
      assert.equal(calls[i+1].method, "property_map_de");
      assert.equal(calls[i].query, calls[i+1].query);
    }
  } finally { globalThis.fetch = previous; }
});


test("every other Scout run preserves broad coverage while rotating specific places", () => {
  const queries=["Wohnungen zur Miete in Hamburg","Wohnungen zur Miete in Hamburg-Harburg","Wohnungen zur Miete in Hamburg-Eidelstedt"];
  const slotMs=10*60_000;
  assert.deepEqual(Array.from({length:8},(_,i)=>chooseImmoScoutQuery(queries,i*slotMs)), [
    queries[0],queries[1],queries[0],queries[2],queries[0],queries[1],queries[0],queries[2],
  ]);
  assert.equal(chooseImmoScoutQuery([queries[0]],1000),queries[0]);
  assert.throws(()=>chooseImmoScoutQuery([]),/plan_empty/);
});
