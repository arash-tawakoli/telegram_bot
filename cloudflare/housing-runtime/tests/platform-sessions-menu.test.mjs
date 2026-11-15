import test from "node:test";
import assert from "node:assert/strict";
import { configureLegacyRuntime, secretCache } from "../src/telegram-legacy/runtime.js";
import { immomioCallbackFromMessage, platformSessions } from "../src/telegram-legacy/platform-sessions.js";

function fakeD1() {
  return {
    prepare(query) {
      return {
        bind() { return this; },
        async all() {
          if (query.includes("FROM provider_connections")) {
            return { results: [{ provider: "immoscout24", status: "connected" }], meta: { changes: 0 } };
          }
          if (query.includes("FROM participants")) {
            return { results: [{ auto_apply_enabled: 0, test_auto_apply_allowed: 0, test_auto_apply_enabled: 0, test_auto_apply_daily_limit: 0 }], meta: { changes: 0 } };
          }
          return { results: [], meta: { changes: 0 } };
        },
      };
    },
  };
}

test("auto-apply menu only iterates provider adapters that still exist", async () => {
  configureLegacyRuntime({ TELEGRAM_BOT_TOKEN: "test-token" }, fakeD1());
  secretCache.delete("telegram_bot_token_runtime");
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await platformSessions(
      { id: "participant-1", telegram_user_id: 77, chat_id: 77, is_active: true, is_premium: true },
      { id: 77, type: "private" },
      99,
      "platforms",
    );
  } finally {
    globalThis.fetch = originalFetch;
    secretCache.delete("telegram_bot_token_runtime");
  }

  const keyboard = requests[0]?.reply_markup?.inline_keyboard || [];
  const labels = keyboard.flat().map(button => button.text);
  assert.equal(labels.some(text => text.includes("ImmoScout24")), true);
  assert.equal(labels.some(text => text.includes("Immomio")), true);
  assert.equal(labels.some(text => text.includes("Immowelt")), true);
  assert.equal(labels.some(text => text.includes("Kleinanzeigen")), false);
  assert.equal(labels.some(text => text.includes("verbinden")), false);
});

test("Telegram Immomio callback parser accepts the configured redirect URI", () => {
  const callback = "https://tenant.immomio.com/de/auth/login?state=state123&code=code123";
  assert.equal(immomioCallbackFromMessage({ text: callback }), callback);
  assert.equal(immomioCallbackFromMessage({ text: `${callback}.` }), callback);
  assert.equal(immomioCallbackFromMessage({
    text: "https://tenant.immomio.com/assets/manifest.webmanifest?state=state123&code=code123",
  }), null);
});
