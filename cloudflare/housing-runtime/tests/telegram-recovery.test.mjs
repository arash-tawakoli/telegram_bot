import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { recoverTelegramUpdates } from "../src/telegram-recovery.js";

function database() {
  const db=new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE participants(id TEXT PRIMARY KEY,telegram_user_id INTEGER,last_activity_at TEXT);
    CREATE TABLE telegram_updates(
      update_id INTEGER PRIMARY KEY,payload_hash TEXT NOT NULL,kind TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('processing','completed','failed')),
      attempts INTEGER NOT NULL DEFAULT 1,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,last_error TEXT
    );
  `);
  db.exec(readFileSync(new URL("../schema/d1/0015_telegram_update_recovery.sql",import.meta.url),"utf8"));
  db.prepare("INSERT INTO participants(id,telegram_user_id) VALUES(?,?)").run("participant-1",777);
  const run=(query,params=[])=>{
    const statement=db.prepare(query.replace(/\$(\d+)/g,"?$1"));
    return /\bRETURNING\b/i.test(query)||/^\s*(SELECT|WITH)\b/i.test(query)?statement.all(...params):(statement.run(...params),[]);
  };
  const sql=(strings,...params)=>run(strings.reduce((text,part,index)=>text+part+(index<params.length?`$${index+1}`:""),""),params);
  sql.unsafe=run;
  return {db,sql};
}

test("stored failed updates replay once and completed payloads are cleared",async()=>{
  const {db,sql}=database();
  const now=new Date("2026-11-13T02:22:00.000Z");
  const payload=JSON.stringify({update_id:10,message:{from:{id:777},text:"/start"}});
  db.prepare("INSERT INTO telegram_updates(update_id,payload_hash,kind,status,attempts,received_at,payload_json,processing_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(10,"hash","message","failed",1,"2026-11-13T02:20:00.000Z",payload,"2026-11-13T02:20:00.000Z");
  db.prepare("INSERT INTO telegram_updates(update_id,payload_hash,kind,status,attempts,received_at,payload_json,processing_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(11,"hash","message","processing",2,"2026-11-13T02:00:00.000Z",JSON.stringify({update_id:11}),"2026-11-13T02:00:00.000Z");
  let calls=0;
  const result=await recoverTelegramUpdates(sql,{},async()=>{calls++;},now);
  assert.deepEqual(result,{scanned:2,completed:2,failed:0});
  assert.equal(calls,2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM telegram_updates WHERE status='completed' AND payload_json IS NULL").get().n,2);
  assert.equal(db.prepare("SELECT attempts FROM telegram_updates WHERE update_id=10").get().attempts,2);
  assert.equal(db.prepare("SELECT last_activity_at FROM participants WHERE id='participant-1'").get().last_activity_at,now.toISOString());
  db.close();
});

test("payload-less and exhausted updates remain untouched",async()=>{
  const {db,sql}=database();
  const old="2026-11-13T01:00:00.000Z";
  db.prepare("INSERT INTO telegram_updates(update_id,payload_hash,kind,status,attempts,received_at,processing_at) VALUES(?,?,?,?,?,?,?)")
    .run(20,"hash","message","failed",2,old,old);
  db.prepare("INSERT INTO telegram_updates(update_id,payload_hash,kind,status,attempts,received_at,payload_json,processing_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(21,"hash","message","failed",5,old,"{}",old);
  let calls=0;
  const result=await recoverTelegramUpdates(sql,{},async()=>{calls++;},new Date("2026-11-13T02:22:00.000Z"));
  assert.deepEqual(result,{scanned:0,completed:0,failed:0});
  assert.equal(calls,0);
  db.close();
});
