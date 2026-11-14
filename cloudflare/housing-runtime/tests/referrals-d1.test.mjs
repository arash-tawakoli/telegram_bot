import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { createD1Supabase } from "../src/telegram-legacy/d1-supabase.js";

test("referrals register once and award both participants only after a profile is saved", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    const schema = new URL("../schema/d1/", import.meta.url);
    for (const file of readdirSync(schema).filter(x => x.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file, schema), "utf8"));
    const db = {
      prepare(query) {
        const make = params => ({ all: async () => {
          const statement = sqlite.prepare(query);
          if (/^\s*(SELECT|WITH|PRAGMA)/i.test(query)) return { results: statement.all(...params), meta: { changes: 0 } };
          return { results: [], meta: { changes: Number(statement.run(...params).changes) } };
        } });
        return { bind: (...params) => make(params), ...make([]) };
      },
      async batch(statements) {
        sqlite.exec("BEGIN");
        try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec("COMMIT"); return results; }
        catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      },
    };
    sqlite.exec("INSERT INTO participants(id,first_name,last_name) VALUES ('owner','A','B'),('new','C','D'),('other','E','F'); INSERT INTO referral_codes(participant_id,code) VALUES('owner','TESTCODE')");
    const api = createD1Supabase(db, {});
    const redeem = (user, code) => api.rpc("redeem_referral_code", { p_referred_user_id: user, p_code: code });
    assert.equal((await redeem("new", "bad")).data.status, "invalid_code");
    assert.equal((await redeem("owner", "testcode")).data.status, "self_referral");
    assert.equal((await redeem("new", " testcode ")).data.status, "registered");
    assert.equal((await redeem("new", "TESTCODE")).data.status, "already_registered");
    assert.equal(sqlite.prepare("SELECT referral_bonus_until FROM participants WHERE id='new'").get().referral_bonus_until, null);
    const save = () => api.rpc("save_search_profile_ui", { p_user: "new", p_values: { profile_slot: 1, source_ids: [] } });
    assert.equal((await save()).data.status, "rewarded");
    const bonuses = sqlite.prepare("SELECT id,referral_bonus_until,referral_bonus_days FROM participants WHERE id IN ('owner','new') ORDER BY id").all();
    assert.ok(bonuses.every(row => Date.parse(row.referral_bonus_until + "Z") > Date.now() + 29 * 86400000));
    assert.ok(bonuses.every(row => row.referral_bonus_days === 30));
    assert.equal((await save()).data.status, "none");
    assert.deepEqual(sqlite.prepare("SELECT id,referral_bonus_until,referral_bonus_days FROM participants WHERE id IN ('owner','new') ORDER BY id").all(), bonuses);
    sqlite.exec("INSERT INTO search_profiles(id,participant_id,profile_slot) VALUES ('other-profile','other',1)");
    assert.equal((await redeem("other", "TESTCODE")).data.status, "not_new_user");
  } finally { sqlite.close(); }
});
