import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration=readFileSync(new URL("../schema/d1/0023_language_trial_applicant_completion.sql",import.meta.url),"utf8");

test("migration grants existing Telegram users exactly one welcome trial and preserves longer referral bonuses",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec("CREATE TABLE participants(id TEXT PRIMARY KEY,telegram_user_id INTEGER,created_at TEXT,updated_at TEXT,referral_bonus_until TEXT,ui_language TEXT);");
  db.exec("INSERT INTO participants(id,telegram_user_id,created_at,ui_language) VALUES('old',77,CURRENT_TIMESTAMP,'en'),('long',78,CURRENT_TIMESTAMP,'de'),('portal',NULL,CURRENT_TIMESTAMP,'de');");
  db.exec("UPDATE participants SET referral_bonus_until='2099-01-01T00:00:00Z' WHERE id='long'");
  db.exec(migration);
  const old=db.prepare("SELECT ui_language,language_selected_at,welcome_premium_granted_at,referral_bonus_until FROM participants WHERE id='old'").get();
  assert.equal(old.ui_language,"en");
  assert.ok(old.language_selected_at);
  assert.ok(old.welcome_premium_granted_at);
  assert.ok(Date.parse(old.referral_bonus_until)>Date.now()+29*86400000);
  assert.equal(db.prepare("SELECT referral_bonus_until FROM participants WHERE id='long'").get().referral_bonus_until,"2099-01-01T00:00:00Z");
  assert.equal(db.prepare("SELECT welcome_premium_granted_at FROM participants WHERE id='portal'").get().welcome_premium_granted_at,null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM applicant_completion_prompts").get().n,0);
 }finally{db.close();}
});
