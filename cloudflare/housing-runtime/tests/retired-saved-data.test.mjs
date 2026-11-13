import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

test("retired saved-listing tables and redundant application/listing archives are removed", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec([
      "CREATE TABLE saved_listings (id TEXT PRIMARY KEY);",
      "CREATE TABLE telegram_saved_effects (update_id INTEGER PRIMARY KEY);",
      "CREATE TABLE application_dedupe_keys (key_hash TEXT PRIMARY KEY);",
      "CREATE TABLE supabase_archive_rows (schema_name TEXT NOT NULL, table_name TEXT NOT NULL, row_key TEXT NOT NULL, row_index INTEGER NOT NULL, payload_json TEXT NOT NULL, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(schema_name,table_name,row_key));",
      "INSERT INTO supabase_archive_rows(schema_name,table_name,row_key,row_index,payload_json) VALUES ('public','applications','a',0,'{}'),('public','application_events','e',0,'{}'),('public','saved_listings','s',0,'{}'),('public','listings','l',0,'{}'),('public','source_connectors','c',0,'{}'),('public','geo_areas','g',0,'{}');",
    ].join("\n"));
    db.exec(readFileSync(new URL("../schema/d1/0017_retire_saved_listings_and_archive_payloads.sql", import.meta.url), "utf8"));
    const table = name => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    assert.equal(table("saved_listings"), undefined);
    assert.equal(table("telegram_saved_effects"), undefined);
    assert.ok(table("application_dedupe_keys"));
    assert.deepEqual(
      db.prepare("SELECT table_name FROM supabase_archive_rows ORDER BY table_name").all().map(row => row.table_name),
      ["geo_areas", "source_connectors"],
    );
  } finally {
    db.close();
  }
});
