import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { compareImmoScoutMcpIds, resetMcpSession } from "../src/immoscout-source.js";

beforeEach(() => resetMcpSession());

const MCP_ENDPOINT = "https://app.chatgpt.immobilienscout24.de/v2/mcp";
const SOURCE_TOKEN = "test-only-source-token";

function example(id, city, postcode) {
  return { exposedId: id, exposeUrl: "https://www.immobilienscout24.de/expose/" + id,
    title: "Wohnung", address: { city, postcode }, price: { value: 600 } };
}

test("the protected parity probe uses both exact MCP tools and one identical query in all three regions without DB access", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  const sourceCities = new Map([[1, ["Hamburg", "20095"]], [69, ["Kiel", "24103"]], [72, ["Berlin", "10115"]]]);
  const sourceNames = new Map([[1, "Hamburg"], [69, "Schleswig-Holstein"], [72, "Berlin"]]);
  globalThis.fetch = async (url, options) => {
    assert.equal(url, MCP_ENDPOINT);
    assert.equal(options.method, "POST");
    assert.equal(options.headers["mcp-protocol-version"], "2025-06-18");
    assert.equal(options.headers.accept, "application/json, text/event-stream");
    const payload = JSON.parse(options.body);
    if (payload.method === "initialize") {
      return Response.json({ jsonrpc: "2.0", id: payload.id, result: {
        protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mcp" },
      } });
    }
    if (payload.method === "notifications/initialized") return new Response(null, { status: 202 });
    assert.equal(payload.method, "tools/call");
    assert.deepEqual(Object.keys(payload.params.arguments), ["query"]);
    calls.push(payload.params);
    const city = payload.params.arguments.query.includes("Schleswig-Holstein") ? "Kiel" :
      payload.params.arguments.query.includes("Berlin") ? "Berlin" : "Hamburg";
    const postcode = city === "Kiel" ? "24103" : city === "Berlin" ? "10115" : "20095";
    const entries = payload.params.name === "property_search_de"
      ? [example("90001", city, postcode), example("90002", city, postcode)]
      : [example("90002", city, postcode), example("90003", city, postcode)];
    return Response.json({ jsonrpc: "2.0", id: payload.id,
      result: { structuredContent: { total: 5, entries } } });
  };
  try {
    for (const [source_id, [city]] of sourceCities) {
      const query = "Wohnungen zur Miete in " + sourceNames.get(source_id);
      const response = await worker.fetch(new Request("https://housing.example/internal/source/mcp-parity", {
        method: "POST", headers: { authorization: "Bearer " + SOURCE_TOKEN,
          "content-type": "application/json" },
        body: JSON.stringify({ source_id }),
      }), { SOURCE_RUN_TOKEN: SOURCE_TOKEN });
      assert.equal(response.status, 200, city);
      const json = await response.json();
      assert.equal(json.ok, true);
      assert.equal(json.query, query);
      assert.equal(json.mcp_contract.endpoint, MCP_ENDPOINT);
      assert.equal(json.mcp_contract.protocol, "2025-06-18");
      assert.equal(json.mcp_contract.searchTool, "property_search_de");
      assert.equal(json.mcp_contract.mapTool, "property_map_de");
      assert.equal(json.reported_total, 5);
      assert.deepEqual(json.comparison, {
        search_returned: 2, map_returned: 2,
        mcp_unique_ids: 3, bot_unique_ids: 3,
        filtered_ids: [], unexpected_ids: [], same_ids: true,
      });
    }
    assert.equal(calls.length, 6);
    for (let index = 0; index < calls.length; index += 2) {
      assert.deepEqual(calls.slice(index, index + 2).map(x => x.name),
        ["property_search_de", "property_map_de"]);
      assert.equal(calls[index].arguments.query, calls[index + 1].arguments.query);
    }
  } finally { globalThis.fetch = previousFetch; resetMcpSession(); }
});

test("parity identifies region-filtered MCP IDs instead of claiming false equivalence", () => {
  const report = compareImmoScoutMcpIds(["100", "200"], ["200", "300"], [
    { identity: "100" }, { identity: "200" },
  ]);
  assert.equal(report.same_ids, false);
  assert.deepEqual(report.filtered_ids, ["300"]);
  assert.deepEqual(report.unexpected_ids, []);
});

test("parity endpoint rejects unauthorized, non-Scout and invalid query requests before contacting MCP", async () => {
  const originalFetch = globalThis.fetch;
  let outbound = 0;
  globalThis.fetch = async () => { outbound++; throw new Error("must_not_fetch"); };
  const send = (body, auth = SOURCE_TOKEN) => worker.fetch(new Request("https://housing.example/internal/source/mcp-parity", {
    method: "POST",
    headers: { authorization: "Bearer " + auth, "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { SOURCE_RUN_TOKEN: SOURCE_TOKEN });
  try {
    assert.equal((await send({ source_id: 1 }, "incorrect")).status, 401);
    assert.equal((await send({ source_id: 3 })).status, 422);
    assert.equal((await send({ source_id: 1, query: "Houses to buy" })).status, 400);
    assert.equal((await send({ source_id: 1, query: "Wohnungen zur Miete in Hamburg\\nBerlin" })).status, 400);
    assert.equal(outbound, 0);
  } finally { globalThis.fetch = originalFetch; resetMcpSession(); }
});
