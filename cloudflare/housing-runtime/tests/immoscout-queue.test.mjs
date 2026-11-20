import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker from "../src/index.js";

// minute 1 of the rotation is source 1 (Hamburg); minute 2 is Berlin (72) plus Kleinanzeigen (2).
const run = async (env, minute) => {
  let work;
  const logged = [];
  const original = console.error, originalLog = console.log, originalWarn = console.warn;
  console.error = (...args) => logged.push(args.join(" "));
  console.log = () => {}; console.warn = () => {};
  try {
    await worker.scheduled({ scheduledTime: minute * 60_000 }, env, { waitUntil: promise => { work = promise; } });
    await work;
  } finally { console.error = original; console.log = originalLog; console.warn = originalWarn; }
  return logged;
};
const brokenDatabase = () => ({ prepare() { throw new Error("database accessed"); } });
const inlineSourceRuns = logged => logged.filter(line => line.startsWith("housing_source_scheduled_failed"));

test("the cron only enqueues the ImmoScout regions; other sources still run inline", async () => {
  const sent = [];
  const env = { SOURCE_RUN_TOKEN: "t", HOUSING_DB: brokenDatabase(), IMMOSCOUT_SWEEP_QUEUE: { send: async body => { sent.push(body); } } };
  const hamburg = await run(env, 1);
  assert.deepEqual(sent.map(m => m.source_id), [1]);
  assert.equal(inlineSourceRuns(hamburg).length, 0, "the sweep does not run inside the cron invocation");

  // Rotation slot 3 is Immomio (source 3): not an ImmoScout region, so it is never queued.
  const other = await run(env, 3);
  assert.deepEqual(sent.map(m => m.source_id), [1], "other sources are not enqueued");
  assert.equal(inlineSourceRuns(other).length, 1, "other sources stay on the cron");
});

test("without a queue binding, or when the send fails, the region runs inline", async () => {
  const noQueue = await run({ SOURCE_RUN_TOKEN: "t", HOUSING_DB: brokenDatabase() }, 1);
  assert.equal(inlineSourceRuns(noQueue).length, 1);
  const failing = await run({ SOURCE_RUN_TOKEN: "t", HOUSING_DB: brokenDatabase(), IMMOSCOUT_SWEEP_QUEUE: { send: async () => { throw new Error("queue down"); } } }, 1);
  assert.ok(failing.some(line => line.startsWith("immoscout_sweep_enqueue_failed")));
  assert.equal(inlineSourceRuns(failing).length, 1);
});

test("the queue consumer runs one allowlisted, fresh region per message and always acks", async () => {
  const touched = [];
  const env = { SOURCE_RUN_TOKEN: "t", HOUSING_DB: { prepare(query) { touched.push(query); throw new Error("database accessed"); } } };
  const message = (body) => { const m = { body, acked: 0, ack() { m.acked++; } }; return m; };
  const messages = [
    message({ source_id: 72, at: Date.now() }),
    message({ source_id: 3, at: Date.now() }),               // not an ImmoScout region
    message({ source_id: 72, at: Date.now() - 11 * 60_000 }), // stale
    message({ source_id: 72 }),                              // no timestamp
  ];
  const original = console.error, warn = console.warn;
  console.error = () => {}; console.warn = () => {};
  try { await worker.queue({ messages }, env); } finally { console.error = original; console.warn = warn; }
  assert.deepEqual(messages.map(m => m.acked), [1, 1, 1, 1], "every message is acked, none is retried");
  assert.ok(touched.length > 0, "the fresh region message ran");
  const before = touched.length;
  await worker.queue({ messages: [message({ source_id: 3, at: Date.now() }), message({ source_id: 72, at: 1 })] }, env);
  assert.equal(touched.length, before, "unlisted and stale messages never touch the database");
});

test("a preview neither enqueues nor consumes", async () => {
  const sent = [];
  const env = { SOURCE_RUN_TOKEN: "t", PREVIEW_MODE: "1", HOUSING_DB: brokenDatabase(), IMMOSCOUT_SWEEP_QUEUE: { send: async body => { sent.push(body); } } };
  await run(env, 1);
  assert.equal(sent.length, 0);
  let acked = 0;
  await worker.queue({ messages: [{ body: { source_id: 1, at: Date.now() }, ack() { acked++; } }] }, env);
  assert.equal(acked, 1);
});

test("wrangler declares a single-message, no-retry consumer and a producer on the same queue; previews get no producer", async () => {
  const config = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /"binding": "IMMOSCOUT_SWEEP_QUEUE"/);
  assert.match(config, /"max_batch_size": 1/);
  assert.match(config, /"max_retries": 0/);
  const previews = config.slice(config.indexOf('"previews"'));
  assert.doesNotMatch(previews, /IMMOSCOUT_SWEEP_QUEUE/);
});
