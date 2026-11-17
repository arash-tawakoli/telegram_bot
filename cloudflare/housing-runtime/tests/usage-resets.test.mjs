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

test("Each Telegram user can receive a stored Premium reset without an immediate plan change",async()=>{
  const x=setup();
  try {
    assert.equal((await grantResetToUser(x.admin,"u1","one-click")).granted,true);
    assert.equal((await grantResetToUser(x.admin,"u1","one-click")).granted,false,
      "Telegram callback retries must not double grant");
    assert.equal((await grantResetToUser(x.admin,"u1","another-click")).granted,true);
    assert.equal((await grantResetToUser(x.user,"u2","not-admin")).granted,false);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits WHERE participant_id='u1'").get().n,2);
    assert.equal(x.sqlite.prepare("SELECT plan_override FROM participants WHERE id='u1'").get().plan_override,null);
    await resetPage(x.user,1234);
    const page=x.calls.at(-1).body;
    assert.match(page.text,/Gespeicherte Resets: <b>2<\/b>/);
    assert.match(page.text,/1 Reset = <b>7 Tage Premium<\/b>/);
    assert.ok(page.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="reset:redeem"));
    assert.ok(x.calls.filter(c=>c.method==="sendMessage"&&/Reset geschenkt/.test(c.body.text)).length===2);
  }finally{x.done()}
});

test("Only an active Free user can redeem one reset for exactly seven days Premium",async()=>{
  const x=setup();
  try {
    await grantResetToUser(x.admin,"u1","first");
    await grantResetToUser(x.admin,"u1","second");
    await redeemReset(x.user,1234);
    const result=x.sqlite.prepare("SELECT plan_override,plan_override_expires_at FROM participants WHERE id='u1'").get();
    assert.equal(result.plan_override,"premium");
    const days=(Date.parse(result.plan_override_expires_at)-Date.now())/86400000;
    assert.ok(days>6.95&&days<7.01);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits WHERE participant_id='u1' AND redeemed_at IS NULL").get().n,1);
    assert.match(x.calls.at(-1).body.text,/Premium ist für 7 Tage aktiviert/);
    await resetPage(x.user,1234);
    assert.ok(!x.calls.at(-1).body.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="reset:redeem"));
    await redeemReset(x.user,1234);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits WHERE participant_id='u1' AND redeemed_at IS NULL").get().n,1,
      "a second reset must remain banked while Premium is active");
    assert.equal(x.sqlite.prepare("SELECT plan_override_expires_at FROM participants WHERE id='u1'").get().plan_override_expires_at,
      result.plan_override_expires_at,"Premium may not be extended by a second reset");
    assert.equal(x.sqlite.prepare("SELECT auto_apply_quota_reset_at FROM participants WHERE id='u1'").get().auto_apply_quota_reset_at,null,
      "the original application quota must not be changed");
  }finally{x.done()}
});

test("Resets remain stored while a grant, referral bonus, or paid Stripe subscription is active",async()=>{
  const x=setup();
  try{
    const future=new Date(Date.now()+15*86400000).toISOString();
    const past=new Date(Date.now()-86400000).toISOString();
    await grantResetToUser(x.admin,"u1","premium-later");
    x.sqlite.prepare("UPDATE participants SET plan_override='premium',plan_override_expires_at=? WHERE id='u1'").run(future);
    await redeemReset(x.user,1234);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits WHERE participant_id='u1' AND redeemed_at IS NULL").get().n,1);
    x.sqlite.prepare("UPDATE participants SET plan_override='premium',plan_override_expires_at=?,referral_bonus_until=? WHERE id='u1'").run(past,future);
    await redeemReset(x.user,1234);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits WHERE participant_id='u1' AND redeemed_at IS NULL").get().n,1);
    x.sqlite.prepare("UPDATE participants SET referral_bonus_until=NULL WHERE id='u1'").run();
    x.sqlite.exec("INSERT INTO user_subscriptions(id,participant_id,provider,status) VALUES('paid-1','u1','stripe','active')");
    await redeemReset(x.user,1234);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits WHERE participant_id='u1' AND redeemed_at IS NULL").get().n,1);
    x.sqlite.exec("UPDATE user_subscriptions SET status='canceled' WHERE participant_id='u1'");
    await redeemReset(x.user,1234);
    assert.equal(x.sqlite.prepare("SELECT plan_override FROM participants WHERE id='u1'").get().plan_override,"premium");
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits WHERE participant_id='u1' AND redeemed_at IS NULL").get().n,0);
  }finally{x.done()}
});

test("Global distribution includes Premium users without activating or extending Premium",async()=>{
  const x=setup();
  try {
    const future=new Date(Date.now()+21*86400000).toISOString();
    x.sqlite.prepare("UPDATE participants SET plan_override='premium',plan_override_expires_at=? WHERE id='u2'").run(future);
    await previewGlobalReset(x.admin,8538226539);
    assert.match(x.calls.at(-1).body.text,/Jeder erhält 1 gespeicherten Reset für 7 Tage Premium/);
    await grantGlobalReset(x.admin,8538226539);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits").get().n,3);
    assert.equal(x.sqlite.prepare("SELECT plan_override_expires_at FROM participants WHERE id='u2'").get().plan_override_expires_at,future);
    await grantGlobalReset(x.admin,8538226539);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits").get().n,3);
    await grantGlobalReset(x.user,1234);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits").get().n,3);
  }finally{x.done()}
});

test("Existing active Telegram users each receive one starter reset in the migration",()=>{
  const x=setup();
  try{
    x.sqlite.exec("UPDATE participants SET plan_override='premium' WHERE id='u2'");
    x.sqlite.exec("INSERT INTO participants(id,first_name,last_name,status) VALUES('no-telegram','No','Chat','active')");
    x.sqlite.exec("INSERT INTO participants(id,first_name,last_name,telegram_user_id,status) VALUES('archived','Old','User',9001,'archived')");
    const migration=readFileSync(new URL("../schema/d1/0028_starter_premium_resets.sql",import.meta.url),"utf8");
    x.sqlite.exec(migration);
    x.sqlite.exec(migration);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits WHERE grant_key='starter:7d'").get().n,3);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM usage_reset_credits WHERE participant_id='u2'").get().n,1,
      "Premium users get the credit for later, without an immediate activation");
    assert.equal(x.sqlite.prepare("SELECT plan_override FROM participants WHERE id='u2'").get().plan_override,"premium");
  }finally{x.done()}
});
