import test from "node:test";
import assert from "node:assert/strict";
import { createD1Supabase } from "../src/telegram-legacy/d1-supabase.js";

test("D1 query adapter supports gt for expiring Telegram auth flows", async () => {
  const calls = [];
  const db = {
    prepare(query) {
      return {
        bind(...params) {
          return { all: async () => {
            calls.push({ query, params });
            return { results: [{ id: "flow-1", user_id: "user-1", provider: "immomio", state: "state-1", expires_at: "2030-01-01", context: "{}" }], meta: { changes: 0 } };
          } };
        },
        all: async () => ({ results: [], meta: { changes: 0 } }),
      };
    },
  };
  const client = createD1Supabase(db, {});
  const result = await client.from("platform_auth_flows")
    .select("*")
    .eq("user_id", "user-1")
    .gt("expires_at", "2026-11-10T00:00:00.000Z")
    .maybeSingle();
  assert.equal(result.error, null);
  assert.equal(result.data.id, "flow-1");
  assert.match(calls[0].query, /expires_at > \?/);
});

test("D1 query adapter supports not-is-null for Telegram admin queries", async () => {
  let queryText = "";
  const db = {
    prepare(query) {
      queryText = query;
      return {
        all: async () => ({
          results: [{ id: "user-1", telegram_user_id: 1, telegram_chat_id: 1, status: "active", telegram_state: "{}" }],
          meta: { changes: 0 },
        }),
      };
    },
  };
  const client = createD1Supabase(db, {});
  const result = await client.from("bot_users").select("*").not("chat_id", "is", null).maybeSingle();
  assert.equal(result.error, null);
  assert.match(queryText, /telegram_chat_id IS NOT NULL/);
});
