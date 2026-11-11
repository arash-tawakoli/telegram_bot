import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runtime = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const schema = await readFile(new URL("../schema/d1/0001_housing_core.sql", import.meta.url), "utf8");

test("housing runtime uses D1 without an upstream authentication dependency", () => {
  assert.match(runtime, /env\.HOUSING_DB/);
  assert.doesNotMatch(runtime, /env\.HYPERDRIVE|env\.LEGACY_D1/);
  assert.doesNotMatch(runtime, /SUPABASE_|supabase\.co|verifyMigratedSupabasePassword|verifyRecoveryAccessToken/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS central_credentials/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS provider_auth_flows/);
});

test("D1 has no public database role surface", () => {
  assert.match(runtime, /worker_authorization/);
  assert.match(runtime, /listingAccess: "denied"/);
});

test("central D1 state is separate from offers and applications", () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS central_credentials/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS central_oauth_flows/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS central_audit_events/);
});

