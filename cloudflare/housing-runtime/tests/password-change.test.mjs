import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { handleAuth } from "../src/index.js";
import { hashPassword } from "../src/auth.js";

globalThis.crypto ||= webcrypto;

function fakeSql(session) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (/SELECT s\.id AS session_id/i.test(text)) return session ? [session] : [];
    if (/UPDATE housing\.portal_members/i.test(text)) return [{ id: session?.member_id || "member-1" }];
    return [];
  };
  return { sql, calls };
}

test("authenticated password change verifies the current password and revokes other sessions", async () => {
  const currentPassword = "current-password-123";
  const nextPassword = "new-password-456";
  const currentHash = await hashPassword(currentPassword);
  const db = fakeSql({ session_id: "current-session", member_id: "member-1", password_hash: currentHash });
  const response = await handleAuth(db.sql, new Request("https://runtime.test/edge/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "password_change",
      access_token: "current-access-token",
      current_password: currentPassword,
      password: nextPassword,
    }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, changed: true });
  assert.ok(db.calls.some(({ text, values }) => /UPDATE housing\.portal_members/.test(text) && values.some((value) => String(value).startsWith("pbkdf2_sha256$"))));
  assert.ok(db.calls.some(({ text, values }) => /UPDATE housing\.portal_sessions/.test(text) && values.includes("current-session")));
  assert.equal(db.calls.some(({ text }) => /service_role|SUPABASE_SERVICE_ROLE_KEY/.test(text)), false);
});

test("authenticated password change rejects an incorrect current password", async () => {
  const currentHash = await hashPassword("current-password-123");
  const db = fakeSql({ session_id: "current-session", member_id: "member-1", password_hash: currentHash });
  const response = await handleAuth(db.sql, new Request("https://runtime.test/edge/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "password_change",
      access_token: "current-access-token",
      current_password: "wrong-password-123",
      password: "new-password-456",
    }),
  }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "current_password_invalid" });
  assert.equal(db.calls.some(({ text }) => /UPDATE housing\.portal_members/.test(text)), false);
});
