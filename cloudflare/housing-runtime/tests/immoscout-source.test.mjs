import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { normalizeImmoScoutEntry, parseMcpToolResult, germanImmoScoutQuery, fetchImmoScoutSource, fetchImmoScoutMap, ingestImmoScoutSource, planImmoScoutQueries, parseMcpEnvelope, chooseImmoScoutQuery, chooseHamburgCoverageQuery, hamburgCoverageQueries, berlinCoverageQueries, resetMcpSession } from "../src/immoscout-source.js";
import { sourceForId } from "../src/source-allowlist.js";

beforeEach(() => resetMcpSession());

function mockMcpLifecycle(payload, { protocolVersion = "2025-06-18", sessionId = null } = {}) {
  if (payload.method === "initialize") {
    return new Response(JSON.stringify({
      jsonrpc: "2.0", id: payload.id,
      result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "is24-app-in-chatgpt", version: "0.1.0" } },
    }), { headers: sessionId ? { "mcp-session-id": sessionId } : {} });
  }
  if (payload.method === "notifications/initialized") return new Response(null, { status: 202 });
  return null;
}


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
    const lifecycle = mockMcpLifecycle(payload);
    if (lifecycle) return lifecycle;
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
    const lifecycle = mockMcpLifecycle(payload);
    if (lifecycle) return lifecycle;
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

test("Berlin MCP stays separate from Hamburg and Schleswig-Holstein", () => {
  const berlin = sourceForId(72);
  assert.equal(berlin.name, "ImmobilienScout24 Berlin");
  assert.match(germanImmoScoutQuery(berlin), /Berlin, Deutschland/);
  assert.equal(normalizeImmoScoutEntry({
    exposedId: "801", exposeUrl: "https://www.immobilienscout24.de/expose/801",
    title: "Wohnung in Prenzlauer Berg",
    address: { city: "Berlin", quarter: "Prenzlauer Berg",
      postcode: "10405", coordinates: { lat: 52.53, lng: 13.42 } },
  }, 72, "Wohnung").facts.latitude, 52.53);
  assert.equal(normalizeImmoScoutEntry({
    exposedId: "802", exposeUrl: "https://www.immobilienscout24.de/expose/802",
    address: { city: "Potsdam", coordinates: { lat: 52.4, lng: 13.06 } },
  }, 72), null);
  assert.equal(normalizeImmoScoutEntry({
    exposedId: "803", exposeUrl: "https://www.immobilienscout24.de/expose/803",
    address: { city: "Berlin" },
  }, 1), null);
  assert.equal(normalizeImmoScoutEntry({
    exposedId: "804", exposeUrl: "https://www.immobilienscout24.de/expose/804",
    address: { city: "Berlin", postcode: "10405" },
  }, 69), null);
  assert.deepEqual(planImmoScoutQueries(berlin, [
    { property_types: ["Wohnung"], location_mode: "all_berlin" },
    { property_types: ["Wohnung"], location_mode: "berlin_boroughs",
      berlin_boroughs: ["Pankow", "Neukölln"] },
    { property_types: ["Haus"], location_mode: "berlin_localities",
      berlin_localities: ["Prenzlauer Berg", "Kreuzberg"] },
    { property_types: ["Wohnung"], location_mode: "all_hamburg" },
  ]), [
    "Wohnungen zur Miete in Berlin",
    "Wohnungen zur Miete in Berlin-Pankow",
    "Wohnungen zur Miete in Berlin-Neukölln",
    "Häuser zur Miete in Berlin-Prenzlauer Berg",
    "Häuser zur Miete in Berlin-Kreuzberg",
  ]);
});

