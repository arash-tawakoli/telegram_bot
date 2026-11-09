import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/auth.js";

test("password hashes verify without storing the plaintext", async () => {
  const encoded = await hashPassword("correct horse battery staple");
  assert.match(encoded, /^pbkdf2_sha256\$/);
  assert.equal(await verifyPassword("correct horse battery staple", encoded), true);
  assert.equal(await verifyPassword("wrong password", encoded), false);
});

test("password hashing enforces the portal minimum", async () => {
  await assert.rejects(() => hashPassword("short"), /password_invalid/);
});

test("migration-required marker is never accepted as a password hash", async () => {
  assert.equal(await verifyPassword("correct horse battery staple", "migration_required$00000000-0000-4000-8000-000000000000"), false);
});
