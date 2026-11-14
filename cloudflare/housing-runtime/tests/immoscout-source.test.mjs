import test from "node:test";
import assert from "node:assert/strict";
import { normalizeImmoScoutEntry, parseMcpToolResult, germanImmoScoutQuery, fetchImmoScoutSource, fetchImmoScoutMap } from "../src/immoscout-source.js";
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
  assert.equal(crossBorder.facts.latitude, undefined);
});
