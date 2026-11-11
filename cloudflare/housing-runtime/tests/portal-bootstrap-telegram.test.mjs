import { sha256 } from "../src/auth.js";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createD1Supabase } from "../src/telegram-legacy/d1-supabase.js";

globalThis.crypto ||= webcrypto;

function fakeDb({ telegramId = 8538226539, adminHash = "migration_required$seed" } = {}) {
  const calls = [];
  const db = {
    prepare(query) {
      return {
        bind(...params) {
          return {
            all: async () => {
              calls.push({ query, params });
              if (query.startsWith("SELECT id,status FROM participants")) {
                return { results: telegramId === 8538226539 ? [{ id: "owner-1", status: "active" }] : [], meta: { changes: 0 } };
              }
              if (query.startsWith("SELECT id,password_hash FROM portal_members")) {
                return { results: [{ id: "admin-1", password_hash: adminHash }], meta: { changes: 0 } };
              }
              return { results: [], meta: { changes: query.startsWith("INSERT") || query.startsWith("UPDATE") ? 1 : 0 } };
            },
          };
        },
        all: async () => {
          if (query.startsWith("SELECT id,password_hash FROM portal_members")) {
            return { results: [{ id: "admin-1", password_hash: adminHash }], meta: { changes: 0 } };
          }
          return { results: [], meta: { changes: 0 } };
        },
      };
    },
  };
  return { db, calls };
}

test("portal bootstrap token is issued only for the active owner and a migrated-required super admin", async () => {
  const { db, calls } = fakeDb();
  const adapter = createD1Supabase(db, {});
  const result = await adapter.rpc("issue_portal_bootstrap_token", { p_telegram_user_id: 8538226539 });
  assert.equal(result.error, null);
  assert.match(result.data.token, /^[a-f0-9]{64}$/);
  assert.ok(Date.parse(result.data.expires_at) > Date.now());
  const insert = calls.find((call) => call.query.startsWith("INSERT INTO bootstrap_tokens"));
  assert.ok(insert);
  assert.equal(insert.params[1], await sha256(result.data.token));
  assert.match(insert.params[1], /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(insert.params[1], result.data.token);
});

test("portal bootstrap token cannot be issued to another Telegram account", async () => {
  const { db, calls } = fakeDb({ telegramId: 414638980 });
  const adapter = createD1Supabase(db, {});
  const result = await adapter.rpc("issue_portal_bootstrap_token", { p_telegram_user_id: 414638980 });
  assert.equal(result.error?.message, "bootstrap_forbidden");
  assert.equal(calls.some((call) => call.query.startsWith("INSERT INTO bootstrap_tokens")), false);
});

test("portal bootstrap token cannot overwrite an already initialized admin password", async () => {
  const { db, calls } = fakeDb({ adminHash: "pbkdf2_sha256$210000$salt$digest" });
  const adapter = createD1Supabase(db, {});
  const result = await adapter.rpc("issue_portal_bootstrap_token", { p_telegram_user_id: 8538226539 });
  assert.equal(result.error?.message, "bootstrap_already_complete");
  assert.equal(calls.some((call) => call.query.startsWith("INSERT INTO bootstrap_tokens")), false);
});
