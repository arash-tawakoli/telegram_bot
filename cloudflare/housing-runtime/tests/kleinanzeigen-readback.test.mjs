import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { outboundMatch, reconcileKleinanzeigenReadbackOnce } from "../src/kleinanzeigen-readback.js";

test("Kleinanzeigen readback recognizes only an exact outgoing message",()=>{
  const expected="Guten Tag, ich interessiere mich.\n\nBewerber/in: Sona Testname\nE-Mail für Rückfragen: sona@example.test";
  assert.equal(outboundMatch({direction:"SENT",text:expected},expected),true);
  assert.equal(outboundMatch({boundness:"OUTBOUND",message:expected},expected),true);
  assert.equal(outboundMatch({direction:"RECEIVED",text:expected},expected),false);
  assert.equal(outboundMatch({direction:"SENT",text:expected+"!"},expected),false);
  assert.equal(outboundMatch({direction:"UNKNOWN",text:expected},expected),false);
});
test("Kleinanzeigen inbox audit is disabled unless targeting one specific past application",async()=>{
  let calls=0;
  const sql={unsafe:async()=>{calls++;throw Error("must not read");}};
  assert.deepEqual(await reconcileKleinanzeigenReadbackOnce(sql,{}),{status:"disabled"});
  assert.deepEqual(await reconcileKleinanzeigenReadbackOnce(sql,{PREVIEW_MODE:"1",
    KLEINANZEIGEN_READBACK_APPLICATION_ID:"9fcf2a89-18fb-430d-a358-6ca061c9e63b"}),{status:"disabled"});
  assert.equal(calls,0);
});
test("Kleinanzeigen inbox audit never loads credentials for an ineligible or uncertain record",async()=>{
  let queries=[];
  const sql={unsafe:async(sql,values)=>{queries.push({sql,values});return [];}};
  const result=await reconcileKleinanzeigenReadbackOnce(sql,{
    KLEINANZEIGEN_READBACK_APPLICATION_ID:"9fcf2a89-18fb-430d-a358-6ca061c9e63b"
  });
  assert.equal(result.status,"not_eligible");
  assert.equal(queries.length,1);
  assert.match(queries[0].sql,/status='manual_required'/);
  assert.match(queries[0].sql,/last_error='submission_unconfirmed'/);
  assert.match(queries[0].sql,/sent_at IS NULL/);
});
test("Kleinanzeigen inbox audit is idempotent and does not read messages twice",async()=>{
  let queries=[];
  const sql={unsafe:async(sql,values)=>{
    queries.push({sql,values});
    return queries.length===1?[{id:"9fcf2a89-18fb-430d-a358-6ca061c9e63b"}]:[];
  }};
  const result=await reconcileKleinanzeigenReadbackOnce(sql,{
    KLEINANZEIGEN_READBACK_APPLICATION_ID:"9fcf2a89-18fb-430d-a358-6ca061c9e63b"
  });
  assert.equal(result.status,"already_checked");
  assert.equal(queries.length,2);
  assert.match(queries[1].sql,/NOT EXISTS/);
});
test("readback uses provider inbox APIs only and never calls outbound application sender",()=>{
  const src=readFileSync(new URL("../src/kleinanzeigen-readback.js",import.meta.url),"utf8");
  assert.doesNotMatch(src,/sendKleinanzeigenApplication/);
  assert.doesNotMatch(src,/method\s*:\s*["']POST["']/);
  assert.match(src,/verified_exact_outbound/);
  const scheduler=readFileSync(new URL("../src/platform-session-cron.js",import.meta.url),"utf8");
  assert.match(scheduler,/pc\.provider IN \('immowelt','immomio','kleinanzeigen'\)/);
  assert.match(scheduler,/getCentralProviderCredentials\(sql, env, "kleinanzeigen"\)/);
});
