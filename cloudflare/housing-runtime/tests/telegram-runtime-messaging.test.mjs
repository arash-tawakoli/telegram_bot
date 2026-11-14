import test from "node:test";
import assert from "node:assert/strict";
import { configureLegacyRuntime, secretCache, sendCelebration, edit } from "../src/telegram-legacy/runtime.js";

const d1 = { prepare() { throw new Error("database should not be queried"); } };

test("Telegram celebratory fallback only retries a rejected message effect", async () => {
  const originalFetch = globalThis.fetch;
  configureLegacyRuntime({ TELEGRAM_BOT_TOKEN: "test-token" }, d1);
  secretCache.clear();
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return calls.length === 1
      ? Response.json({ ok: false, error_code: 400, description: "Bad Request: MESSAGE_EFFECT_ID_INVALID" }, { status: 400 })
      : Response.json({ ok: true, result: { message_id: 1 } });
  };
  try {
    await sendCelebration(123, "Gratulation");
    assert.equal(calls.length, 2);
    assert.equal(Object.hasOwn(calls[0], "message_effect_id"), true);
    assert.equal(Object.hasOwn(calls[1], "message_effect_id"), false);
  } finally {
    globalThis.fetch = originalFetch;
    secretCache.clear();
  }
});

test("Telegram network errors do not trigger duplicate send/edit fallback messages", async () => {
  const originalFetch = globalThis.fetch;
  configureLegacyRuntime({ TELEGRAM_BOT_TOKEN: "test-token" }, d1);
  secretCache.clear();
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError("network failure"); };
  try {
    await assert.rejects(sendCelebration(123, "Gratulation"), /network failure/);
    await assert.rejects(edit(123, 10, "Neue Nachricht"), /network failure/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    secretCache.clear();
  }
});
