import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { deleteExpiredListings, expireAdminPremiumOverrides } from "../src/retention.js";

function fakeSql(expired = [], deleted = 0) {
  const queries = [];
  const tx = (strings, ...values) => {
    const query = strings.join("?");
    queries.push({ query, values });
    if (/SELECT id/i.test(query)) return Promise.resolve(expired);
    if (/DELETE FROM housing\.offer_identities/i.test(query)) {
      const result = [];
      result.count = deleted;
      return Promise.resolve(result);
    }
    return Promise.resolve([]);
  };
  tx.unsafe = (query, values = []) => {
    queries.push({ query, values });
    if (/DELETE FROM housing\.offer_identities/i.test(query)) {
      const result = [];
      result.count = deleted;
      return Promise.resolve(result);
    }
    return Promise.resolve([]);
  };
  return { queries, begin: async (callback) => callback(tx) };
}

test("retention detaches and deletes an expired bounded batch", async () => {
  const sql = fakeSql([{ id: "offer-1" }], 1);
  const deleted = await deleteExpiredListings(sql, 250);

  assert.equal(deleted, 1);
  assert.match(sql.queries[0].query, /housing\.offer_identities/);
  assert.equal(sql.queries[0].values[0], 250);
  assert.equal(sql.queries.filter(({ query }) => /UPDATE housing\.(applications|deliveries)/i.test(query)).length, 2);
});

test("retention returns zero without expired offers", async () => {
  assert.equal(await deleteExpiredListings(fakeSql(), 100), 0);
});

test("retention rejects invalid batch sizes before opening a transaction", async () => {
  let called = false;
  const sql = { begin: async () => { called = true; return 0; } };

  await assert.rejects(() => deleteExpiredListings(sql, 0), /retention_limit_invalid/);
  await assert.rejects(() => deleteExpiredListings(sql, 5001), /retention_limit_invalid/);
  assert.equal(called, false);
});

test("retention rejects malformed database results", async () => {
  await assert.rejects(() => deleteExpiredListings(fakeSql([{ id: "offer-1" }], 1001), 1000), /retention_result_invalid/);
});

test("premium override expiry clears only expired premium overrides", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    const schema = new URL("../schema/d1/", import.meta.url);
    for (const file of readdirSync(schema).filter(name => name.endsWith(".sql")).sort()) {
      sqlite.exec(readFileSync(new URL(file, schema), "utf8"));
    }
    sqlite.exec(`
      INSERT INTO participants(id,first_name,last_name,plan_override,plan_override_expires_at) VALUES
        ('expired','A','B','premium',datetime('now','-1 day')),
        ('current','C','D','premium','2099-01-01T00:00:00.000Z'),
        ('permanent','E','F','premium',NULL),
        ('free','G','H','free',datetime('now','-1 day'))
    `);
    const sql = async (strings, ...values) => sqlite.prepare(strings.join("?").replaceAll("housing.participants", "participants")).all(...values);

    assert.equal(await expireAdminPremiumOverrides(sql), 1);
    assert.equal(await expireAdminPremiumOverrides(sql), 0);
    const row = id => sqlite.prepare("SELECT plan_override,plan_override_expires_at FROM participants WHERE id=?").get(id);
    assert.equal(row("expired").plan_override, null);
    assert.equal(row("expired").plan_override_expires_at, null);
    assert.equal(row("current").plan_override, "premium");
    assert.equal(row("current").plan_override_expires_at, "2099-01-01T00:00:00.000Z");
    assert.equal(row("permanent").plan_override, "premium");
    assert.equal(row("permanent").plan_override_expires_at, null);
    assert.equal(row("free").plan_override, "free");
    assert.ok(Date.parse(row("free").plan_override_expires_at) < Date.now());
  } finally {
    sqlite.close();
  }
});
