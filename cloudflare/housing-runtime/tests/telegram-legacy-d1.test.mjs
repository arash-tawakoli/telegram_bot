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
