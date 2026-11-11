import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("snapshot import rejects excluded application tables before connecting", () => {
  const dir = mkdtempSync(join(tmpdir(), "housing-snapshot-scope-"));
  try {
    for (const table of ["applications", "application_events"]) {
      const file = join(dir, "snapshot.json");
      writeFileSync(file, JSON.stringify({ version: 1, allowlist: [1], tables: { [table]: [] } }));
      const result = spawnSync(process.execPath, [new URL("../scripts/import-housing-snapshot.mjs", import.meta.url).pathname, "--apply"], {
        env: { ...process.env, TARGET_DATABASE_URL: "postgres://invalid.invalid/unused", HOUSING_SNAPSHOT_FILE: file },
        encoding: "utf8", timeout: 5000,
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`snapshot_table_forbidden:${table}`));
      assert.doesNotMatch(result.stderr, /ENOTFOUND|ECONNREFUSED/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
