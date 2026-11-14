import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/auth.js";
import { handleAuth } from "../src/index.js";

test("password hashes verify without storing the plaintext", async () => {
  const encoded = await hashPassword("correct horse battery staple");
  assert.match(encoded, /^bcrypt_sha256\$\$2[ab]\$12\$/);
  assert.equal(await verifyPassword("correct horse battery staple", encoded), true);
  assert.equal(await verifyPassword("wrong password", encoded), false);
});

test("password hashing enforces the portal minimum", async () => {
  await assert.rejects(() => hashPassword("short"), /password_invalid/);
});

test("password hashing distinguishes characters after bcrypt's 72-byte boundary", async () => {
  const prefix = "x".repeat(80);
  const encoded = await hashPassword(prefix + "a");
  assert.equal(await verifyPassword(prefix + "a", encoded), true);
  assert.equal(await verifyPassword(prefix + "b", encoded), false);
});

test("migration-required marker is never accepted as a password hash", async () => {
  assert.equal(await verifyPassword("correct horse battery staple", "migration_required$00000000-0000-4000-8000-000000000000"), false);
});


for (const action of ["login", "password_change", "password_reset_complete"]) {
  test(`retired ${action} cannot call an upstream or alter D1`, async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => { throw new Error("upstream auth must never be called"); };
      const sql = async () => { throw new Error("retired auth must not access the database"); };
      const response = await handleAuth(sql, new Request("https://housing-runtime.test/edge/auth", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, email: "admin@example.test", password: "a temporary test password" }),
      }));
      assert.equal(response.status, 410);
      assert.deepEqual(await response.json(), { error: "portal_auth_required" });
    } finally { globalThis.fetch = originalFetch; }
  });
}


test("portal bootstrap accepts the configured admin email", async () => {
  const unsafeCalls = [];
  const sql = async () => [];
  sql.unsafe = async (query, params = []) => {
    unsafeCalls.push({ query, params });
    if (query.includes("SELECT id, lower(email) AS email")) {
      return [{ id: "admin-1", email: "arash@nexalabs.de", password_hash: "migration_required$seed" }];
    }
    if (query.includes("UPDATE housing.bootstrap_tokens")) return [{ id: "token-1" }];
    if (query.includes("UPDATE housing.portal_members SET display_name")) return [{ id: "admin-1" }];
    return [];
  };
  const response = await handleAuth(sql, new Request("https://housing-runtime.test/edge/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "bootstrap_complete",
      token: "valid-once-token",
      email: "arash@nexalabs.de",
      displayName: "Arash",
      password: "a sufficiently strong test password",
    }),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.ok(unsafeCalls.some(({ query }) => query.includes("UPDATE housing.portal_members SET display_name")));
});
