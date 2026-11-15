import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encryptProviderCredentials, decryptProviderCredentials } from "../src/provider-credentials.js";
import { DatabaseSync } from "node:sqlite";
import { createD1Client } from "../src/d1-database.js";
import { runCentralProviderSessionRefresh, runPlatformSessionReminders } from "../src/platform-session-cron.js";

test("central-provider refresh runs independently of participant reauth reminders", () => {
  const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const scheduled = source.slice(source.indexOf("async function runScheduledHousingWork"), source.indexOf("if (tasks.engagement)", source.indexOf("async function runScheduledHousingWork")));
  assert.match(scheduled, /runCentralProviderSessionRefresh/);
  assert.doesNotMatch(scheduled, /PERSONAL_PROVIDER_REAUTH_ENABLED/);
});

test("central Immowelt cookie session refreshes on the hourly cadence without sending reminders", async () => {
  const env = { APPLICATION_CREDENTIAL_KEY: "11".repeat(32) };
  const now = new Date("2026-11-15T23:00:00.000Z");
  const expiry = Math.floor(now.getTime() / 1000) + 3600;
  const encrypted = await encryptProviderCredentials(env, {
    userAgent: "Immowelt refresh test",
    expires_at: new Date(expiry * 1000).toISOString(),
    cookies: [
      { name: "oauth.access.token", value: "old-token", domain: ".immowelt.de", path: "/", expires: expiry, secure: true },
      { name: "oauth.access.expiration", value: String(expiry), domain: ".immowelt.de", path: "/", expires: expiry, secure: true },
    ],
  }, "owner-id", "immowelt");
  const connection = { participant_id: "owner-id", provider: "immowelt", status: "connected",
    ciphertext: encrypted.ciphertext, iv: encrypted.iv, key_version: encrypted.key_version,
    expires_at: new Date(expiry * 1000).toISOString(),
    updated_at: new Date(now.getTime() - 56 * 60_000).toISOString() };
  const queries = [], calls = [];
  let saved;
  const sql = async (parts, ...values) => {
    const query = parts.join("?"); queries.push({ query, values });
    if (query.includes("SELECT pc.participant_id") && query.includes("telegram_user_id")) return [connection];
    if (query.includes("UPDATE housing.provider_connections")) { saved = { query, values }; return []; }
    return [];
  };
  const redirect = (location, cookie) => {
    const headers = new Headers({ location });
    if (cookie) headers.append("set-cookie", cookie);
    return new Response(null, { status: 302, headers });
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input); calls.push({ url, init });
    if (url === "https://signin.immowelt.de/refresh")
      return redirect("https://www.immowelt.de/refresh-token", "oauth.access.token=new-token; Domain=.immowelt.de; Path=/; Secure; Max-Age=3600");
    if (url === "https://www.immowelt.de/refresh-token")
      return redirect("https://www.immowelt.de/refresh-finish", "oauth.access.expiration=" + expiry + "; Domain=.immowelt.de; Path=/; Secure; Max-Age=3600");
    if (url === "https://www.immowelt.de/refresh-finish") return new Response("ok");
    throw new Error("unexpected endpoint " + url);
  };
  try {
    const result = await runCentralProviderSessionRefresh(sql, env, now);
    assert.deepEqual(result, { checked: 1, marked: 0 });
    assert.equal(calls[0].url, "https://signin.immowelt.de/refresh");
    assert.ok(saved);
    const refreshed = await decryptProviderCredentials(env,
      { ciphertext: saved.values[0], iv: saved.values[1], key_version: saved.values[2] },
      "owner-id", "immowelt");
    assert.equal(refreshed.cookies.find((cookie) => cookie.name === "oauth.access.token").value, "new-token");
    assert.ok(queries.some(({ query }) => query.includes("telegram_user_id")));
    assert.equal(calls.some(({ url }) => url.includes("api.telegram.org")), false);
  } finally { globalThis.fetch = originalFetch; }
});

