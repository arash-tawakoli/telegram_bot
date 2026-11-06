import test from "node:test";
import assert from "node:assert/strict";
import { deleteExpiredListings } from "../src/retention.js";

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
