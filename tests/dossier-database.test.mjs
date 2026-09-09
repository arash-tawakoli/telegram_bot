import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema app_private; create schema storage;
 create table public.bot_users(id uuid primary key,is_active boolean default true,plan_override text);
 create table public.sources(id bigint primary key);
 create table public.listings(id uuid primary key,source_id bigint,is_active boolean default true,raw jsonb default '{}',fresh_delivery_eligible boolean default true);
 create table public.delivery_events(id uuid primary key default gen_random_uuid(),recipient_user_id uuid,listing_id uuid);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create function app_private.user_is_premium(p_user uuid) returns boolean language sql as 'select plan_override=''premium'' from public.bot_users where id=p_user';
 create function app_private.current_listing_is_delivery_fresh(bigint,jsonb,boolean) returns boolean language sql as 'select $3';
 grant usage on schema public,app_private to service_role;
 grant all on public.bot_users,public.sources,public.listings,public.delivery_events to service_role;
`);
await db.exec(await readFile(new URL('../supabase/migrations/20260909223100_premium_applications.sql',import.meta.url),'utf8'));
const user='00000000-0000-4000-8000-000000000001',listing='00000000-0000-4000-8000-000000000002';
await db.query("insert into bot_users(id,plan_override) values($1,'premium');",[user]);
await db.exec('insert into sources values(1);');
await db.query('insert into listings(id,source_id) values($1,1)',[listing]);
await db.query('insert into delivery_events(recipient_user_id,listing_id) values($1,$2)',[user,listing]);
const q=async(s,p=[])=>(await db.query(s,p)).rows;

test('private documents and application records are inaccessible to public roles',async()=>{
 for(const table of ['application_documents','applications'])for(const role of ['anon','authenticated']){
  assert.equal((await q('select has_table_privilege($1,$2,\'SELECT\') as allowed',[role,table]))[0].allowed,false);
 }
 assert.equal((await q("select public from storage.buckets where id='application-documents'"))[0].public,false);
 assert.deepEqual((await q("select has_function_privilege('anon','public.begin_application_submission(uuid)','EXECUTE') as a,has_function_privilege('service_role','public.begin_application_submission(uuid)','EXECUTE') as b"))[0],{a:false,b:true});
});

test('automatic applications cannot be activated before platform verification',async()=>{
 await assert.rejects(q('update bot_users set auto_apply_enabled=true where id=$1',[user]),/not available/);
 await q('insert into app_private.application_platforms values(1,now())');
 await q('update bot_users set auto_apply_enabled=true where id=$1',[user]);
});

test('the remote-send checkpoint and unique key prevent repeated dispatch',async()=>{
 const [a]=await q('insert into applications(user_id,listing_id,source_id) values($1,$2,1) returning id',[user,listing]);
 await assert.rejects(q('insert into applications(user_id,listing_id,source_id) values($1,$2,1)',[user,listing]),/unique/);
 assert.equal((await q('select begin_application_submission($1) as ok',[a.id]))[0].ok,true);
 assert.equal((await q('select begin_application_submission($1) as ok',[a.id]))[0].ok,false);
 await q("update applications set status='pending' where id=$1",[a.id]);
 assert.equal((await q('select begin_application_submission($1) as ok',[a.id]))[0].ok,false);
});

test('premium lapse blocks profile writes, uploads and grants but permits revocation, export and deletion',async()=>{
 const [doc]=await q("insert into application_documents(user_id,kind,telegram_message_id,filename,mime_type,bytes,ready,share_enabled) values($1,'schufa',1,'a.pdf','application/pdf',10,true,true) returning id",[user]);
 await q("update bot_users set plan_override='free' where id=$1",[user]);
 await assert.rejects(q(`update bot_users set applicant_profile='{"full_name":"Test"}' where id=$1`,[user]),/premium required/);
 await assert.rejects(q("insert into application_documents(user_id,kind,telegram_message_id,filename,mime_type,bytes) values($1,'wbs',2,'a.pdf','application/pdf',10)",[user]),/premium required/);
 await q('update application_documents set share_enabled=false where id=$1',[doc.id]);
 await assert.rejects(q('update application_documents set share_enabled=true where id=$1',[doc.id]),/premium required/);
 await q("update bot_users set applicant_profile='{}' where id=$1",[user]);
 assert.equal((await q('select id from application_documents where user_id=$1',[user])).length,1);
 await assert.rejects(q('delete from bot_users where id=$1',[user]),/foreign key/);
 await q('delete from application_documents where id=$1',[doc.id]);
});

test('queued application is denied if premium expires or the listing becomes stale',async()=>{
 for(const scenario of ['premium','freshness','active','opt_in','match','source']){
  const id=crypto.randomUUID();await q('insert into listings(id,source_id) values($1,1)',[id]);
  await q('insert into delivery_events(recipient_user_id,listing_id) values($1,$2)',[user,id]);
  await q("update bot_users set plan_override='premium',is_active=true where id=$1",[user]);
  await q('update bot_users set auto_apply_enabled=true where id=$1',[user]);
  if(scenario==='premium')await q("update bot_users set plan_override='free' where id=$1",[user]);
  if(scenario==='freshness')await q('update listings set fresh_delivery_eligible=false where id=$1',[id]);
  if(scenario==='active')await q('update listings set is_active=false where id=$1',[id]);
  if(scenario==='opt_in')await q('update bot_users set auto_apply_enabled=false where id=$1',[user]);
  if(scenario==='match')await q('delete from delivery_events where listing_id=$1',[id]);
  if(scenario==='source')await q('update app_private.application_platforms set verified_at=null');
  const [a]=await q('insert into applications(user_id,listing_id,source_id) values($1,$2,1) returning id',[user,id]);
  assert.equal((await q('select begin_application_submission($1) as ok',[a.id]))[0].ok,false,scenario);
  assert.equal((await q('select submission_started_at from applications where id=$1',[a.id]))[0].submission_started_at,null);
 }
});

test.after(async()=>db.close());
