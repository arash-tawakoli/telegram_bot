import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createD1Supabase } from "../src/telegram-legacy/d1-supabase.js";

function sqliteD1(db) {
  function statement(query, params) {
    return {
      query, params,
      async all() {
        const prepared = db.prepare(query);
        if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(query) || /\bRETURNING\b/i.test(query)) {
          return { results: prepared.all(...params), meta: { changes: 0 } };
        }
        const result = prepared.run(...params);
        return { results: [], meta: { changes: Number(result.changes) } };
      },
    };
  }
  return {
    prepare(query) { return { bind: (...params) => statement(query, params), all: () => statement(query, []).all() }; },
    async batch(statements) {
      db.exec('BEGIN');
      try { const results=[]; for (const item of statements) results.push(await item.all()); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec('CREATE TABLE telegram_updates(update_id INTEGER PRIMARY KEY,kind TEXT NOT NULL)');
  db.exec(readFileSync(new URL("../schema/d1/0020_telegram_control_ordering.sql", import.meta.url), "utf8"));
  db.exec(`
    CREATE TABLE participants(id TEXT PRIMARY KEY,auto_apply_enabled INTEGER NOT NULL DEFAULT 0,test_auto_apply_enabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE application_preferences(participant_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,immoscout_enabled INTEGER NOT NULL DEFAULT 0,immowelt_enabled INTEGER NOT NULL DEFAULT 0,immomio_enabled INTEGER NOT NULL DEFAULT 0);
    INSERT INTO participants(id) VALUES('participant-1');
    INSERT INTO telegram_updates(update_id,kind) VALUES(100,'callback_query'),(101,'callback_query'),(200,'callback_query'),(201,'callback_query');
  `);
  return { db, adapter: createD1Supabase(sqliteD1(db), {}) };
}

test("D1 ignores older global and provider controls after a newer accepted callback", async () => {
  const { db, adapter } = database();
  const columns = db.prepare('PRAGMA table_info(telegram_updates)').all().map(row => row.name);
  assert.ok(columns.includes('telegram_user_id'));
  assert.ok(columns.includes('callback_data'));
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name='telegram_updates_control_ordering_idx'").get().sql, /telegram_user_id, callback_data, update_id/);

  await adapter.rpc('set_application_enabled_shared', { p_user:'participant-1', p_enabled:false, p_update_id:101, p_telegram_user_id:777 });
  await adapter.rpc('set_application_enabled_shared', { p_user:'participant-1', p_enabled:true, p_update_id:100, p_telegram_user_id:777 });
  assert.equal(db.prepare('SELECT auto_apply_enabled FROM participants WHERE id=?').get('participant-1').auto_apply_enabled, 0);
  assert.equal(db.prepare('SELECT enabled FROM application_preferences WHERE participant_id=?').get('participant-1').enabled, 0);

  await adapter.rpc('set_application_provider_enabled_shared', { p_user:'participant-1', p_provider:'immomio', p_enabled:false, p_update_id:201, p_telegram_user_id:777 });
  await adapter.rpc('set_application_provider_enabled_shared', { p_user:'participant-1', p_provider:'immomio', p_enabled:true, p_update_id:200, p_telegram_user_id:777 });
  assert.equal(db.prepare('SELECT immomio_enabled FROM application_preferences WHERE participant_id=?').get('participant-1').immomio_enabled, 0);

  const accepted = db.prepare('SELECT telegram_user_id,callback_data FROM telegram_updates WHERE update_id IN (100,101,200,201) ORDER BY update_id').all();
  assert.deepEqual(accepted, [
    { telegram_user_id:777, callback_data:'platforms:on' },
    { telegram_user_id:777, callback_data:'platforms:off' },
    { telegram_user_id:777, callback_data:'platforms:resume:3' },
    { telegram_user_id:777, callback_data:'platforms:pause:3' },
  ]);
  db.close();
});
