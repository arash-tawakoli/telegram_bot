import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { sha256 } from "../src/auth.js";

function createFixture() {
 const sqlite = new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON");
 sqlite.exec(readFileSync(new URL("../schema/d1/0001_housing_core.sql", import.meta.url),"utf8"));
 const coach="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 const first="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
 const second="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
 const search="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
 const token="mock-admin-session-token";
 const resultRows=(statement, values=[])=>{
   const returnsRows=/^\s*(SELECT|WITH|PRAGMA)\b/i.test(statement) || /\bRETURNING\b/i.test(statement);
   const prepared=sqlite.prepare(statement);
   if(returnsRows)return{results:prepared.all(...values)};
   const write=prepared.run(...values);
   return{results:[],meta:{changes:write.changes}};
 };
 let batchCalls=0;
 const db={
  prepare(query){
   const build=values=>({all:async()=>resultRows(query,values)});
   return{bind:(...values)=>build(values),...build([])};
  },
  async batch(items){
   batchCalls++;
   sqlite.exec("BEGIN IMMEDIATE");
   try{
    const results=[];
    for(const item of items)results.push(await item.all());
    sqlite.exec("COMMIT");
    return results;
   }catch(e){sqlite.exec("ROLLBACK");throw e;}
  },
 };
 const init=async()=>{
  sqlite.prepare("INSERT INTO portal_members(id,email,display_name,role,password_hash) VALUES(?,?,?,'admin','unused')")
   .run(coach,"coach@example.test","Admin");
  sqlite.prepare("INSERT INTO portal_sessions(id,member_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES(?,?,?,?,?,?)")
   .run("session",coach,await sha256(token),"refresh",new Date(Date.now()+60000).toISOString(),new Date(Date.now()+60000).toISOString());
  for(const id of [first,second])sqlite.prepare("INSERT INTO participants(id,first_name,last_name) VALUES(?,'A','B')").run(id);
  sqlite.prepare("INSERT INTO source_registry(id,name,family,connector) VALUES(1,'Hamburg','immoscout24','mcp')").run();
  sqlite.prepare("INSERT INTO search_profiles(id,participant_id,criteria) VALUES(?,?,?)").run(search,second,JSON.stringify({location_mode:"all_hamburg"}));
  sqlite.prepare("INSERT INTO source_links(search_profile_id,source_id) VALUES(?,1)").run(search);
 };
 const call=async(body)=>worker.fetch(new Request("https://housing.test/edge/coach",{
  method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify(body),
 }),{HOUSING_DB:db});
 return {sqlite,db,coach,first,second,search,call,init,get batchCalls(){return batchCalls}};
}

test("legacy search updates cannot alter another participant's search or source links",async()=>{
 const x=createFixture();await x.init();
 try{
  const response=await x.call({action:"save_search",participantId:x.first,profileId:x.search,
   profile:{location_mode:"all_schleswig_holstein",source_ids:[1]}});
  assert.equal(response.status,403);
  assert.equal(x.sqlite.prepare("SELECT participant_id FROM search_profiles WHERE id=?").get(x.search).participant_id,x.second);
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM source_links WHERE search_profile_id=?").get(x.search).n,1);
  assert.equal(x.batchCalls,0,"unauthorized cross-participant profile must fail before writes");
 }finally{x.sqlite.close();}
});

test("D1 batch rolls back a newly created search when a later source link fails",async()=>{
 const x=createFixture();await x.init();
 try{
  const id="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const response=await x.call({action:"save_search",participantId:x.first,profileId:id,
   profile:{location_mode:"all_schleswig_holstein",source_ids:[1,69]}});
  assert.equal(response.status,422);
  assert.equal(x.batchCalls,1);
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM search_profiles WHERE id=?").get(id).n,0);
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM source_links WHERE search_profile_id=?").get(id).n,0);
 }finally{x.sqlite.close();}
});

test("D1 batch rolls back participant and applicant profile when coach FK fails",async()=>{
 const x=createFixture();await x.init();
 try{
  const before=x.sqlite.prepare("SELECT COUNT(*) n FROM participants").get().n;
  const response=await x.call({action:"create_participant",coachMemberId:"ffffffff-ffff-4fff-8fff-ffffffffffff",first_name:"New",last_name:"Person"});
  assert.equal(response.status,422);
  assert.equal(x.batchCalls,1);
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM participants").get().n,before);
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM applicant_profiles").get().n,0);
 }finally{x.sqlite.close();}
});

test("D1 batch commits valid participant and search writes atomically",async()=>{
 const x=createFixture();await x.init();
 try{
  const created=await x.call({action:"create_participant",first_name:"New",last_name:"Person"});
  assert.equal(created.status,200);
  const {participantId}=await created.json();
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM applicant_profiles WHERE participant_id=?").get(participantId).n,1);
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM participant_assignments WHERE participant_id=?").get(participantId).n,1);
  const saved=await x.call({action:"save_search",participantId,profile:{location_mode:"all_hamburg",source_ids:[1]}});
  assert.equal(saved.status,200);
  const {profileId}=await saved.json();
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM source_links WHERE search_profile_id=? AND source_id=1").get(profileId).n,1);
 }finally{x.sqlite.close();}
});
