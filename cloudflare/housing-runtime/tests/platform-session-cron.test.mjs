import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createD1Client } from "../src/d1-database.js";
import { runPlatformSessionReminders } from "../src/platform-session-cron.js";

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
    CREATE TABLE participants (id TEXT PRIMARY KEY,status TEXT,telegram_chat_id INTEGER,auto_apply_enabled INTEGER,plan_override TEXT,plan_override_expires_at TEXT,referral_bonus_until TEXT);
    CREATE TABLE provider_connections (id TEXT PRIMARY KEY,participant_id TEXT,provider TEXT,status TEXT,ciphertext TEXT,iv TEXT,key_version INTEGER,account_hint TEXT,expires_at TEXT,updated_at TEXT,UNIQUE(participant_id,provider));
    CREATE TABLE application_preferences (participant_id TEXT PRIMARY KEY,enabled INTEGER,immoscout_enabled INTEGER,immowelt_enabled INTEGER,immomio_enabled INTEGER);
    CREATE TABLE user_subscriptions (participant_id TEXT,provider TEXT,status TEXT,current_period_end TEXT);
    CREATE TABLE platform_reauth_notifications (id TEXT PRIMARY KEY,participant_id TEXT,provider TEXT,reason TEXT,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,available_at TEXT DEFAULT CURRENT_TIMESTAMP,last_sent_at TEXT,last_error TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,reminder_stage INTEGER DEFAULT 0);
    CREATE UNIQUE INDEX platform_reauth_open_idx ON platform_reauth_notifications(participant_id,provider) WHERE status IN ('pending','sending');
    CREATE TABLE provider_auth_flows (id TEXT PRIMARY KEY,participant_id TEXT,provider TEXT,state TEXT,code_verifier TEXT,origin TEXT,return_target TEXT,context TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,expires_at TEXT,consumed_at TEXT);
    INSERT INTO participants VALUES ('p1','active',123,1,'premium',NULL,NULL);
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
