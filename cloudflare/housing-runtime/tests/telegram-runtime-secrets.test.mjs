import test from "node:test";
import assert from "node:assert/strict";
import { configureLegacyRuntime, secret, secretCache } from "../src/telegram-legacy/runtime.js";

const d1 = { prepare() { return { async all() { return { results: [], meta: { changes: 0 } }; } }; } };

test("central ImmoScout admin secret uses the Cloudflare binding", async () => {
  configureLegacyRuntime({ CENTRAL_API_SECRET: "test-central-api-secret" }, d1);
  secretCache.delete("immoscout_central_cloudflare_api_secret");
  assert.equal(await secret("immoscout_central_cloudflare_api_secret"), "test-central-api-secret");
  secretCache.delete("immoscout_central_cloudflare_api_secret");
});
