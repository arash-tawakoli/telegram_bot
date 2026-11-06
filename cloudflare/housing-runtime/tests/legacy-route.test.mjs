import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runtime = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const config = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");

test("central token state lives in the primary Cloudflare D1 binding", () => {
  assert.match(runtime, /FROM central_credentials/);
  assert.match(runtime, /FROM central_oauth_flows/);
  assert.match(runtime, /FROM central_audit_events/);
  assert.doesNotMatch(runtime, /env\.LEGACY_D1/);
  assert.doesNotMatch(runtime, /migrateLegacyCentralToken/);
  assert.doesNotMatch(config, /"binding": "LEGACY_D1"/);
  assert.match(config, /"binding": "HOUSING_DB"/);
  assert.match(config, /"database_name": "traumwohnung-housing-core"/);
  assert.doesNotMatch(config, /"binding": "HYPERDRIVE"/);
});

test("preview runtime blocks state-changing internal routes", () => {
  assert.match(runtime, /env\.PREVIEW_MODE === "1" && !\(request\.method === "GET" && routePath === "\/internal\/status"\)/);
  assert.match(config, /"PREVIEW_MODE": "1"/);
});
