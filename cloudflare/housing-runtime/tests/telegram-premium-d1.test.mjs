import test from "node:test";
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
