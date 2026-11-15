import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("an unrecognized provider response increments failures and does not mark success", async () => {
  const queries = [], originalFetch = globalThis.fetch;
  let remoteCalls = 0;
  const db = { prepare(query) { queries.push(query); return { bind() { return this; }, async all() {
    if (query.includes("SELECT id, name, connector_config")) return { results: [{ id: 1, name: "Hamburg", connector_config: "{}" }] };
    return { results: [], meta: { changes: 1 } };
  } }; } };
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    if (payload.method === "initialize") return Response.json({
      jsonrpc: "2.0", id: payload.id,
      result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } },
    });
    if (payload.method === "notifications/initialized") return new Response(null, { status: 202 });
    remoteCalls++;
    return Response.json({ jsonrpc: "2.0", id: payload.id, result: { structuredContent: { entries: [], total: null } } });
  };
  try {
    const req = new Request("https://runtime.example/internal/source/run", { method: "POST", headers: { authorization: "Bearer test-source-token", "content-type": "application/json" }, body: JSON.stringify({ source_id: 1 }) });
    assert.equal((await worker.fetch(req, { HOUSING_DB: db, SOURCE_RUN_TOKEN: "test-source-token" })).status, 503);
    assert.ok(remoteCalls > 0, "allowlisted source family must reach the provider client");
    assert.ok(queries.some(query => query.includes("consecutive_failures = COALESCE")));
    assert.equal(queries.some(query => query.includes("SET last_success_at")), false);
  } finally { globalThis.fetch = originalFetch; }
});
