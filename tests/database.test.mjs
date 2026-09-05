import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const root = new URL("../", import.meta.url);
const migration = (await readdir(new URL("supabase/migrations/", root))).find(
  (x) => x.endsWith("_harden_referral_and_source_job_lifecycle.sql"),
);
const db = new PGlite();
await db.exec(
  await readFile(new URL("tests/fixtures/schema.sql", root), "utf8"),
);
await db.exec(
  await readFile(
    new URL("tests/fixtures/production-functions.sql", root),
    "utf8",
  ),
);
await db.exec(
  await readFile(new URL("supabase/migrations/" + migration, root), "utf8"),
);
const referred = "00000000-0000-4000-8000-000000000001";
const referrer = "00000000-0000-4000-8000-000000000002";
const job = "00000000-0000-4000-8000-000000000003";
const result = async (sql, args = []) => (await db.query(sql, args)).rows;
await test("public callers lose privileged RPC access while backend retains it", async () => {
  for (const fn of [
    "complete_referral_reward(uuid)",
    "finish_source_job_attempt(uuid,integer,boolean,text)",
    "claim_source_jobs(text,integer)",
  ]) {
    const [row] = await result(
      "select has_function_privilege('anon',$1,'EXECUTE') a,has_function_privilege('authenticated',$1,'EXECUTE') b,has_function_privilege('service_role',$1,'EXECUTE') c",
      ["public." + fn],
    );
    assert.deepEqual(row, { a: false, b: false, c: true });
  }
});
await test("referral requires a profile, then rewards once and only once", async () => {
  await db.query("insert into bot_users(id,chat_id) values ($1,1),($2,2)", [
    referred,
    referrer,
  ]);
  await db.query(
    "insert into referrals(referred_user_id,referrer_user_id,status) values($1,$2,'registered')",
    [referred, referrer],
  );
  assert.equal(
    (await result("select complete_referral_reward($1) r", [referred]))[0].r
      .status,
    "not_qualified",
  );
  assert.equal(
    (
      await result("select sum(referral_bonus_days)::int total from bot_users")
    )[0].total,
    0,
  );
  await db.query("insert into search_profiles(user_id) values($1)", [referred]);
  assert.equal(
    (await result("select complete_referral_reward($1) r", [referred]))[0].r
      .status,
    "rewarded",
  );
  assert.equal(
    (await result("select complete_referral_reward($1) r", [referred]))[0].r
      .status,
    "none",
  );
  assert.equal(
    (
      await result("select sum(referral_bonus_days)::int total from bot_users")
    )[0].total,
    60,
  );
});
await test("expired processing job is reclaimed; active attempt is protected", async () => {
  await db.query(
    "insert into source_jobs(id,queue_msg_id,source_id,status,attempts,updated_at) values($1,1,8,'processing',1,now()-interval '11 minutes')",
    [job],
  );
  await db.query(
    "insert into pgmq.messages(msg_id,message) values(1,jsonb_build_object('job_id',$1::text,'source_id',8))",
    [job],
  );
  const rows = await result("select * from claim_source_jobs('worker',3)");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].attempt, 2);
  assert.equal(
    (
      await result("select finish_source_job_attempt($1,1,true) accepted", [
        job,
      ])
    )[0].accepted,
    false,
  );
  assert.equal(
    (await result("select status from source_jobs where id=$1", [job]))[0]
      .status,
    "processing",
  );
  // Force visibility without expiring ownership: no duplicate processing.
  await db.exec("update pgmq.messages set vt=now()");
  assert.equal(
    (await result("select * from claim_source_jobs('worker',3)")).length,
    0,
  );
  assert.equal(
    (
      await result("select finish_source_job_attempt($1,2,true) accepted", [
        job,
      ])
    )[0].accepted,
    true,
  );
  assert.equal(
    (
      await result("select finish_source_job_attempt($1,2,true) accepted", [
        job,
      ])
    )[0].accepted,
    true,
  );
  assert.equal(
    (
      await result("select finish_source_job_attempt($1,2,false) accepted", [
        job,
      ])
    )[0].accepted,
    false,
  );
  assert.equal(
    (await result("select status from source_jobs where id=$1", [job]))[0]
      .status,
    "done",
  );
});
await test("failed attempts retry without being mistaken for rejected acknowledgements", async () => {
  await db.exec(
    "update source_jobs set status='processing',attempts=3; update pgmq.messages set archived=false",
  );
  assert.equal(
    (
      await result(
        "select finish_source_job_attempt($1,3,false,'provider error') accepted",
        [job],
      )
    )[0].accepted,
    true,
  );
  assert.equal(
    (
      await result(
        "select finish_source_job_attempt($1,3,false,'provider error') accepted",
        [job],
      )
    )[0].accepted,
    true,
  );
  assert.equal(
    (await result("select status from source_jobs"))[0].status,
    "retry",
  );
});
await test("repeated worker crashes release the source after five attempts", async () => {
  await db.exec("update source_jobs set status='processing',attempts=5,updated_at=now()-interval '11 minutes'; update pgmq.messages set archived=false,vt=now()");
  assert.equal((await result("select * from claim_source_jobs('worker',3)")).length,0);
  assert.equal((await result('select status from source_jobs'))[0].status,'dead');
  assert.equal((await result('select archived from pgmq.messages'))[0].archived,true);
});
await db.close();
