import test from "node:test";
import assert from "node:assert/strict";
import { runClaimedJob } from "../supabase/functions/source-worker/job-runner.ts";
import { checked } from "../supabase/functions/source-worker/checked.ts";
const job = { job_id: "job-1", source_id: 3, attempt: 2 };
test("successful crawl acknowledges exactly its claimed attempt", async () => {
  const calls = [];
  const result = await runClaimedJob(
    job,
    async (id) => ({ ok: true, source_id: id }),
    async (args) => {
      calls.push(args);
      return true;
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    { p_job_id: "job-1", p_attempt: 2, p_success: true, p_error: null },
  ]);
});
test("a thrown crawl error is recorded once", async () => {
  const calls = [];
  const result = await runClaimedJob(
    job,
    async () => {
      throw new Error("provider unavailable");
    },
    async (args) => {
      calls.push(args);
      return true;
    },
  );
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].p_success, false);
  assert.match(calls[0].p_error, /provider unavailable/);
});
test("an adapter failure is not acknowledged as success", async () => {
  await runClaimedJob(
    job,
    async () => ({ ok: false }),
    async (args) => {
      assert.equal(args.p_success, false);
      return true;
    },
  );
});
test("lost acknowledgement response never issues a contradictory finish", async () => {
  let calls = 0;
  await assert.rejects(
    runClaimedJob(
      job,
      async () => ({ ok: true }),
      async () => {
        calls++;
        throw new Error("response lost");
      },
    ),
    /response lost/,
  );
  assert.equal(calls, 1);
});
test("an expired attempt fails visibly", async () => {
  await assert.rejects(
    runClaimedJob(
      job,
      async () => ({ ok: true }),
      async () => false,
    ),
    /lease no longer owned/,
  );
});
test("database reads and writes fail visibly instead of returning success", () => {
  assert.throws(
    () =>
      checked(
        { data: null, error: { message: "permission denied" } },
        "record source success",
      ),
    /record source success: permission denied/,
  );
  assert.deepEqual(checked({ data: [{ id: 1 }], error: null }, "read"), [
    { id: 1 },
  ]);
});
