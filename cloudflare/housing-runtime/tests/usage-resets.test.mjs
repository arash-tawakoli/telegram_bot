import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { configureLegacyRuntime } from "../src/telegram-legacy/runtime.js";
import {
  resetPage, redeemReset, grantResetToUser, grantGlobalReset,
  previewGlobalReset,
} from "../src/telegram-legacy/usage-resets.js";

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  const dir = new URL("../schema/d1/", import.meta.url);
  for (const file of readdirSync(dir).filter(name=>name.endsWith(".sql")).sort())
    sqlite.exec(readFileSync(new URL(file,dir),"utf8"));
  sqlite.exec("INSERT INTO participants(id,first_name,last_name,telegram_user_id,telegram_chat_id) VALUES('u1','Anna','Beispiel',1234,1234),('u2','Erika','Test',5678,5678),('admin','Admin','Person',8538226539,8538226539)");
  sqlite.exec("INSERT INTO application_preferences(participant_id,enabled) VALUES('u1',1)");
  const db = {
    prepare(query) {
      function stmt(args) {
        return {
          bind(...bound){return stmt(bound);},
          async first(){return sqlite.prepare(query).get(...args) || null;},
          async all(){
            const s = sqlite.prepare(query);
            if (/^\s*(SELECT|WITH|PRAGMA)/i.test(query)||/\bRETURNING\b/i.test(query))
              return { results:s.all(...args),meta:{changes:0} };
            return {results:[],meta:{changes:s.run(...args).changes}};
          },
          async run(){return {meta:{changes:sqlite.prepare(query).run(...args).changes}};},
        };
      }
      return stmt([]);
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const result=[];
        for (const stmt of statements) result.push(await stmt.all());
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {sqlite.exec("ROLLBACK");throw error;}
    },
  };
  const calls=[];
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    const method=String(url).split("/").at(-1);
    calls.push({method,body:JSON.parse(options.body)});
    return Response.json({ok:true,result:{message_id:calls.length}});
  };
  configureLegacyRuntime({HOUSING_DB:db,TELEGRAM_BOT_TOKEN:"fake"},db);
  return {
    sqlite,db,calls,user:{id:"u1",telegram_user_id:1234},admin:{id:"admin",telegram_user_id:8538226539},
    done(){sqlite.close();globalThis.fetch=oldFetch},
  };
}

function today() {
  const p=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const val=k=>p.find(x=>x.type===k).value;
  return val("year")+"-"+val("month")+"-"+val("day");
}

test("Admin can bank one reset per callback without changing participant settings", async () => {
  const x=setup();
  try {
    assert.equal((await grantResetToUser(x.admin,"u1","event-1")).granted,true);
    assert.equal((await grantResetToUser(x.admin,"u1","event-1")).granted,false);
    assert.equal((await grantResetToUser(x.admin,"u1","event-2")).granted,true);
    const records=x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits WHERE participant_id='u1'").get();
    assert.equal(records.n,2);
    assert.equal(x.calls.filter(c=>c.method==="sendMessage").length,2);
    await resetPage(x.user,1234);
    const display=x.calls.at(-1).body.text;
    assert.match(display,/Gespeicherte Resets: <b>2<\/b>/);
    assert.match(display,/kein Tageslimit/);
    await redeemReset(x.user,1234);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits WHERE participant_id='u1' AND redeemed_at IS NULL").get().n,2,
      "unlimited users must never burn a saved reset");
    assert.equal(x.sqlite.prepare("SELECT auto_apply_quota_reset_at FROM participants WHERE id='u1'").get().auto_apply_quota_reset_at,null);
  } finally{x.done()}
});

test("Redeeming a saved reset refreshes only an exhausted finite daily allowance", async () => {
  const x=setup();
  try {
    x.sqlite.exec("UPDATE application_preferences SET daily_limit=1 WHERE participant_id='u1'");
    x.sqlite.prepare("INSERT INTO applications(id,participant_id,provider,idempotency_key,status,quota_local_date,submission_started_at) VALUES('app1','u1','immoscout24','once','sent',?,datetime('now','-1 minute'))").run(today());
    await grantResetToUser(x.admin,"u1","event-quota");
    await resetPage(x.user,1234);
    assert.match(x.calls.at(-1).body.text,/Kontingent: <b>1 \/ 1<\/b>/);
    assert.ok(x.calls.at(-1).body.reply_markup.inline_keyboard.some(r=>r.some(b=>b.callback_data==="reset:redeem")));
    await redeemReset(x.user,1234);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits WHERE participant_id='u1' AND redeemed_at IS NOT NULL").get().n,1);
    assert.ok(x.sqlite.prepare("SELECT auto_apply_quota_reset_at AS t FROM participants WHERE id='u1'").get().t);
    await resetPage(x.user,1234);
    assert.match(x.calls.at(-1).body.text,/Gespeicherte Resets: <b>0<\/b>/);
    assert.match(x.calls.at(-1).body.text,/Kontingent: <b>0 \/ 1<\/b>/);
  } finally{x.done()}
});

test("Global reset is admin-only and grants at most one saved credit per user per day",async()=>{
  const x=setup();
  try {
    await previewGlobalReset(x.admin,8538226539);
    assert.match(x.calls.at(-1).body.text,/Aktive Nutzer/);
    await grantGlobalReset(x.admin,8538226539);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits").get().n,3);
    await grantGlobalReset(x.admin,8538226539);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits").get().n,3);
    await grantGlobalReset(x.user,1234);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits").get().n,3);
  }finally{x.done()}
});