test("central Immomio token refreshes hourly even while its access token remains valid", async () => {
  const env = { APPLICATION_CREDENTIAL_KEY: "22".repeat(32) };
  const now = new Date("2026-11-15T23:00:00.000Z");
  const expiresAt = new Date(now.getTime() + 4 * 60 * 60_000).toISOString();
  const encrypted = await encryptProviderCredentials(env, {
    access_token: "old-token", refresh_token: "old-refresh", expires_at: expiresAt,
  }, "owner-id", "immomio");
  const connection = { participant_id: "owner-id", provider: "immomio", status: "connected",
    ciphertext: encrypted.ciphertext, iv: encrypted.iv, key_version: encrypted.key_version,
    expires_at: expiresAt, updated_at: new Date(now.getTime() - 56 * 60_000).toISOString() };
  const queries = [], calls = [];
  let saved;
  const sql = async (parts, ...values) => {
    const query = parts.join("?"); queries.push({ query, values });
    if (query.includes("SELECT pc.participant_id") && query.includes("telegram_user_id")) return [connection];
    if (query.includes("UPDATE provider_connections")) { saved = { query, values }; return []; }
    return [];
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input); calls.push({ url, init });
    if (url === "https://sso.immomio.com/auth/realms/immomio/protocol/openid-connect/token")
      return Response.json({ access_token: "new-token", refresh_token: "new-refresh", expires_in: 3600 });
    if (url === "https://gql-ps.immomio.com/tenant/graphql")
      return Response.json({ data: { user: { id: "owner-id", email: "owner@example.com" } } });
    throw new Error("unexpected endpoint " + url);
  };
  try {
    const result = await runCentralProviderSessionRefresh(sql, env, now);
    assert.deepEqual(result, { checked: 1, marked: 0 });
    assert.equal(calls[0].url, "https://sso.immomio.com/auth/realms/immomio/protocol/openid-connect/token");
    assert.ok(saved);
    const refreshed = await decryptProviderCredentials(env,
      { ciphertext: saved.values[0], iv: saved.values[1], key_version: saved.values[2] },
      "owner-id", "immomio");
    assert.equal(refreshed.access_token, "new-token");
    assert.equal(refreshed.refresh_token, "new-refresh");
    assert.ok(queries.some(({ query }) => query.includes("telegram_user_id")));
  } finally { globalThis.fetch = originalFetch; }
});

test("D1 session reminders issue one Cloudflare login ticket and advance the reminder stage", async () => {
  const calls = [];
  const sql = async (parts, ...values) => {
    const text = parts.join("?"); calls.push({ text, values });
    if (text.includes("FROM housing.provider_connections pc")) return [{
      participant_id: "participant-1", provider: "immoscout24", connection_updated_at: "2026-11-13T08:00:00Z",
      telegram_chat_id: 123, participant_status: "active", auto_apply_enabled: 1,
      plan_override: "premium", preferences_enabled: 1, provider_enabled: 1,
      latest_notification_at: null,
    }];
    if (text.includes("FROM housing.platform_reauth_notifications\n    WHERE status = 'sending'")) return [];
    if (text.includes("SELECT n.id, n.participant_id")) return [{ id: "notice-1", participant_id: "participant-1", provider: "immoscout24", attempts: 0, reminder_stage: 0, telegram_chat_id: 123 }];
    if (text.includes("SELECT id,status FROM participants")) return [{ id: "participant-1", status: "active" }];
    if (text.includes("SET status = 'sending'")) return [{ id: "notice-1" }];
    return [];
  };
  const fetchCalls = [];
  const result = await runPlatformSessionReminders(sql, { TELEGRAM_BOT_TOKEN: "test-token" }, new Date("2026-11-13T08:30:00Z"), async (url, init) => {
    fetchCalls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  });
  assert.deepEqual(result, { checked: 0, marked: 0, queued: 1, sent: 1 });
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].body.reply_markup.inline_keyboard[0][0].url, /^https:\/\/login\.traumwohnunghamburg\.de\/connect\?ticket=/);
  assert.ok(calls.some(({ text }) => /reminder_stage = \?/i.test(text)));
});

