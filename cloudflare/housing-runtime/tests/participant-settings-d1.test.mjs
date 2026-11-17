import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { createD1Supabase } from "../src/telegram-legacy/d1-supabase.js";

test("participant settings survive migration and Telegram device language changes", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    const schema = new URL("../schema/d1/", import.meta.url);
    for (const file of readdirSync(schema).filter(x => x.endsWith(".sql") && x < "0011").sort()) sqlite.exec(readFileSync(new URL(file, schema), "utf8"));
    sqlite.exec("INSERT INTO participants(id,first_name,last_name,telegram_user_id,telegram_chat_id,ui_language) VALUES('user','A','B',7,7,'tr')");
    const archived = { id: "user", language_code: "de", last_start_at: "2026-11-01T00:00:00Z", engagement_notifications_enabled: false, test_auto_apply_updated_by_telegram_id: 7 };
    sqlite.prepare("INSERT INTO supabase_archive_rows(schema_name,table_name,row_key,row_index,payload_json) VALUES('public','bot_users',?,0,?)").run(JSON.stringify(["user"]), JSON.stringify(archived));
    sqlite.exec(readFileSync(new URL("0011_participant_settings.sql", schema), "utf8"));
    sqlite.exec(readFileSync(new URL("0023_language_trial_applicant_completion.sql", schema), "utf8"));
    sqlite.exec(readFileSync(new URL("0027_usage_reset_credits.sql", schema), "utf8"));
    sqlite.exec(readFileSync(new URL("0028_starter_premium_resets.sql", schema), "utf8"));
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM usage_reset_credits WHERE participant_id='user' AND redeemed_at IS NULL").get().n,1);
    const before = sqlite.prepare("SELECT * FROM participants WHERE id='user'").get();
    assert.equal(before.engagement_notifications_enabled, 0);
    assert.equal(before.last_start_at, archived.last_start_at);
    assert.equal(before.test_auto_apply_updated_by_telegram_id, 7);
    const db = { prepare(query) {
      const make = values => ({ all: async () => {
        const statement = sqlite.prepare(query);
        if (/^\s*(SELECT|WITH|PRAGMA)/i.test(query)) return { results: statement.all(...values), meta: { changes: 0 } };
        return { results: [], meta: { changes: Number(statement.run(...values).changes) } };
      } });
      return { bind: (...values) => make(values), ...make([]) };
    } };
    const api = createD1Supabase(db, {});
    const result = await api.rpc("prepare_telegram_update", { p_payload: { message: { from: { id: 7, first_name: "A", language_code: "en" }, chat: { id: 7 } } } });
    assert.equal(result.error, null);
    const after = sqlite.prepare("SELECT ui_language,language_code,engagement_notifications_enabled FROM participants WHERE id='user'").get();
    assert.equal(after.ui_language, "tr");
    assert.equal(after.language_code, "en");
    assert.equal(after.engagement_notifications_enabled, 0);
    const created = await api.rpc("prepare_telegram_update", { p_payload: { message: { from: { id: 8, first_name: "C", language_code: "de" }, chat: { id: 8 } } } });
    assert.equal(created.error, null);
    assert.ok(sqlite.prepare("SELECT last_start_at FROM participants WHERE telegram_user_id=8").get().last_start_at);
    assert.equal(created.data.user.language_selected_at,null);
    assert.ok(Date.parse(created.data.user.referral_bonus_until)>Date.now()+29*86400000);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM usage_reset_credits WHERE participant_id=? AND grant_key='starter:7d'").get(created.data.user.id).n,1);
  } finally { sqlite.close(); }
});
