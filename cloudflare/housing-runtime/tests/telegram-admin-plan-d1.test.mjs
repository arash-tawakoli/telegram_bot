import test from "node:test";
import assert from "node:assert/strict";
import { configureLegacyRuntime } from "../src/telegram-legacy/runtime.js";
import { setPlanOverride } from "../src/telegram-legacy/admin.js";

function fakeD1() {
  const batches = [];
  const database = {
    prepare(sql) {
      return { bind(...params) { return { sql, params }; } };
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map((statement, index) => ({
        results: index === 0 ? [{ id: statement.params[2], chat_id: 1234 }] : [],
        meta: { changes: 1 },
      }));
    },
  };
  configureLegacyRuntime({ HOUSING_DB: database }, database);
  return batches;
}

test("Telegram admin Premium grants return the persisted participant and chat", async () => {
  const batches = fakeD1();
  const updated = await setPlanOverride("participant-1", "30d");
  assert.deepEqual(updated, { id: "participant-1", chat_id: 1234 });
  assert.equal(batches[0].length, 1);
  assert.match(batches[0][0].sql, /UPDATE participants SET plan_override=/);
  assert.match(batches[0][0].sql, /RETURNING id,telegram_chat_id AS chat_id/);
  assert.equal(batches[0][0].params[0], "premium");
  assert.ok(Date.parse(batches[0][0].params[1]) > Date.now());
});

test("Telegram admin Free downgrade atomically pauses Premium-only functions", async () => {
  const batches = fakeD1();
  const updated = await setPlanOverride("participant-2", "free");
  assert.deepEqual(updated, { id: "participant-2", chat_id: 1234 });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 4);
  assert.equal(batches[0][0].params[0], "free");
  assert.match(batches[0][1].sql, /UPDATE search_profiles SET active=0/);
  assert.match(batches[0][1].sql, /profile_slot>1/);
  assert.match(batches[0][2].sql, /UPDATE application_preferences SET enabled=0/);
  assert.match(batches[0][3].sql, /UPDATE participants SET auto_apply_enabled=0/);
});
