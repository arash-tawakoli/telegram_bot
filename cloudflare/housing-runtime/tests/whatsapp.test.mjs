import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Script } from "node:vm";
import { miniAppScript } from "../src/miniapp-ui.js";
import {
  whatsAppConfigured, formatWhatsAppListing, sendWahaText,
  startWhatsAppLink, wahaWebhook, processWhatsAppDelivery
} from "../src/whatsapp.js";

const env = {
  WAHA_ENABLED: "1",
  WAHA_BASE_URL: "https://waha.example.org/",
  WAHA_API_KEY: "test-api-key",
  WAHA_WEBHOOK_HMAC_KEY: "test-hmac-key",
  WAHA_SENDER_NUMBER: "4915112345678",
  WAHA_SESSION: "default"
};

test("WAHA disabled unless all settings are configured securely", () => {
  assert.equal(whatsAppConfigured({}), false);
  assert.equal(whatsAppConfigured({ ...env, WAHA_ENABLED: "0" }), false);
  assert.equal(whatsAppConfigured({ ...env, WAHA_API_KEY: "" }), false);
  assert.equal(whatsAppConfigured({ ...env, WAHA_BASE_URL: "http://waha.example.org/" }), false);
  assert.equal(whatsAppConfigured(env), true);
});

test("formats matched offer and sends to WAHA, not WhatsApp Cloud API", async () => {
  const text = formatWhatsAppListing({ title: "2 Zimmer", city: "Hamburg", warm_rent: 700 }, "https://example.org/a");
  assert.match(text, /Hamburg/);
  assert.match(text, /700/);
  let sent;
  const response = await sendWahaText(env, "4915112345678@c.us", text, async (url, options) => {
    sent = { url, options };
    return { ok: true, status: 201 };
  });
  assert.deepEqual(response, { ok: true, status: 201 });
  assert.equal(sent.url, "https://waha.example.org/api/sendText");
  assert.equal(sent.options.headers["x-api-key"], env.WAHA_API_KEY);
  assert.deepEqual(JSON.parse(sent.options.body), {
    session: "default", chatId: "4915112345678@c.us", text
  });
  await assert.rejects(() => sendWahaText(env, "123@g.us", text), /whatsapp_not_ready/);
});

test("creates a one-time opt-in deep link without auto-subscribing", async () => {
  const calls = [];
  const sql = { unsafe: async (query, params) => { calls.push({ query, params }); return []; } };
  const response = await startWhatsAppLink(sql, "participant-1", env);
  assert.match(response.url, /^https:\/\/wa\.me\/4915112345678\?text=START%20[a-f0-9]{32}$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[0], "participant-1");
  assert.match(calls[0].params[1], /^[a-f0-9]{64}$/);
});

test("webhook rejects invalid HMAC before touching database", async () => {
  const request = new Request("https://housing.example.org/edge/whatsapp/webhook", {
    method: "POST",
    headers: {
      "x-webhook-hmac": "a".repeat(128),
      "x-webhook-hmac-algorithm": "sha512",
      "x-webhook-timestamp": String(Date.now())
    },
    body: '{"event":"message"}'
  });
  const response = await wahaWebhook({ unsafe: () => { throw Error("unexpected DB read"); } }, env, request);
  assert.equal(response.status, 401);
});

test("verified STOP disables only the originating WhatsApp chat", async () => {
  const body = JSON.stringify({
    event: "message", session: "default",
    payload: { from: "4915112345678@c.us", fromMe: false, body: "STOP" }
  });
  const hmac = createHmac("sha512", env.WAHA_WEBHOOK_HMAC_KEY).update(body).digest("hex");
  const calls = [];
  const request = new Request("https://housing.example.org/edge/whatsapp/webhook", {
    method: "POST", headers: {
      "x-webhook-hmac": hmac, "x-webhook-hmac-algorithm": "sha512",
      "x-webhook-timestamp": String(Date.now())
    }, body
  });
  const response = await wahaWebhook({
    unsafe: async (query, params) => { calls.push({ query, params }); return []; }
  }, env, request);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).disabled, true);
  assert.deepEqual(calls[0].params, ["4915112345678@c.us"]);
});

test("ambiguous WAHA network error records unknown without retry", async () => {
  const queries = [];
  const sql = { unsafe: async (query) => {
    queries.push(query);
    if (query.includes("FROM whatsapp_deliveries wd")) return [{
      delivery_id: "d1", chat_id: "4915112345678@c.us",
      facts: '{"title":"Example"}', canonical_url: "https://example.org/a"
    }];
    if (query.startsWith("UPDATE whatsapp_deliveries SET status='processing'"))
      return [{ delivery_id: "d1" }];
    return [];
  } };
  const response = await processWhatsAppDelivery(sql, env, async () => { throw Error("timeout"); });
  assert.equal(response.status, "unknown");
  assert.equal(queries.filter(q => q.includes("status='processing'")).length, 1);
  assert.ok(queries.some(q => q.includes("status='unknown'")));
});

test("mini app script remains syntactically valid", async () => {
  const script = await miniAppScript().text();
  assert.doesNotThrow(() => new Script(script));
});
