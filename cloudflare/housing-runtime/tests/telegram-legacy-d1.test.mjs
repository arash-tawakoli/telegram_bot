import test from "node:test";
import assert from "node:assert/strict";
import { createD1Supabase } from "../src/telegram-legacy/d1-supabase.js";

function fakeD1(rows) {
  return {
    prepare(query) {
      return {
        bind(...params) { return { all: async () => ({ results: rows(query, params), meta: { changes: 0 } }) }; },
        all: async () => ({ results: rows(query, []), meta: { changes: 0 } }),
      };
    },
  };
}

test("legacy Telegram adapter maps participant rows to the old bot user shape", async () => {
  const db = createD1Supabase(fakeD1(() => [{ id: "u1", telegram_chat_id: 7, telegram_user_id: 7, status: "active", telegram_state: "{}" }]), {});
  const result = await db.from("bot_users").select("*").eq("id", "u1").maybeSingle();
  assert.equal(result.error, null);
  assert.equal(result.data.chat_id, 7);
  assert.equal(result.data.is_active, true);
  assert.equal(result.data.user_id, "u1");
});

test("legacy Telegram adapter returns empty optional legacy tables without Supabase", async () => {
  const db = createD1Supabase(fakeD1(() => []), {});
  const result = await db.from("referrals").select("id").eq("user_id", "u1");
  assert.deepEqual(result.data, []);
  assert.equal(result.error, null);
});

test("legacy Telegram admin queries can read persisted username and profile flags", async () => {
  const row = {
    id: "u-admin",
    telegram_user_id: 7,
    telegram_chat_id: 7,
    first_name: "Admin",
    last_name: "User",
    username: "admin_handle",
    status: "active",
    plan_override: "premium",
    plan_override_expires_at: "2026-12-01T00:00:00.000Z",
    referral_bonus_until: null,
    auto_apply_enabled: 1,
    test_auto_apply_allowed: 1,
    test_auto_apply_enabled: 1,
    test_auto_apply_daily_limit: 3,
    test_auto_apply_enabled_at: "2026-11-01T00:00:00.000Z",
    test_auto_apply_disabled_at: null,
    created_at: "2026-11-01T00:00:00.000Z",
  };
  const queries = [];
  const db = createD1Supabase({
    prepare(query) {
      return {
        bind(...params) {
          return { all: async () => { queries.push({ query, params }); return { results: [row], meta: { changes: 0 } }; } };
        },
        all: async () => { queries.push({ query, params: [] }); return { results: [row], meta: { changes: 0 } }; },
      };
    },
  }, {});
  const result = await db.from("bot_users")
    .select("id,telegram_user_id,first_name,last_name,username,is_active,plan_override,plan_override_expires_at,referral_bonus_until,created_at")
    .order("created_at")
    .maybeSingle();
  assert.equal(result.error, null);
  assert.equal(result.data.username, "admin_handle");
  assert.equal(result.data.is_active, true);
  assert.equal(result.data.plan_override, "premium");
  assert.equal(result.data.plan_override_expires_at, "2026-12-01T00:00:00.000Z");
  assert.equal(result.data.auto_apply_enabled, true);
  assert.equal(result.data.test_auto_apply_allowed, true);
  assert.equal(result.data.test_auto_apply_daily_limit, 3);
  assert.match(queries[0].query, /username/);
  assert.match(queries[0].query, /plan_override/);
});

test("prepare_telegram_update stores Telegram username and updates existing participant metadata", async () => {
  const queries = [];
  const db = createD1Supabase({
    prepare(query) {
      return {
        bind(...params) {
          return { all: async () => {
            queries.push({ query, params });
            if (query.startsWith("SELECT * FROM participants WHERE telegram_user_id")) {
              return { results: [{ id: "u-existing", telegram_user_id: 7, telegram_chat_id: 7, first_name: "Old", last_name: "Name", status: "active", telegram_state: "{}" }], meta: { changes: 0 } };
            }
            if (query.startsWith("SELECT * FROM participants WHERE id")) {
              return { results: [{ id: "u-existing", telegram_user_id: 7, telegram_chat_id: 77, username: "new_handle", first_name: "New", last_name: "Name", ui_language: "de", status: "active", telegram_state: "{}" }], meta: { changes: 0 } };
            }
            return { results: [], meta: { changes: 1 } };
          } };
        },
        all: async () => ({ results: [], meta: { changes: 0 } }),
      };
    },
  }, {});
  const result = await db.rpc("prepare_telegram_update", {
    p_payload: { update_id: 10, message: { from: { id: 7, username: "new_handle", first_name: "New", last_name: "Name", language_code: "de" }, chat: { id: 77 } } },
  });
  assert.equal(result.error, null);
  const update = queries.find(call => call.query.startsWith("UPDATE participants SET telegram_chat_id"));
  assert.ok(update);
  assert.match(update.query, /username=\?/);
  assert.equal(update.params[1], "new_handle");
  assert.equal(result.data.user.username, "new_handle");
  assert.equal(result.data.user.chat_id, 77);
});

test("D1 participant metadata migration is additive and preserves existing participant rows", async () => {
  const { readFileSync } = await import("node:fs");
  const migration = readFileSync(new URL("../schema/d1/0003_telegram_user_metadata.sql", import.meta.url), "utf8");
  for (const column of ["username", "origin", "plan_override", "plan_override_expires_at", "referral_bonus_until", "auto_apply_enabled", "test_auto_apply_allowed", "test_auto_apply_enabled", "test_auto_apply_daily_limit", "test_auto_apply_enabled_at", "test_auto_apply_disabled_at"]) {
    assert.match(migration, new RegExp("ADD COLUMN " + column));
  }
  assert.match(migration, /UPDATE participants SET origin='telegram'/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM participants|CREATE TABLE[^;]*participants/i);
});

test("applicant profile upsert stores JSON in the physical D1 schema", async () => {
  let captured = null;
  const db = createD1Supabase({
    prepare(query) {
      return {
        bind(...params) {
          return { all: async () => { captured = { query, params }; return { results: [], meta: { changes: 1 } }; } };
        },
        all: async () => ({ results: [], meta: { changes: 0 } }),
      };
    },
  }, {});
  const result = await db.from("applicant_profiles").upsert({
    user_id: "participant-1",
    first_name: "",
    last_name: "",
    updated_at: "2026-11-09T21:00:00.000Z",
  }, { onConflict: "user_id" });
  assert.equal(result.error, null);
  assert.equal(result.count, 1);
  assert.match(captured.query, /^INSERT OR REPLACE INTO applicant_profiles \(participant_id,profile,updated_at\) VALUES\(\?,\?,\?\)$/);
  assert.equal(captured.params[0], "participant-1");
  assert.deepEqual(JSON.parse(captured.params[1]), { first_name: "", last_name: "" });
  assert.equal(captured.params[2], "2026-11-09T21:00:00.000Z");
});
