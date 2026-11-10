import test from "node:test";
import assert from "node:assert/strict";
import { createD1Supabase } from "../src/telegram-legacy/d1-supabase.js";

const ownerId = "owner-1";
const ownerTelegramId = 8538226539;
const completeProfile = {
  first_name: "Arash", last_name: "Tawakoli", email: "arash@nexalabs.de",
  phone: "+491700000000", street: "Kreuzweg", house_number: "7",
  postcode: "20099", city: "Hamburg",
};

function fakeD1({ centralEnabled = 0, complete = true, testEnabled = false, telegramId = ownerTelegramId } = {}) {
  const calls = [];
  const profile = complete ? completeProfile : { first_name: "Arash" };
  const participant = {
    id: ownerId, telegram_user_id: telegramId, status: "active",
    auto_apply_enabled: 0, test_auto_apply_allowed: 1,
    test_auto_apply_enabled: testEnabled ? 1 : 0, test_auto_apply_daily_limit: 1,
  };
  const db = {
    prepare(query) {
      return {
        bind(...params) {
          return {
            all: async () => {
              calls.push({ query, params });
              if (query.startsWith("SELECT id,telegram_user_id,status")) return { results: telegramId === ownerTelegramId ? [participant] : [], meta: { changes: 0 } };
              if (query.startsWith("SELECT profile FROM applicant_profiles")) return { results: [{ profile: JSON.stringify(profile) }], meta: { changes: 0 } };
              if (query.startsWith("SELECT sp.id FROM search_profiles")) return { results: [{ id: "search-1" }], meta: { changes: 0 } };
              if (query.startsWith("SELECT account_hint,status,enabled,ciphertext,iv FROM central_credentials")) return {
                results: [{ account_hint: "arash@nexalabs.de", status: "connected", enabled: centralEnabled, ciphertext: "encrypted", iv: "iv" }],
                meta: { changes: 0 },
              };
              if (query.startsWith("SELECT test_auto_apply_allowed")) return {
                results: [{ test_auto_apply_allowed: 1, test_auto_apply_enabled: testEnabled ? 1 : 0, test_auto_apply_daily_limit: 1 }],
                meta: { changes: 0 },
              };
              return { results: [], meta: { changes: query.startsWith("UPDATE") ? 1 : 0 } };
            },
          };
        },
        all: async () => ({ results: [], meta: { changes: 0 } }),
      };
    },
  };
  return { adapter: createD1Supabase(db, {}), calls };
}

test("only the allowlisted NexaLabs owner can enable personal ImmoScout test mode", async () => {
  const { adapter, calls } = fakeD1();
  const result = await adapter.rpc("set_application_test_mode", {
    p_user: ownerId, p_telegram_user_id: ownerTelegramId, p_enabled: true,
  });
  assert.equal(result.error, null);
  assert.equal(result.data.enabled, false); // final SELECT is represented by the fake D1 response
  assert.ok(calls.some(({ query }) => query.startsWith("UPDATE participants SET test_auto_apply_daily_limit=1,test_auto_apply_enabled=1")));
  assert.equal(calls.some(({ query }) => /UPDATE provider_connections|UPDATE application_preferences/.test(query)), false);
});

test("test mode refuses activation when the central credential is enabled", async () => {
  const { adapter, calls } = fakeD1({ centralEnabled: 1 });
  const result = await adapter.rpc("set_application_test_mode", {
    p_user: ownerId, p_telegram_user_id: ownerTelegramId, p_enabled: true,
  });
  assert.equal(result.error?.message, "test_mode_central_account_unavailable");
  assert.equal(calls.some(({ query }) => query.startsWith("UPDATE participants SET test_auto_apply_daily_limit=1")), false);
});

test("test mode refuses activation with an incomplete applicant profile", async () => {
  const { adapter } = fakeD1({ complete: false });
  const result = await adapter.rpc("set_application_test_mode", {
    p_user: ownerId, p_telegram_user_id: ownerTelegramId, p_enabled: true,
  });
  assert.equal(result.error?.message, "test_mode_profile_incomplete");
});

test("test mode can be disabled without touching participant platform credentials", async () => {
  const { adapter, calls } = fakeD1({ testEnabled: true });
  const result = await adapter.rpc("set_application_test_mode", {
    p_user: ownerId, p_telegram_user_id: ownerTelegramId, p_enabled: false,
  });
  assert.equal(result.error, null);
  assert.ok(calls.some(({ query }) => query.startsWith("UPDATE participants SET test_auto_apply_enabled=0")));
  assert.ok(calls.some(({ query }) => query.startsWith("UPDATE applications SET status='failed',last_error='test_mode_disabled'")));
  assert.equal(calls.some(({ query }) => /UPDATE provider_connections|UPDATE application_preferences/.test(query)), false);
});

test("the normal auto-apply switch cannot be enabled while personal test mode is active", async () => {
  const { adapter, calls } = fakeD1({ testEnabled: true });
  const result = await adapter.rpc("set_application_enabled_shared", { p_user: ownerId, p_enabled: true });
  assert.equal(result.error?.message, "test_mode_active");
  assert.equal(calls.some(({ query }) => query.startsWith("UPDATE application_preferences SET enabled=")), false);
});
