import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runtime = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const config = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");

test("one-time migration reads the existing D1 tables directly and imports only through Hyperdrive", () => {
  assert.match(runtime, /env\.LEGACY_D1/);
  assert.match(runtime, /FROM central_credentials/);
  assert.match(runtime, /FROM oauth_flows/);
  assert.match(runtime, /FROM audit_events/);
  assert.match(runtime, /verifyLegacyD1SnapshotKey/);
  assert.match(runtime, /importLegacyD1Snapshot/);
  assert.match(runtime, /dry_run/);
  assert.doesNotMatch(runtime, /immoscout-central-token-staging\.arash-ce5\.workers\.dev/);
  assert.match(config, /"binding": "LEGACY_D1"/);
  assert.match(config, /"database_id": "08789b5f-f200-4985-a357-276052206852"/);
  assert.match(config, /"binding": "HYPERDRIVE"/);
});