test("Berlin 36 borough/rent partitions rotate independently from profile queries", () => {
  const coverage = berlinCoverageQueries();
  assert.equal(coverage.length, 36);
  assert.equal(new Set(coverage).size, 36);
  const q = ["Wohnungen zur Miete in Berlin", "Wohnungen zur Miete in Berlin-Prenzlauer Berg"];
  const slot = 5 * 60_000;
  const queries = Array.from({ length: 144 }, (_,i) =>
    chooseHamburgCoverageQuery(q, coverage, i*slot));
  assert.deepEqual(queries.filter((_, i) => i % 4 === 1), coverage);
  assert.equal(queries.filter(q => q === "Wohnungen zur Miete in Berlin").length,36);
  assert.ok(queries.includes(q[1]));
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

test("Hamburg discovery rotates borough/rent partitions and profiles independently without extra MCP requests", () => {
  const broad = "Wohnungen zur Miete in Hamburg";
  const coverage = hamburgCoverageQueries();
  const specific = ["Wohnungen zur Miete in Hamburg-Harburg", "Häuser zur Miete in Hamburg",
    "WG-Zimmer zur Miete in Hamburg-Wandsbek", "Tauschwohnungen in Hamburg"];
  const queries = [broad, ...specific];
  const slot = 5 * 60_000;
  const picks = Array.from({length:coverage.length*4},(_,index)=>
    chooseHamburgCoverageQuery(queries,coverage,index*slot));
  assert.equal(picks.filter(q=>q===broad).length,coverage.length);
  assert.deepEqual(picks.filter((_,i)=>i%4===1),coverage,
    "all 21 fixed geographic partitions are scanned before they repeat");
  assert.ok(specific.every(q=>picks.includes(q)),
    "every active profile query remains scheduled");
  assert.deepEqual(picks.slice(0,8),[broad,coverage[0],specific[0],specific[1],
    broad,coverage[1],specific[2],specific[3]]);
  assert.equal(chooseHamburgCoverageQuery([broad],coverage,2*slot),coverage[0]);
  assert.equal(chooseHamburgCoverageQuery([broad,specific[0]],[],0),broad);
  assert.throws(()=>chooseHamburgCoverageQuery([],coverage),/plan_empty/);
});

test("MCP titles keep WG and exchange homes separate from ordinary apartments", () => {
  const listing=(id,title,type)=>({
    exposedId:id,exposeUrl:"https://www.immobilienscout24.de/expose/"+id,
    title,...(type?{type}:{}),address:{city:"Hamburg"},
  });
  assert.equal(normalizeImmoScoutEntry(listing("901","Tauschwohnung: Biete 2 Zimmer"),1,"Wohnung").facts.property_type,"Tauschwohnung");
  assert.equal(normalizeImmoScoutEntry(listing("902","WG-Zimmer in Hamburg"),1,"Wohnung").facts.property_type,"WG");
  assert.equal(normalizeImmoScoutEntry(listing("903","Wohnen im Doppelhaus"),1,"Wohnung").facts.property_type,"Haus");
  assert.equal(normalizeImmoScoutEntry(listing("904","Mietwohnung"),1,"Wohnung").facts.property_type,"Wohnung");
  assert.equal(normalizeImmoScoutEntry(listing("905","Möbliertes Zimmer"),1,"WG").facts.property_type,"WG");
  assert.equal(normalizeImmoScoutEntry(listing("906","2 Zimmer mit Balkon"),1,"Tauschwohnung").facts.property_type,"Tauschwohnung");
  assert.equal(normalizeImmoScoutEntry(listing("907","Mietobjekt"),1).facts.property_type,undefined);
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
    const lifecycle = mockMcpLifecycle(payload);
    if (lifecycle) return lifecycle;
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

test("Hamburg coverage partitions cover seven boroughs and three rent bands", () => {
  const queries = hamburgCoverageQueries();
  assert.equal(queries.length, 21);
  assert.equal(new Set(queries).size, 21);
  assert.ok(queries.some(query => query.includes("Hamburg-Nord, Deutschland")));
  assert.ok(queries.some(query => query.includes("Hamburg-Mitte, Deutschland")));
  assert.ok(queries.every(query => !query.includes("Hamburg-Hamburg-")));
});

test("scheduled inventory retains every map entry, not the previous 15-extra limit", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    const lifecycle = mockMcpLifecycle(payload);
    if (lifecycle) return lifecycle;
    calls.push(payload.params.name);
    const total = 85;
    const entries = Array.from({ length: payload.params.name === "property_map_de" ? 60 : 20 }, (_, i) => ({
      exposedId: String(300000 + i),
      exposeUrl: "https://www.immobilienscout24.de/expose/" + (300000 + i),
      title: "Moderne Wohnung in Hamburg",
      address: { city: "Hamburg" },
      price: { value: 900 },
    }));
    return Response.json({ jsonrpc: "2.0", id: payload.id,
      result: { structuredContent: { total, entries } } });
  };
  try {
    const result = await fetchImmoScoutSource(sourceForId(1), {
      query: "Wohnungen zur Miete in Hamburg", enrichWithMap: true,
    });
    assert.equal(result.searchCount, 20);
    assert.equal(result.mapCount, 60);
    assert.equal(result.nodes.length, 60);
    assert.equal(result.added, 40);
    assert.ok(result.nodes.every(n => n.facts.property_type === "Wohnung"));
    assert.deepEqual(calls, ["property_search_de", "property_map_de"]);
  } finally { globalThis.fetch = previousFetch; }
});


test("large Scout map subsets use a few D1 batches and one candidate-profile read", async () => {
  const original = globalThis.fetch;
  const writes = [], reads = [], profileReads = [], otherQueries = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    const lifecycle = mockMcpLifecycle(payload);
    if (lifecycle) return lifecycle;
    const count = payload.params.name === "property_search_de" ? 20 : 160;
    const entries = Array.from({ length: count }, (_, index) => ({
      exposedId: String(100000 + index),
      exposeUrl: "https://www.immobilienscout24.de/expose/" + (100000 + index),
      title: "Mietwohnung in Hamburg",
      address: { city: "Kiel", postcode: "24103" },
      price: { value: 800 },
      ...(index === 0 ? { totalRent: null } : {}),
    }));
    return Response.json({ jsonrpc: "2.0", id: payload.id,
      result: { structuredContent: { total: 220, entries } } });
  };
  const sql = async (pieces) => {
    const query = pieces.join("?");
    otherQueries.push(query);
    if (query.includes("SELECT DISTINCT sp.participant_id")) profileReads.push(query);
    return [];
  };
  sql.unsafe = async (query, params) => {
    if (query.includes("SELECT external_id, facts")) { reads.push({ query, params }); return [{
      external_id: "100000",
      facts: JSON.stringify({ warm_rent: 990, property_type: "Wohnung" }),
    }]; }
    if (query.includes("INSERT INTO housing.offer_identities")) {
      writes.push({ query, params });
      const rows = [];
      for (let i = 0; i < params.length; i += 5)
        rows.push({ id: "id-" + params[i+2], external_id: params[i+2] });
      return rows;
    }
    return [];
  };
  try {
    const output = await ingestImmoScoutSource(sql, sourceForId(69), {
      query: "Wohnungen zur Miete in Schleswig-Holstein",
    });
    assert.equal(output.valid, 160);
    assert.equal(output.inserted, 160);
    assert.equal(output.missing_from_response, 60);
    assert.equal(output.previously_known_in_response, 1);
    assert.equal(output.newly_discovered_in_response, 159);
    assert.equal(output.property_types_in_response.Wohnung, 160);
    assert.equal(writes.length, 8, "160 offers should require eight D1 batch writes");
    assert.equal(reads.length, 3, "160 IDs must fit in three bounded D1 lookups");
    assert.ok(reads.every(({params})=>params.length<=100), "D1 bind-variable limit");
    assert.ok(writes.every(({params})=>params.length<=100));
    assert.equal(profileReads.length, 1, "all matches share the same active profile snapshot");
    assert.equal(JSON.parse(writes[0].params[4]).warm_rent, 990,
      "previously verified rent is not lost when a later MCP card omits it");
    assert.ok(writes.every(({query})=>query.includes("ON CONFLICT (identity_hash)")));
  } finally { globalThis.fetch = original; }
});


test("targeted Hamburg Scout searches queue consented complete-profile AutoApply just like broad searches", async () => {
  const originalFetch = globalThis.fetch;
  const queued = [];
  const completeProfile = {
    first_name: "Test", last_name: "Person", email: "test@example.com",
    phone: "+49123456789", street: "Testweg", house_number: "7",
    postcode: "20095", city: "Hamburg", salutation: "MS",
    household_type: "SINGLE", employment_status: "EMPLOYEE",
    income_range: "1000_1500", pets: "NO",
    move_in_preference: "FLEXIBLE", schufa_status: "NOT_SPECIFIED",
  };
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    const lifecycle = mockMcpLifecycle(payload);
    if (lifecycle) return lifecycle;
    return Response.json({ jsonrpc: "2.0", id: payload.id,
      result: { structuredContent: {
        total: 1, entries: [{
          exposedId: "172800001",
          exposeUrl: "https://www.immobilienscout24.de/expose/172800001",
          title: "Wohnung in Hamburg-Altona",
          address: { city: "Hamburg", postcode: "22765" },
          price: { value: 850 }, totalRent: 1000, rooms: 2, size: 51,
        }],
      } },
    });
  };
  const sql = async (parts, ...values) => {
    const statement = parts.join("?");
    if (statement.includes("SELECT DISTINCT sp.participant_id")) return [{
      participant_id: "test-owner", profile_slot: 1,
      criteria: JSON.stringify({ property_types: ["Wohnung"],
        location_mode: "all_hamburg", max_warm_rent: 1200 }),
      applicant_profile: JSON.stringify(completeProfile),
      telegram_user_id: 8538226539,
      test_auto_apply_allowed: 1, test_auto_apply_enabled: 1,
      test_auto_apply_enabled_at: new Date(Date.now() - 10_000).toISOString(),
      auto_apply_enabled: 0, immoscout_enabled: 1,
      preferences_enabled: 0,
    }];
    if (statement.includes("SELECT i.first_seen_at")) return [{
      first_seen_at: new Date(Date.now() - 86_400_000).toISOString(),
      enabled_at: new Date(Date.now() - 120_000).toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    }];
    if (statement.includes("INSERT INTO housing.deliveries")) return [{ id: "delivery" }];
    if (statement.includes("INSERT INTO housing.applications")) {
      queued.push({ statement, values });
      return [{ id: "application" }];
    }
    return [];
  };
  sql.unsafe = async (statement) => {
    if (statement.includes("SELECT external_id, facts")) return [];
    if (statement.includes("INSERT INTO housing.offer_identities"))
      return [{ id: "offer", external_id: "172800001" }];
    return [];
  };
  try {
    for (const query of [
      "Wohnungen zur Miete in Hamburg",
      hamburgCoverageQueries()[3],
    ]) {
      const before = queued.length;
      const result = await ingestImmoScoutSource(sql, sourceForId(1), { query });
      assert.equal(result.valid, 1);
      assert.equal(queued.length, before + 1, query + " must attempt test AutoApply");
      assert.equal(result.coverage_partition, query !== "Wohnungen zur Miete in Hamburg");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("map outage does not prevent search-only delivery preparation", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    const lifecycle = mockMcpLifecycle(payload);
    if (lifecycle) return lifecycle;
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
    const lifecycle = mockMcpLifecycle(payload);
    if (lifecycle) return lifecycle;
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
      const expected = planImmoScoutQueries(source, [
        { property_types: ["Wohnung"], location_mode: "boroughs", boroughs: ["Harburg"] },
        { property_types: ["Wohnung"], location_mode: "schleswig_holstein_areas", location_area_codes: ["01060"] },
      ], [{ area_code: "01060", name: "Segeberg", area_type: "county" }]);
      if (source.id === 1) expected.push(...hamburgCoverageQueries());
      assert.ok(expected.includes(out.query), out.query);
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
  const slotMs=5*60_000;
  assert.deepEqual(Array.from({length:8},(_,i)=>chooseImmoScoutQuery(queries,i*slotMs)), [
    queries[0],queries[1],queries[0],queries[2],queries[0],queries[1],queries[0],queries[2],
  ]);
  assert.equal(chooseImmoScoutQuery([queries[0]],1000),queries[0]);
  assert.throws(()=>chooseImmoScoutQuery([]),/plan_empty/);
});


test("one MCP handshake serves concurrent Hamburg and Schleswig-Holstein tool calls", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    requests.push({ method: payload.method, headers: options.headers, params: payload.params });
    assert.equal(options.headers["mcp-protocol-version"], "2025-06-18");
    assert.equal(options.headers["mcp-session-id"], undefined, "stateless server sends no session ID");
    if (payload.method === "initialize") {
      assert.equal(payload.params.protocolVersion, "2025-06-18");
      assert.equal(payload.params.clientInfo.name, "traumwohnung-housing-runtime");
      assert.deepEqual(payload.params.capabilities, {});
    }
    const lifecycle = mockMcpLifecycle(payload);
    if (lifecycle) return lifecycle;
    assert.equal(payload.method, "tools/call");
    return Response.json({ jsonrpc: "2.0", id: payload.id, result: { structuredContent: { entries: [], total: 0 } } });
  };
  try {
    await Promise.all([
      fetchImmoScoutSource(sourceForId(1)),
      fetchImmoScoutMap(sourceForId(69)),
    ]);
    assert.deepEqual(requests.map(r => r.method),
      ["initialize", "notifications/initialized", "tools/call", "tools/call"]);
    assert.deepEqual(requests.slice(2).map(r => r.params.name), ["property_search_de", "property_map_de"]);
    await fetchImmoScoutSource(sourceForId(69));
    assert.equal(requests.filter(r => r.method === "initialize").length, 1, "one handshake per active isolate");
  } finally {
    globalThis.fetch = previousFetch;
    resetMcpSession();
  }
});

test("MCP session header is propagated and a 404 reinitializes once", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  let attempts = 0;
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    calls.push({ method: payload.method, sessionId: options.headers["mcp-session-id"] || null });
    if (payload.method === "initialize") {
      attempts++;
      return mockMcpLifecycle(payload, { sessionId: attempts === 1 ? "session-old" : "session-new" });
    }
    if (payload.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (options.headers["mcp-session-id"] === "session-old") return new Response("", { status: 404 });
    return Response.json({ jsonrpc: "2.0", id: payload.id, result: { structuredContent: { entries: [], total: 0 } } });
  };
  try {
    const result = await fetchImmoScoutSource(sourceForId(1));
    assert.deepEqual(result.nodes, []);
    await fetchImmoScoutSource(sourceForId(69));
    assert.deepEqual(calls, [
      { method: "initialize", sessionId: null },
      { method: "notifications/initialized", sessionId: "session-old" },
      { method: "tools/call", sessionId: "session-old" },
      { method: "initialize", sessionId: null },
      { method: "notifications/initialized", sessionId: "session-new" },
      { method: "tools/call", sessionId: "session-new" },
      { method: "tools/call", sessionId: "session-new" },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    resetMcpSession();
  }
});

test("unsupported MCP version fails before any tool call", async () => {
  const previousFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    seen.push(payload.method);
    return mockMcpLifecycle(payload, { protocolVersion: "2024-11-05" })
      || Response.json({ jsonrpc: "2.0", id: payload.id, result: { structuredContent: { entries: [], total: 0 } } });
  };
  try {
    await assert.rejects(fetchImmoScoutSource(sourceForId(1)), /immoscout_mcp_protocol_unsupported/);
    assert.deepEqual(seen, ["initialize"]);
  } finally {
    globalThis.fetch = previousFetch;
    resetMcpSession();
  }
});

test("failed initialization is retried on a subsequent request", async () => {
  const previousFetch = globalThis.fetch;
  const seen = [];
  let failFirst = true;
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    seen.push(payload.method);
    if (payload.method === "initialize" && failFirst) {
      failFirst = false;
      return new Response("", { status: 503 });
    }
    return mockMcpLifecycle(payload)
      || Response.json({ jsonrpc: "2.0", id: payload.id, result: { structuredContent: { entries: [], total: 0 } } });
  };
  try {
    await assert.rejects(fetchImmoScoutSource(sourceForId(1)), /immoscout_mcp_http_503/);
    assert.deepEqual((await fetchImmoScoutSource(sourceForId(69))).nodes, []);
    assert.deepEqual(seen, ["initialize", "initialize", "notifications/initialized", "tools/call"]);
  } finally {
    globalThis.fetch = previousFetch;
    resetMcpSession();
  }
});

test("failed initialized notification prevents MCP tool calls", async () => {
  const previousFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    seen.push(payload.method);
    if (payload.method === "notifications/initialized") return new Response("", { status: 401 });
    return mockMcpLifecycle(payload)
      || Response.json({ jsonrpc: "2.0", id: payload.id, result: { structuredContent: { entries: [], total: 0 } } });
  };
  try {
    await assert.rejects(fetchImmoScoutSource(sourceForId(1)), /immoscout_mcp_http_401/);
    assert.deepEqual(seen, ["initialize", "notifications/initialized"]);
  } finally {
    globalThis.fetch = previousFetch;
    resetMcpSession();
  }
});
