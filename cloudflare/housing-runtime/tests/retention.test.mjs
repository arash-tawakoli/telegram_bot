import test from "node:test";
import assert from "node:assert/strict";
import { deleteExpiredListings } from "../src/retention.js";

test("retention calls the database function with a bounded batch size", async () => {
  let captured;
  const sql = (strings, ...values) => {
    captured = { query: strings.join("?"), values };
    return Promise.resolve([{ deleted: 17 }]);
  };

  const deleted = await deleteExpiredListings(sql, 250);

  assert.equal(deleted, 17);
  assert.deepEqual(captured.values, [250]);
  assert.match(captured.query, /app_private.delete_expired_listings/);
});

test("retention rejects invalid batch sizes before calling the database", async () => {
  let called = false;
  const sql = () => {
    called = true;
    return Promise.resolve([{ deleted: 0 }]);
  };

  await assert.rejects(() => deleteExpiredListings(sql, 0), /retention_limit_invalid/);
  await assert.rejects(() => deleteExpiredListings(sql, 5001), /retention_limit_invalid/);
  assert.equal(called, false);
});

test("retention rejects malformed database results", async () => {
  const sql = () => Promise.resolve([{ deleted: 1001 }]);
  await assert.rejects(() => deleteExpiredListings(sql, 1000), /retention_result_invalid/);
});
