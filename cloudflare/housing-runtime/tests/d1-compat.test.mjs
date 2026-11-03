import test from "node:test";
import assert from "node:assert/strict";
import { createD1Compat, rewriteD1Sql } from "../src/d1-compat.js";

test("D1 central credential statements map to private PostgreSQL tables", () => {
  const query = rewriteD1Sql(
    "INSERT INTO central_credentials(singleton,enabled) VALUES(?,?) ON CONFLICT(singleton) DO UPDATE SET enabled=CASE WHEN ?=1 THEN central_credentials.enabled ELSE 0 END",
  );
  assert.match(query, /INSERT INTO app_private\.immoscout_central_credentials AS central_credentials/);
  assert.match(query, /VALUES\(\$1,\$2\)/);
  assert.match(query, /central_credentials\.enabled/);
  assert.match(query, /THEN central_credentials\.enabled ELSE 0 END/);
});

test("D1 OAuth and audit statements map to private PostgreSQL tables", () => {
  assert.equal(
    rewriteD1Sql("SELECT * FROM oauth_flows WHERE state_hash=?"),
    "SELECT * FROM app_private.immoscout_central_oauth_flows WHERE state_hash=$1",
  );
  assert.equal(
    rewriteD1Sql("INSERT INTO audit_events(event_type) VALUES(?)"),
    "INSERT INTO app_private.immoscout_central_audit_events(event_type) VALUES($1)",
  );
  assert.equal(
    rewriteD1Sql("DELETE FROM oauth_flows WHERE expires_at<CURRENT_TIMESTAMP"),
    "DELETE FROM app_private.immoscout_central_oauth_flows WHERE expires_at<CURRENT_TIMESTAMP",
  );
});

test("D1 compatibility adapter exposes first, all and affected-row metadata", async () => {
  const calls = [];
  const sql = {
    async unsafe(query, values) {
      calls.push({ query, values });
      const rows = [{ id: "row-1" }];
      rows.count = query.startsWith("UPDATE") ? 1 : rows.length;
      return rows;
    },
  };
  const db = createD1Compat(sql);

  const first = await db.prepare("SELECT * FROM central_credentials WHERE singleton=?").bind("central").first();
  assert.equal(first.id, "row-1");

  const all = await db.prepare("SELECT * FROM audit_events").bind().all();
  assert.equal(all.results.length, 1);

  const run = await db.prepare("UPDATE central_credentials SET enabled=? WHERE singleton=?").bind(0, "central").run();
  assert.equal(run.meta.changes, 1);
  assert.equal(calls[0].values[0], "central");
});
