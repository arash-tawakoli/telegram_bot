import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema app_private; create schema storage;
 create table bot_users(id uuid primary key,is_active boolean default true,plan_override text);
 create table sources(id bigint primary key);
 create table listings(id uuid primary key,source_id bigint,is_active boolean default true,raw jsonb default '{}',fresh_delivery_eligible boolean default true);
 create table delivery_events(id uuid primary key default gen_random_uuid(),recipient_user_id uuid,listing_id uuid);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create function app_private.user_is_premium(p_user uuid) returns boolean language sql as 'select plan_override=''premium'' from public.bot_users where id=p_user';
 create function app_private.current_listing_is_delivery_fresh(bigint,jsonb,boolean) returns boolean language sql as 'select $3';
 grant usage on schema public,app_private to service_role;
 insert into sources values(1),(2);
`);
await db.exec(await readFile(new URL('../supabase/migrations/20260909223100_premium_applications.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../supabase/migrations/20260910085141_platform_application_sessions.sql',import.meta.url),'utf8'));
const q=async(s,p=[])=>(await db.query(s,p)).rows;
const user=crypto.randomUUID(),other=crypto.randomUUID();
await q("insert into bot_users(id,plan_override) values($1,'premium'),($2,'free')",[user,other]);
test('platform sessions isolate users/platforms, refuse overlapping claims and permit deletion after Premium expires',async()=>{
 const [first]=await q('select * from claim_platform_session($1,1)',[user]);assert.ok(first.lease_token);
 assert.equal((await q('select * from claim_platform_session($1,1)',[user])).length,0);
 assert.equal((await q('select * from claim_platform_session($1,2)',[user])).length,1);
 assert.equal((await q('select * from claim_platform_session($1,1)',[other])).length,0);
 assert.equal((await q('select * from claim_platform_session($1,1,true)',[other])).length,1);
 assert.equal((await q('select * from claim_platform_session($1,null)',[user])).length,0);
 await assert.rejects(q('delete from bot_users where id=$1',[user]),/foreign key/);
});
test('session and queue RPCs are backend-only',async()=>{
 for(const role of ['anon','authenticated']){
  assert.equal((await q("select has_table_privilege($1,'platform_sessions','SELECT') as ok",[role]))[0].ok,false);
  for(const fn of ['claim_platform_session(uuid,bigint,boolean)','claim_application()','authorize_application_send(uuid,uuid)','application_user_eligible(uuid)'])
   assert.equal((await q('select has_function_privilege($1,$2,\'EXECUTE\') as ok',[role,fn]))[0].ok,false);
 }
});
test('matched events enqueue once, require opt-in/Premium/freshness and fence stale workers',async()=>{
 await q('insert into app_private.application_platforms values(1,now()),(2,now())');
 await q('update bot_users set auto_apply_enabled=true where id=$1',[user]);
 const listing=crypto.randomUUID();await q('insert into listings(id,source_id) values($1,1)',[listing]);
 await q('insert into delivery_events(recipient_user_id,listing_id) values($1,$2),($1,$2),($3,$2)',[user,listing,other]);
 assert.equal((await q('select * from applications')).length,1);
 const [first]=await q('select * from claim_application()');
 assert.equal((await q('select * from claim_application()')).length,0);
 assert.equal((await q('select authorize_application_send($1,null) as ok',[first.id]))[0].ok,false);
 await q("update applications set lease_until=now()-interval '1 second' where id=$1",[first.id]);
 const [second]=await q('select * from claim_application()');assert.notEqual(second.lease_token,first.lease_token);
 assert.equal((await q('select authorize_application_send($1,$2) as ok',[first.id,first.lease_token]))[0].ok,false);
 assert.equal((await q('select authorize_application_send($1,$2) as ok',[second.id,second.lease_token]))[0].ok,true);
 assert.equal((await q('select authorize_application_send($1,$2) as ok',[second.id,second.lease_token]))[0].ok,false);
 await q("update applications set lease_until=now()-interval '1 second' where id=$1",[first.id]);
 assert.equal((await q('select * from claim_application()')).length,0);
 assert.equal((await q('select status from applications where id=$1',[first.id]))[0].status,'manual_required');
 for(const scenario of ['freshness','premium','optin','platform']){
  const id=crypto.randomUUID();await q('insert into listings(id,source_id) values($1,2)',[id]);
  if(scenario==='freshness')await q('update listings set fresh_delivery_eligible=false where id=$1',[id]);
  if(scenario==='premium')await q("update bot_users set plan_override='free' where id=$1",[user]);
  if(scenario==='optin')await q('update bot_users set auto_apply_enabled=false where id=$1',[user]);
  if(scenario==='platform')await q('update app_private.application_platforms set verified_at=null where source_id=2');
  await q('insert into delivery_events(recipient_user_id,listing_id) values($1,$2)',[user,id]);
  assert.equal((await q('select * from applications where listing_id=$1',[id])).length,0,scenario);
 }
});
test.after(()=>db.close());
