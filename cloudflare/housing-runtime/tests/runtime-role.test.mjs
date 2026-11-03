import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runtime = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../../../supabase/migrations/20261103150000_cloudflare_housing_runtime_least_privilege.sql", import.meta.url), "utf8");

test("housing runtime reads only allow-listed Vault secrets through its scoped function", () => {
  assert.match(runtime, /app_private\.get_housing_runtime_secret/);
  assert.doesNotMatch(runtime, /public\.get_bot_secret/);
  assert.match(migration, /immoscout_central_cloudflare_api_secret/);
  assert.match(migration, /application_credential_key_v1/);
  assert.match(migration, /REVOKE ALL ON FUNCTION app_private\.get_housing_runtime_secret\(text\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION app_private\.get_housing_runtime_secret\(text\)[\s\S]*?TO cf_housing_runtime_20261103/);
});

test("runtime database role does not inherit service_role or bypass RLS", () => {
  assert.match(migration, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC/);
  assert.match(migration, /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_private[\s\S]*?REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/);
  assert.match(migration, /ALTER ROLE cf_housing_runtime_20261103[\s\S]*?NOLOGIN[\s\S]*?NOBYPASSRLS/);
  assert.match(migration, /REVOKE service_role FROM cf_housing_runtime_20261103/);
  assert.doesNotMatch(migration, /GRANT service_role TO cf_housing_runtime_20261103/);
  assert.doesNotMatch(migration, /^\s+BYPASSRLS\s*;/m);
});

test("runtime role receives table access only to the three central ImmoScout tables", () => {
  const grant = migration.match(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE([\s\S]*?)TO cf_housing_runtime_20261103/);
  assert.ok(grant);
  assert.deepEqual(
    [...grant[1].matchAll(/app_private\.([a-z_]+)/g)].map((match) => match[1]),
    [
      "immoscout_central_credentials",
      "immoscout_central_oauth_flows",
      "immoscout_central_audit_events",
    ],
  );
  assert.equal((migration.match(/CREATE POLICY cf_housing_runtime_access/g) || []).length, 3);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION app_private\.delete_expired_listings\(integer\)[\s\S]*?TO cf_housing_runtime_20261103/);
});

test("runtime role can advance only the central audit identity sequence", () => {
  assert.match(
    migration,
    /GRANT USAGE, SELECT, UPDATE ON SEQUENCE[\\s\\S]*?app_private\\.immoscout_central_audit_events_id_seq[\\s\\S]*?TO cf_housing_runtime_20261103/,
  );
});