test("session reminder SQL runs against the D1 table shapes and retires on reconnect", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE participants (id TEXT PRIMARY KEY,status TEXT,telegram_chat_id INTEGER,telegram_user_id INTEGER,auto_apply_enabled INTEGER,plan_override TEXT,plan_override_expires_at TEXT,referral_bonus_until TEXT);
    CREATE TABLE provider_connections (id TEXT PRIMARY KEY,participant_id TEXT,provider TEXT,status TEXT,ciphertext TEXT,iv TEXT,key_version INTEGER,account_hint TEXT,expires_at TEXT,updated_at TEXT,UNIQUE(participant_id,provider));
    CREATE TABLE application_preferences (participant_id TEXT PRIMARY KEY,enabled INTEGER,immoscout_enabled INTEGER,immowelt_enabled INTEGER,immomio_enabled INTEGER);
    CREATE TABLE user_subscriptions (participant_id TEXT,provider TEXT,status TEXT,current_period_end TEXT);
    CREATE TABLE platform_reauth_notifications (id TEXT PRIMARY KEY,participant_id TEXT,provider TEXT,reason TEXT,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,available_at TEXT DEFAULT CURRENT_TIMESTAMP,last_sent_at TEXT,last_error TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,reminder_stage INTEGER DEFAULT 0);
    CREATE UNIQUE INDEX platform_reauth_open_idx ON platform_reauth_notifications(participant_id,provider) WHERE status IN ('pending','sending');
    CREATE TABLE provider_auth_flows (id TEXT PRIMARY KEY,participant_id TEXT,provider TEXT,state TEXT,code_verifier TEXT,origin TEXT,return_target TEXT,context TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,expires_at TEXT,consumed_at TEXT);
    INSERT INTO participants VALUES ('p1','active',123,NULL,1,'premium',NULL,NULL);
    INSERT INTO provider_connections VALUES ('c1','p1','immoscout24','needs_login',NULL,NULL,NULL,NULL,NULL,'2026-11-13T08:00:00Z');
    INSERT INTO application_preferences VALUES ('p1',1,1,1,1);
  `);
  const db = {
    prepare(query) {
      const statement = sqlite.prepare(query);
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async all() {
          if (statement.columns().length) return { results: statement.all(...values), meta: { changes: 0 } };
          const result = statement.run(...values);
          return { results: [], meta: { changes: result.changes } };
        },
      };
    },
  };
  const fetchCalls = [];
  const result = await runPlatformSessionReminders(createD1Client(db), { TELEGRAM_BOT_TOKEN: "test-token" }, new Date("2026-11-13T08:30:00Z"), async (_url, init) => {
    fetchCalls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  });
  assert.deepEqual(result, { checked: 0, marked: 0, queued: 1, sent: 1 });
  assert.equal(fetchCalls.length, 1);
  assert.equal(sqlite.prepare("SELECT status FROM provider_connections WHERE participant_id='p1'").get().status, "pending");
  assert.equal(sqlite.prepare("SELECT reminder_stage FROM platform_reauth_notifications WHERE participant_id='p1'").get().reminder_stage, 1);

  sqlite.prepare("UPDATE provider_connections SET status='connected',updated_at='2026-11-13T09:00:00Z' WHERE participant_id='p1'").run();
  const resolved = await runPlatformSessionReminders(createD1Client(db), { TELEGRAM_BOT_TOKEN: "test-token" }, new Date("2026-11-13T09:10:00Z"), async () => { throw new Error("should_not_send"); });
  assert.equal(resolved.sent, 0);
  assert.equal(sqlite.prepare("SELECT status FROM platform_reauth_notifications WHERE participant_id='p1'").get().status, "resolved");
  sqlite.close();
});
