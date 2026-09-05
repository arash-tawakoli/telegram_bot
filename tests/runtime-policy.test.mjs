import test from 'node:test';import assert from 'node:assert/strict';import {readFile,readdir} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();const root=new URL('../',import.meta.url);const sql=async p=>readFile(new URL(p,root),'utf8');
await db.exec(await sql('tests/fixtures/schema.sql'));
await db.exec(`create table sources(id smallint primary key,name text,tier text,runtime_mode text,delivery_mode text,enabled boolean,poll_interval_minutes int,updated_at timestamptz,last_checked_at timestamptz,crawl_priority int,last_success_at timestamptz,consecutive_failures int);
create schema app_private;create schema cron;create schema net;
create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as 'select 1::bigint';
create function public.get_bot_secret(text) returns text language sql as $$select 'test-secret'::text$$;
create function pgmq.send(text,jsonb) returns bigint language sql as 'select 1::bigint';
alter table source_jobs add column enqueued_at timestamptz default now();
create table crawl_runs(id bigint,source_id smallint,started_at timestamptz,success boolean,fetched_count integer);
create table bot_events(id uuid default gen_random_uuid() primary key,telegram_update_id bigint unique,event_type text,telegram_user_id bigint,payload jsonb,created_at timestamptz default now());
create table listings(id uuid primary key,duplicate_of_listing_id uuid);
create table saved_listings(id uuid primary key default gen_random_uuid(),user_id uuid,listing_id uuid);
insert into sources(id,name,tier,runtime_mode,delivery_mode,enabled,poll_interval_minutes,consecutive_failures) values(1,'test','K1','live','live',true,30,99);
`);
const names=await readdir(new URL('supabase/migrations',root));
await db.exec(await sql('supabase/migrations/'+names.find(x=>x.endsWith('_bot_runtime_completion.sql'))));
const rows=async(q,a=[])=>(await db.query(q,a)).rows;
await test('all polling is five minutes despite source errors',async()=>{
 assert.equal((await rows('select poll_interval_minutes from sources'))[0].poll_interval_minutes,5);
 assert.equal((await rows('select app_private.enqueue_due_source_jobs(65) n'))[0].n,1);
});
await test('dispatcher ownership persists across concurrent invocations and enforces a shared gap',async()=>{
 const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
 assert.equal((await rows('select acquire_dispatcher($1) ok',[a]))[0].ok,true);
 assert.equal((await rows('select acquire_dispatcher($1) ok',[b]))[0].ok,false);
 const before=Date.now();const at=(await rows('select dispatcher_slot($1,true) at',[a]))[0].at;assert.ok(new Date(at).getTime()>=before+14000);
 assert.equal((await rows('select release_dispatcher($1) ok',[b]))[0].ok,false);
 await rows('select release_dispatcher($1)',[a]);
 assert.equal((await rows('select acquire_dispatcher($1) ok',[b]))[0].ok,true);
 assert.equal(new Date((await rows('select dispatcher_slot($1) at',[b]))[0].at).getTime(),new Date(at).getTime());
});
await test('failed Telegram update is retryable but a completed one stays deduplicated',async()=>{
 const payload={update_id:101,message:{from:{id:42},text:'/start'}};
 assert.equal((await rows('select claim_telegram_update($1) n',[payload]))[0].n,1);
 assert.equal((await rows('select claim_telegram_update($1) n',[payload]))[0].n,-1);
 await rows("select finish_telegram_update(101,1,false,'failure')");
 assert.equal((await rows('select claim_telegram_update($1) n',[payload]))[0].n,2);
 assert.equal((await rows('select finish_telegram_update(101,1,true) ok'))[0].ok,false);
 await rows('select finish_telegram_update(101,2,true)');
 assert.equal((await rows('select claim_telegram_update($1) n',[payload]))[0].n,0);
});
await test('saved-listing toggle is idempotent for replayed Telegram update',async()=>{
 const id='00000000-0000-4000-8000-000000000003';await db.query('insert into listings values($1,null)',[id]);
 assert.equal((await rows('select toggle_saved_once(102,$1,$1) saved',[id]))[0].saved,true);
 assert.equal((await rows('select toggle_saved_once(102,$1,$1) saved',[id]))[0].saved,true);
 assert.equal((await rows('select count(*)::int n from saved_listings'))[0].n,1);
 assert.equal((await rows('select toggle_saved_once(103,$1,$1) saved',[id]))[0].saved,false);
});
await test('new operational RPCs reject public roles',async()=>{
 for(const fn of ['acquire_dispatcher(uuid)','dispatcher_slot(uuid,boolean)','claim_telegram_update(jsonb)','toggle_saved_once(bigint,uuid,uuid)','record_source_probe(smallint,integer,boolean,integer,jsonb)'])
 assert.equal((await rows("select has_function_privilege('anon',$1,'EXECUTE') ok",[fn]))[0].ok,false);
});
await db.close();
