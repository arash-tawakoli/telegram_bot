import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createD1Supabase } from "../src/telegram-legacy/d1-supabase.js";

const ownerTelegramId = 8538226539;
const profile = {
  first_name:"Test", last_name:"Person", salutation:"MR", email:"test@example.com",
  phone:"+491700000000", street:"Kreuzweg", house_number:"7", postcode:"20099",
  city:"Hamburg", household_type:"SINGLE", employment_status:"EMPLOYEE",
  income_range:"1000_1500", pets:"NO", wbs_status:"NOT_SPECIFIED",
  move_in_preference:"FLEXIBLE", schufa_status:"NOT_SPECIFIED",
  message_apartment:"Interesse", message_house:"Interesse",
  message_temporary_wg:"Interesse", message_swap:"Interesse"
};

function adapterFixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE participants(
      id TEXT PRIMARY KEY,status TEXT,telegram_user_id INTEGER,
      test_auto_apply_allowed INTEGER,test_auto_apply_enabled INTEGER,
      test_auto_apply_daily_limit INTEGER,auto_apply_enabled INTEGER,
      test_auto_apply_enabled_at TEXT,test_auto_apply_disabled_at TEXT,
      updated_at TEXT,plan_override TEXT,plan_override_expires_at TEXT,referral_bonus_until TEXT
    );
    CREATE TABLE applicant_profiles(participant_id TEXT PRIMARY KEY,profile TEXT);
    CREATE TABLE application_preferences(
      participant_id TEXT PRIMARY KEY,enabled INTEGER DEFAULT 0,
      immoscout_enabled INTEGER DEFAULT 0,immowelt_enabled INTEGER DEFAULT 0,
      immomio_enabled INTEGER DEFAULT 0,updated_at TEXT
    );
    CREATE TABLE applications(
      participant_id TEXT,provider TEXT,test_mode INTEGER,status TEXT,
      submission_started_at TEXT,last_error TEXT,updated_at TEXT
    );
    CREATE TABLE telegram_updates(update_id INTEGER PRIMARY KEY,kind TEXT NOT NULL);
  `);
  db.exec(readFileSync(new URL("../schema/d1/0020_telegram_control_ordering.sql", import.meta.url),"utf8"));
  db.prepare("INSERT INTO participants(id,status,telegram_user_id,test_auto_apply_allowed,test_auto_apply_enabled,test_auto_apply_daily_limit,auto_apply_enabled) VALUES(?,?,?,?,?,?,?)")
    .run("owner","active",ownerTelegramId,1,0,1,0);
  db.prepare("INSERT INTO applicant_profiles(participant_id,profile) VALUES(?,?)")
    .run("owner",JSON.stringify(profile));
  db.exec("INSERT INTO application_preferences(participant_id) VALUES('owner')");
  function stmt(query,params) {
    return {all:async()=>{
      const prepared=db.prepare(query);
      if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(query) || /\bRETURNING\b/i.test(query))
        return {results:prepared.all(...params),meta:{changes:0}};
      const result=prepared.run(...params);
      return {results:[],meta:{changes:Number(result.changes)}};
    }};
  }
  const d1={
    prepare(query){return {bind:(...params)=>stmt(query,params),all:()=>stmt(query,[]).all()};},
    async batch(statements){
      db.exec("BEGIN");try{
        const out=[];for(const statement of statements)out.push(await statement.all());
        db.exec("COMMIT");return out;
      }catch(error){db.exec("ROLLBACK");throw error;}
    }
  };
  const adapter=createD1Supabase(d1,{});
  const update=(provider,enabled,extra={})=>adapter.rpc("set_telegram_auto_apply_sources",{
    p_user:"owner",p_telegram_user_id:ownerTelegramId,
    ...(provider?{p_provider:provider}:{}),p_enabled:enabled,...extra
  });
  const status=()=>({
    ...db.prepare("SELECT test_auto_apply_enabled,auto_apply_enabled,test_auto_apply_daily_limit FROM participants WHERE id='owner'").get(),
    ...db.prepare("SELECT enabled,immoscout_enabled,immowelt_enabled,immomio_enabled FROM application_preferences WHERE participant_id='owner'").get()
  });
  return {db,adapter,update,status,close:()=>db.close()};
}

test("per-provider Start/Pause controls only the owner's personal test mode",async()=>{
  const x=adapterFixture();try{
    assert.equal((await x.update("immoscout24",true)).error,null);
    assert.deepEqual(x.status(),{
      test_auto_apply_enabled:1,auto_apply_enabled:0,test_auto_apply_daily_limit:0,
      enabled:0,immoscout_enabled:1,immowelt_enabled:0,immomio_enabled:0
    });
    assert.equal((await x.update("immowelt",true)).error,null);
    assert.equal(x.status().immoscout_enabled,1);
    assert.equal(x.status().immowelt_enabled,1);
    x.db.exec("INSERT INTO applications(participant_id,provider,test_mode,status) VALUES('owner','immoscout24',1,'pending'),('owner','immowelt',1,'pending')");
    assert.equal((await x.update("immoscout24",false)).error,null);
    assert.equal(x.status().test_auto_apply_enabled,1);
    assert.equal(x.status().immoscout_enabled,0);
    assert.equal(x.status().immowelt_enabled,1);
    assert.equal(x.db.prepare("SELECT status FROM applications WHERE provider='immoscout24'").get().status,"failed");
    assert.equal(x.db.prepare("SELECT status FROM applications WHERE provider='immowelt'").get().status,"pending");
    assert.equal((await x.update("immowelt",false)).error,null);
    assert.equal(x.status().test_auto_apply_enabled,0);
    assert.equal(x.db.prepare("SELECT status FROM applications WHERE provider='immowelt'").get().status,"failed");
  }finally{x.close();}
});

test("Alle starten/Alle pausieren operate global personal test, not live auto-apply",async()=>{
  const x=adapterFixture();try{
    assert.equal((await x.update(null,true)).error,null);
    assert.deepEqual(x.status(),{
      test_auto_apply_enabled:1,auto_apply_enabled:0,test_auto_apply_daily_limit:0,
      enabled:0,immoscout_enabled:1,immowelt_enabled:1,immomio_enabled:1
    });
    assert.equal((await x.update(null,false)).error,null);
    assert.deepEqual(x.status(),{
      test_auto_apply_enabled:0,auto_apply_enabled:0,test_auto_apply_daily_limit:0,
      enabled:0,immoscout_enabled:0,immowelt_enabled:0,immomio_enabled:0
    });
  }finally{x.close();}
});

test("stale Pause cannot override a newer Start or cancel its queued application",async()=>{
  const x=adapterFixture();try{
    x.db.exec("INSERT INTO telegram_updates(update_id,kind) VALUES(101,'callback_query'),(102,'callback_query')");
    assert.equal((await x.update("immomio",true,{p_update_id:102})).error,null);
    x.db.exec("INSERT INTO applications(participant_id,provider,test_mode,status) VALUES('owner','immomio',1,'pending')");
    assert.equal((await x.update("immomio",false,{p_update_id:101})).error,null);
    assert.equal(x.status().immomio_enabled,1);
    assert.equal(x.status().test_auto_apply_enabled,1);
    assert.equal(x.db.prepare("SELECT status FROM applications WHERE provider='immomio'").get().status,"pending");
  }finally{x.close();}
});

test("backfill preserves the existing Scout selection without enabling regular auto-apply",()=>{
  const x=adapterFixture();try{
    x.db.exec("UPDATE participants SET test_auto_apply_enabled=1 WHERE id='owner'");
    x.db.exec(readFileSync(new URL("../schema/d1/0026_backfill_personal_test_source.sql",import.meta.url),"utf8"));
    assert.equal(x.status().immoscout_enabled,1);
    assert.equal(x.status().enabled,0);
    assert.equal(x.status().auto_apply_enabled,0);
  }finally{x.close();}
});
