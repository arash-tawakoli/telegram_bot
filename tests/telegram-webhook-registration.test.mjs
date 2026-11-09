import test from "node:test";
import assert from "node:assert/strict";
import { ensureTelegramWebhook } from "../cloudflare/housing-runtime/src/index.js";

test("Telegram webhook is registered on the Cloudflare edge with message and callback updates", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestBody = null;
  try {
    globalThis.fetch = async (input, init = {}) => {
      requestUrl = String(input);
      requestBody = JSON.parse(init.body || "{}");
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const result = await ensureTelegramWebhook({
      TELEGRAM_BOT_TOKEN: "test-bot-token",
      TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
    });
    assert.equal(result.ok, true);
    assert.equal(result.url, "https://intern.traumwohnunghamburg.de/edge/telegram/webhook");
    assert.equal(requestUrl, "https://api.telegram.org/botest-bot-token/setWebhook");
    assert.equal(requestBody.url, result.url);
    assert.equal(requestBody.secret_token, "test-webhook-secret");
    assert.deepEqual(requestBody.allowed_updates, ["message", "callback_query"]);
    assert.equal(requestBody.drop_pending_updates, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Telegram webhook registration fails closed when bot credentials are missing", async () => {
  await assert.rejects(ensureTelegramWebhook({}), /telegram_webhook_credentials_missing/);
});
