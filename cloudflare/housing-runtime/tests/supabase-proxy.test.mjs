import test from "node:test";
import assert from "node:assert/strict";
import { proxySupabaseFunction } from "../src/supabase-proxy.js";

test("edge proxy forwards the bearer token and selected function", async () => {
  const original = globalThis.fetch;
  let called;
  globalThis.fetch = async (url, init) => {
    called = { url: String(url), init };
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await proxySupabaseFunction(
      new Request("https://housing.test/edge/coach?x=1", { method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" }, body: "{}" }),
      { SUPABASE_URL: "https://project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "public-key" },
      "coach",
    );
    assert.equal(response.status, 200);
    assert.equal(called.url, "https://project.supabase.co/functions/v1/coach-api?x=1");
    assert.equal(called.init.headers.get("authorization"), "Bearer test");
    assert.equal(called.init.headers.get("apikey"), "public-key");
  } finally {
    globalThis.fetch = original;
  }
});

