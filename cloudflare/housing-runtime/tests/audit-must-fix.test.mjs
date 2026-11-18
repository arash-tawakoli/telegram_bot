import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { applicationSchedule, sqlTime } from "../src/application-policy.js";
import { listingCategory } from "../src/matching.js";
import { memberForAccess, sha256 } from "../src/auth.js";
import { createD1Client } from "../src/d1-database.js";

function d1() {
  const sqlite = new DatabaseSync(":memory:");
  const schema = new URL("../schema/d1/", import.meta.url);
  for (const file of readdirSync(schema).filter(x => x.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file, schema), "utf8"));
  const prepare = (query) => {
    const make = (values) => ({
      all: async () => {
        const statement = sqlite.prepare(query);
        if (/^\s*(SELECT|WITH)/i.test(query) || /\bRETURNING\b/i.test(query)) return { results: statement.all(...values), meta: { changes: 0 } };
        return { results: [], meta: { changes: Number(statement.run(...values).changes) } };
      },
      run: async () => ({ meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } }),
      first: async () => sqlite.prepare(query).get(...values) ?? null,
    });
    return { bind: (...values) => make(values), ...make([]) };
  };
  return { sqlite, db: { prepare, batch: async (statements) => Promise.all(statements.map((s) => s.all())) } };
}

test("retry times use D1's text format, so they compare correctly with CURRENT_TIMESTAMP", () => {
  const { sqlite } = d1();
  const past = sqlTime(new Date(Date.now() - 60_000));
  const future = sqlTime(new Date(Date.now() + 60_000));
  assert.match(past, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(sqlite.prepare("SELECT ? <= CURRENT_TIMESTAMP AS due").get(past).due, 1);
  assert.equal(sqlite.prepare("SELECT ? <= CURRENT_TIMESTAMP AS due").get(future).due, 0);
  const blocked = applicationSchedule({ allowed_weekdays: [] , send_window_start: "00:00", send_window_end: "00:01" }, new Date("2026-11-18T12:00:00Z"));
  assert.equal(blocked.allowed, false);
  assert.match(blocked.nextAttemptAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("expired portal access tokens are rejected on the same day", async () => {
  const { sqlite, db } = d1();
  sqlite.exec("INSERT INTO portal_members(id,email,display_name,role,active,password_hash) VALUES('m1','coach@example.test','Coach','admin',1,'x')");
  const insert = sqlite.prepare("INSERT INTO portal_sessions(id,member_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES(?,?,?,?,?,?)");
  const later = new Date(Date.now() + 86_400_000).toISOString();
  insert.run("s1", "m1", await sha256("expired"), await sha256("r1"), new Date(Date.now() - 60_000).toISOString(), later);
  insert.run("s2", "m1", await sha256("valid"), await sha256("r2"), new Date(Date.now() + 60_000).toISOString(), later);
  const sql = createD1Client(db);
  assert.equal(await memberForAccess(sql, "expired"), null);
  assert.equal((await memberForAccess(sql, "valid"))?.id, "m1");
});

test("house listings get the house message", () => {
  assert.equal(listingCategory({ title: "Schönes Einfamilienhaus in Kiel" }), "Haus");
  assert.equal(listingCategory({ title: "Haus zur Miete" }), "Haus");
  assert.equal(listingCategory({ title: "2-Zimmer-Wohnung in Altona" }), "Wohnung");
});
