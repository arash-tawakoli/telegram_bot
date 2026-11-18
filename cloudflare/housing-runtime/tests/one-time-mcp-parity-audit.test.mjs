import test from "node:test";
import assert from "node:assert/strict";
import { runInternalMcpParityAudit } from "../src/index.js";

test("a one-time internal audit uses the existing source token without outbound credential transfer", async () => {
  const now = Date.now();
  const token = "test-only-internal-source-token";
  const writes = [];
  const env = {
    SOURCE_RUN_TOKEN: token, MCP_PARITY_AUDIT_UNTIL: String(now + 60_000),
    DOCUMENTS: { async put(key, body, options) { writes.push({ key, body: JSON.parse(body), options }); } },
  };
  const requests = [];
  const handler = { async fetch(request) {
    requests.push({
      url: request.url,
      authorization: request.headers.get("authorization"),
      body: await request.json(),
    });
    return Response.json({
      ok: true,
      mcp_contract: { endpoint: "https://app.chatgpt.immobilienscout24.de/v2/mcp",
        protocol: "2025-06-18", searchTool: "property_search_de", mapTool: "property_map_de" },
      comparison: { same_ids: true, filtered_ids: [], unexpected_ids: [],
        search_returned: 20, map_returned: 100, mcp_unique_ids: 102, bot_unique_ids: 102 },
    });
  } };
  assert.equal(await runInternalMcpParityAudit(handler, { ...env, MCP_PARITY_AUDIT_UNTIL: String(now - 1) }, now), false);
  assert.equal(await runInternalMcpParityAudit(handler, env, now), true);
  assert.deepEqual(requests.map(x => x.body.source_id), [1, 69, 72]);
  assert.ok(requests.every(x => x.url.endsWith("/internal/source/mcp-parity")
    && x.authorization === "Bearer " + token));
  assert.equal(await runInternalMcpParityAudit(handler, env, now), false);
  assert.equal(requests.length, 3);
  assert.equal(writes.length, 1, "R2 is used only for the Hamburg audit");
  assert.equal(writes[0].key, "_diagnostics/mcp-hamburg-parity-20261118.json");
  assert.equal(writes[0].body.source_id, 1);
  assert.equal(writes[0].body.same_ids, true);
  assert.equal(writes[0].body.mcp_unique_ids, 102);
  assert.equal(writes[0].body.bot_unique_ids, 102);
  assert.equal(writes[0].body.http_status, 200);
  assert.ok(writes[0].body.checked_at);
  assert.equal(writes[0].body.endpoint, "https://app.chatgpt.immobilienscout24.de/v2/mcp");
  assert.ok(!JSON.stringify(writes[0].body).includes(token),
    "the source authorization token must never be persisted");
});
