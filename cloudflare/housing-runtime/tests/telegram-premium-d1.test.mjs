import test from "node:test";
import { createD1Supabase } from "../src/telegram-legacy/d1-supabase.js";

function freeParticipantDatabase() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async all() {
              calls.push({ sql, params });
              if (sql.startsWith("SELECT id,status,telegram_user_id,test_auto_apply_allowed")) {
                return { results: [{ id: "free-user", status: "active", telegram_user_id: 1234, test_auto_apply_allowed: 0 }] };
              }
              if (sql.startsWith("SELECT immoscout_enabled,immowelt_enabled,immomio_enabled")) {
                return { results: [{ immoscout_enabled: 0, immowelt_enabled: 0, immomio_enabled: 0 }] };
              }
              if (sql.startsWith("SELECT p.plan_override")) {
                return { results: [{ plan_override: "free", subscription_status: null }] };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

test("Telegram D1 rejects extra search profiles for Free accounts", async () => {
  const database = freeParticipantDatabase();
  const api = createD1Supabase(database, {});
  const result = await api.rpc("save_search_profile_ui", { p_user: "free-user", p_values: { profile_slot: 2 } });
  assert.match(result.error?.message || "", /premium_required/);
  assert.ok(!database.calls.some(({sql}) => /INSERT INTO search_profiles/.test(sql)));
});

test("Telegram D1 rejects enabling AutoApply for Free accounts", async () => {
  const database = freeParticipantDatabase();
  const api = createD1Supabase(database, {});
  const result = await api.rpc("set_telegram_auto_apply_sources", {
    p_user: "free-user", p_telegram_user_id: 1234, p_enabled: true,
  });
  assert.match(result.error?.message || "", /premium_required/);
  assert.ok(!database.calls.some(({sql}) => /UPDATE application_preferences/.test(sql)));
});

import assert from "node:assert/strict";
import { withPlan } from "../src/telegram-legacy/runtime.js";

test("premium access is resolved from active and trialing D1 subscriptions", async () => {
  const user = { id: "u1", plan_override: null, referral_bonus_until: null };
  assert.equal((await withPlan(user, { status: "active", current_period_end: "2099-01-01T00:00:00.000Z" })).is_premium, true);
  assert.equal((await withPlan(user, { status: "trialing", current_period_end: "2099-01-01T00:00:00.000Z" })).is_premium, true);
  assert.equal((await withPlan(user, { status: "canceled", current_period_end: "2099-01-01T00:00:00.000Z" })).is_premium, false);
});

test("premium overrides and referral bonus preserve precedence over subscription state", async () => {
  const now = new Date(Date.now() + 60_000).toISOString();
  assert.equal((await withPlan({ plan_override: "free" }, { status: "active", current_period_end: "2099-01-01" })).is_premium, false);
  assert.equal((await withPlan({ plan_override: "premium", plan_override_expires_at: now }, null)).is_premium, true);
  assert.equal((await withPlan({ referral_bonus_until: "2099-01-01T00:00:00.000Z" }, null)).is_premium, true);
});
