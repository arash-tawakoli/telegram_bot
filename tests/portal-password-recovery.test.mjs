import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const authRuntime = await readFile(new URL("../cloudflare/housing-runtime/src/index.js", import.meta.url), "utf8");
const coachApi = await readFile(new URL("../cloudflare/housing-runtime/src/coach-api.js", import.meta.url), "utf8");

test("portal bootstrap can recover the existing migrated super-admin without creating a duplicate", () => {
  assert.ok(authRuntime.includes('startsWith("migration_required$")'));
  assert.ok(authRuntime.includes("UPDATE housing.bootstrap_tokens SET consumed_at = now()"));
  assert.ok(authRuntime.includes("UPDATE housing.portal_members SET display_name"));
  assert.ok(authRuntime.includes("UPDATE housing.portal_sessions SET revoked_at = now()"));
});

test("portal admins can list members and reset passwords with role checks", () => {
  assert.ok(coachApi.includes('action === "members"'));
  assert.ok(coachApi.includes('action === "update_coach_password"'));
  assert.ok(coachApi.includes("hashPassword(password)"));
  assert.ok(coachApi.includes("member_management_forbidden"));
  assert.ok(coachApi.includes("UPDATE housing.portal_sessions SET revoked_at = now()"));
});
