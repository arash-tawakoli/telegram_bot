import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("previews cannot mutate or read production data or run scheduled jobs", async () => {
  const env = { PREVIEW_MODE: "1", HOUSING_DB: { prepare() { throw new Error("database accessed"); } } };
  for (const [method, path] of [["POST", "/edge/auth"], ["POST", "/edge/telegram/webhook"], ["POST", "/edge/stripe/webhook"], ["POST", "/internal/source/run"], ["PUT", "/edge/documents/upload"], ["GET", "/edge/documents/open"], ["GET", "/ready"]]) {
    const response = await worker.fetch(new Request(`https://preview.example${path}`, { method }), env);
    assert.equal(response.status, 403, path);
    assert.deepEqual(await response.json(), { error: "preview_read_only" });
  }
  assert.equal((await worker.fetch(new Request("https://preview.example/health"), env)).status, 200);
  let scheduled = false;
  await worker.scheduled({}, env, { waitUntil() { scheduled = true; } });
  assert.equal(scheduled, false);
});
