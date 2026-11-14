import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { configureLegacyRuntime } from "../src/telegram-legacy/runtime.js";
import { setPlanOverride, setUserBlocked } from "../src/telegram-legacy/admin.js";
import { purgePlatformSessions } from "../src/telegram-legacy/platform-sessions.js";
import { createD1Supabase } from "../src/telegram-legacy/d1-supabase.js";

function sqliteD1(db) {
  function statement(query, params) {
    return {
      async all() {
        const prepared = db.prepare(query);
        if (prepared.columns().length) {
          const results = prepared.all(...params);
          return { results, meta: { changes: results.length } };
        }
        const result = prepared.run(...params);
        return { results: [], meta: { changes: Number(result.changes) } };
      },
    };
  }
  return {
    prepare(query) {
      return {
        bind: (...params) => statement(query, params),
        all: () => statement(query, [] ).all(),
      };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.all());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

test("D1 mutation select returns database rows and respects single modes", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE telegram_announcements (id INTEGER PRIMARY KEY AUTOINCREMENT, created_by TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft');
    CREATE TABLE participants (id TEXT PRIMARY KEY, telegram_chat_id INTEGER NOT NULL, status TEXT NOT NULL, plan_override TEXT);
  `);
  sqlite.prepare("INSERT INTO participants VALUES (?, ?, ?, ?)").run("p1", 777, "active", "free");
  const api = createD1Supabase(sqliteD1(sqlite), {});

  const inserted = await api.from("telegram_announcements").insert({ created_by: "admin", body: "Hello" }).select("id,body").single();
  assert.equal(inserted.error, null);
  assert.equal(inserted.data.body, "Hello");
  assert.ok(inserted.data.id > 0);

  const updated = await api.from("bot_users").update({ plan_override: "premium" }).eq("id", "p1").select("id,chat_id").maybeSingle();
  assert.equal(updated.error, null);
  assert.equal(updated.data.id, "p1");
  assert.equal(updated.data.chat_id, 777);

  const missing = await api.from("telegram_announcements").update({ status: "cancelled" }).eq("id", 999).select("id").maybeSingle();
  assert.equal(missing.error, null);
  assert.equal(missing.data, null);
  sqlite.close();
});

test("admin premium grants do not update a nonexistent delivery retry column", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE participants (id TEXT PRIMARY KEY, telegram_chat_id INTEGER, status TEXT NOT NULL, plan_override TEXT, plan_override_expires_at TEXT, referral_bonus_until TEXT, updated_at TEXT);
    CREATE TABLE search_profiles (id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, profile_slot INTEGER NOT NULL, criteria TEXT, active INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE deliveries (id TEXT PRIMARY KEY, participant_id TEXT, status TEXT, error_message TEXT);
    INSERT INTO participants VALUES ('p1', 777, 'active', NULL, NULL, NULL, CURRENT_TIMESTAMP);
    INSERT INTO search_profiles VALUES ('s1', 'p1', 1, '{}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    INSERT INTO deliveries VALUES ('d1', 'p1', 'pending', NULL);
  `);
  const binding = sqliteD1(sqlite);
  configureLegacyRuntime({ HOUSING_DB: binding }, binding);
  const result = await setPlanOverride("p1", "30d");
  assert.equal(result.chat_id, 777);
  assert.equal(sqlite.prepare("SELECT plan_override FROM participants WHERE id='p1'").get().plan_override, "premium");
  sqlite.close();
});

test("blocking a participant archives their search and skips pending deliveries", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE participants (id TEXT PRIMARY KEY, telegram_user_id INTEGER, telegram_chat_id INTEGER, status TEXT NOT NULL, plan_override TEXT, plan_override_expires_at TEXT, referral_bonus_until TEXT, updated_at TEXT);
    CREATE TABLE search_profiles (id TEXT PRIMARY KEY, participant_id TEXT, profile_slot INTEGER, criteria TEXT, active INTEGER, updated_at TEXT);
    CREATE TABLE deliveries (id TEXT PRIMARY KEY, participant_id TEXT, offer_identity_id TEXT, idempotency_key TEXT, status TEXT, error_message TEXT);
    INSERT INTO participants VALUES ('p1',777,777,'active',NULL,NULL,NULL,CURRENT_TIMESTAMP);
    INSERT INTO search_profiles VALUES ('s1','p1',1,'{}',1,CURRENT_TIMESTAMP);
    INSERT INTO deliveries VALUES ('d1','p1','o1','p1:o1','pending',NULL);
  `);
  const binding = sqliteD1(sqlite);
  configureLegacyRuntime({ HOUSING_DB: binding }, binding);
  await setUserBlocked("p1", true);
  assert.equal(sqlite.prepare("SELECT status FROM participants WHERE id='p1'").get().status, "archived");
  assert.equal(sqlite.prepare("SELECT active FROM search_profiles WHERE id='s1'").get().active, 0);
  assert.equal(sqlite.prepare("SELECT status,error_message FROM deliveries WHERE id='d1'").get().status, "skipped");
  assert.equal(sqlite.prepare("SELECT error_message FROM deliveries WHERE id='d1'").get().error_message, "participant_blocked");
  sqlite.close();
});

test("participant cleanup leaves coach sessions intact and removes only participant-owned data", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE documents (id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, object_key TEXT NOT NULL, original_filename TEXT, document_type TEXT, content_type TEXT, size_bytes INTEGER, send_with_auto_apply INTEGER, created_at TEXT);
    CREATE TABLE provider_connections (id TEXT PRIMARY KEY, participant_id TEXT, provider TEXT, status TEXT, ciphertext TEXT, iv TEXT, key_version INTEGER, account_hint TEXT, expires_at TEXT, updated_at TEXT);
    CREATE TABLE provider_auth_flows (id TEXT PRIMARY KEY, participant_id TEXT, provider TEXT, state TEXT, code_verifier TEXT, origin TEXT, return_target TEXT, context TEXT, expires_at TEXT, consumed_at TEXT);
    CREATE TABLE portal_sessions (id TEXT PRIMARY KEY, member_id TEXT);
    INSERT INTO documents VALUES ('doc1','p1','p1/doc.pdf','doc.pdf','other','application/pdf',3,0,CURRENT_TIMESTAMP);
    INSERT INTO provider_connections VALUES ('c1','p1','immomio','connected','cipher','iv',1,NULL,NULL,CURRENT_TIMESTAMP);
    INSERT INTO provider_auth_flows VALUES ('f1','p1','immomio','state','verifier','telegram','telegram','{}',CURRENT_TIMESTAMP,NULL);
    INSERT INTO portal_sessions VALUES ('session1','coach1');
  `);
  const objects = new Set(["p1/doc.pdf"]);
  const binding = sqliteD1(sqlite);
  configureLegacyRuntime({ HOUSING_DB: binding, DOCUMENTS: { delete: async keys => { for (const key of keys) objects.delete(key); } } }, binding);

  await purgePlatformSessions("p1");

  assert.equal(objects.size, 0);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM documents").get().count, 0);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM provider_connections").get().count, 0);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM provider_auth_flows").get().count, 0);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM portal_sessions").get().count, 1);
  sqlite.close();
});
