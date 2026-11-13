import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { isPremium, materializeEngagementNotifications, processEngagementNotifications } from "../src/engagement-cron.js";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE participants (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, last_start_at TEXT,
      telegram_user_id INTEGER, telegram_chat_id INTEGER, engagement_notifications_enabled INTEGER NOT NULL,
      plan_override TEXT, plan_override_expires_at TEXT, referral_bonus_until TEXT, auto_apply_enabled INTEGER NOT NULL
    );
    CREATE TABLE search_profiles (id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, active INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE provider_connections (id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE user_subscriptions (id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, current_period_end TEXT);
    CREATE TABLE user_engagement_notifications (
      id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, campaign_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      scheduled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      attempts INTEGER NOT NULL DEFAULT 0, claimed_at TEXT, sent_at TEXT, clicked_at TEXT, feedback_value TEXT,
      last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE supabase_archive_rows (schema_name TEXT NOT NULL, table_name TEXT NOT NULL, payload_json TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO participants(id,status,created_at,telegram_user_id,telegram_chat_id,engagement_notifications_enabled,auto_apply_enabled) VALUES(?,?,?,?,?,?,?)")
    .run("participant-1", "active", "2026-11-12T00:00:00.000Z", 777, 888, 1, 0);
  db.prepare("INSERT INTO supabase_archive_rows(schema_name,table_name,payload_json) VALUES(?,?,?)")
    .run("public", "bot_events", JSON.stringify({ telegram_user_id: 777, created_at: "2026-11-12T00:30:00.000Z" }));
  db.exec(readFileSync(new URL("../schema/d1/0014_engagement_activity.sql", import.meta.url), "utf8"));
  const run = (query, params = []) => {
    const statement = db.prepare(query.replace(/\$(\d+)/g, "?$1"));
    return /\bRETURNING\b/i.test(query) || /^\s*(SELECT|WITH)\b/i.test(query)
      ? statement.all(...params)
      : (statement.run(...params), []);
  };
  const sql = (strings, ...params) => run(strings.reduce((text, part, index) => text + part + (index < params.length ? `$${index + 1}` : ""), ""), params);
  sql.unsafe = run;
  return { db, sql };
}

test("engagement queue materializes once, respects activity history, and sends through the shared cron", async () => {
  const { db, sql } = database();
  const now = new Date("2026-11-13T01:20:00.000Z");
  assert.equal(db.prepare("SELECT last_activity_at FROM participants WHERE id='participant-1'").get().last_activity_at, "2026-11-12T00:30:00.000Z");
  assert.equal(await materializeEngagementNotifications(sql, now), 1);
  assert.equal(await materializeEngagementNotifications(sql, now), 0);
  assert.equal(db.prepare("SELECT campaign_key FROM user_engagement_notifications").get().campaign_key, "profile_reminder_24h");

  const messages = [];
  const result = await processEngagementNotifications(sql, { TELEGRAM_BOT_TOKEN: "test-token" }, now, async (url, init) => {
    messages.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  assert.deepEqual(result, { queued: 1, sent: 1, cancelled: 0, failed: 0, deferred: 0 });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].body.chat_id, 888);
  assert.equal(messages[0].body.reply_markup.inline_keyboard.at(-1)[0].callback_data, "engagement:stop");
  assert.equal(db.prepare("SELECT status FROM user_engagement_notifications").get().status, "sent");
  db.close();
});

test("premium entitlement precedence matches the existing campaign sender", () => {
  const now = Date.parse("2026-11-13T00:00:00.000Z");
  assert.equal(isPremium({ plan_override: "free" }, { status: "active" }, now), false);
  assert.equal(isPremium({ plan_override: "premium", plan_override_expires_at: "2026-11-14T00:00:00.000Z" }, null, now), true);
  assert.equal(isPremium({}, { status: "trialing", current_period_end: null }, now), true);
  assert.equal(isPremium({}, { status: "active", current_period_end: "2026-11-12T00:00:00.000Z" }, now), false);
});
