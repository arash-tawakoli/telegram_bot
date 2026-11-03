import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema app_private;
create table sources(id smallint primary key,name text,source_type text,enabled boolean default true,runtime_mode text default 'live',delivery_mode text default 'live');
create table source_connectors(source_id smallint,connector_kind text,config jsonb default '{}',enabled boolean default true,shadow_only boolean default false,priority int default 1);
create table bot_users(id uuid primary key,is_active boolean default true,auto_apply_enabled boolean default true);
create table listings(id uuid primary key,source_id smallint references sources(id),canonical_url text,title text,raw jsonb,external_id text,source_listing_key text,is_active boolean default true,is_primary_listing boolean default true,quality_status text default 'accepted',property_type text default 'Wohnung',first_seen_at timestamptz default now());
create table applications(id uuid primary key default gen_random_uuid(),user_id uuid references bot_users(id) on delete cascade,listing_id uuid references listings(id),source_id smallint,status text default 'pending',attempts int default 0,last_error text,submission_started_at timestamptz,created_at timestamptz default now(),sent_at timestamptz,lease_token uuid,lease_until timestamptz,next_attempt_at timestamptz default now(),unique(user_id,listing_id));
create table delivery_events(listing_id uuid,recipient_user_id uuid,event_type text default 'new_listing',status text default 'sent');
create table platform_connections(user_id uuid,provider text,status text);
create table coaching_members(
 id uuid primary key,is_active boolean default true,workspace_id uuid,role text,auth_user_id uuid
);
create table coaching_participants(
 user_id uuid,workspace_id uuid,status text,coach_member_id uuid,assignment_version integer
);
create table coaching_workspaces(id uuid primary key,is_active boolean,operations_paused boolean);
create table platform_auth_flows(
 id uuid primary key default gen_random_uuid(),user_id uuid,provider text,state text,code_verifier text,
 origin text,issued_by uuid,return_target text,context jsonb,expires_at timestamptz,consumed_at timestamptz
);
create function public.coach_effective_premium_status(uuid[]) returns table(is_premium boolean)
 language sql as $ select true $;
insert into coaching_members(id,is_active,workspace_id,role,auth_user_id)
 values('aaaaaaaa-0000-4000-8000-000000000099',true,'bbbbbbbb-0000-4000-8000-000000000099','admin','cccccccc-0000-4000-8000-000000000099');
create table application_preferences(
 user_id uuid primary key,enabled boolean default false,immoscout_enabled boolean default false,
 kleinanzeigen_enabled boolean default false,immomio_enabled boolean default false,immowelt_enabled boolean default false,
 updated_at timestamptz default now()
);
create function app_private.reconcile_recent_user_applications(uuid,text,interval,uuid) returns integer language sql as $ select 0 $;
insert into sources values (2,'Kleinanzeigen Hamburg','Marketplace',true,'live','live'),(6,'WG-Gesucht Hamburg','Marketplace',true,'live','live');
insert into source_connectors(source_id,connector_kind) values(2,'kleinanzeigen'),(6,'wg_gesucht');
insert into application_preferences(user_id,kleinanzeigen_enabled) values('aaaaaaaa-0000-4000-8000-000000000099',true);
create table app_private.application_platforms(source_id smallint,verified_at timestamptz);
create function app_private.user_is_premium(uuid) returns boolean language sql as $$select coalesce(current_setting('test.premium',true),'true')='true'$$;
create function app_private.applicant_profile_complete(uuid) returns boolean language sql as $$select coalesce(current_setting('test.profile',true),'true')='true'$$;
create function app_private.application_listing_auto_apply_allowed(text,text,jsonb) returns boolean language sql as $$select true$$;
create function app_private.delivery_newness_qualified(p_id uuid,p_now timestamptz) returns boolean language sql as $$select first_seen_at between p_now-interval '24 hours' and p_now from public.listings where id=p_id$$;
create function app_private.application_provider_for_listing(smallint,jsonb) returns text language sql as $$select null::text$$;
create function app_private.application_provider_ready(uuid,smallint,jsonb) returns boolean language sql as $$select true$$;
create function public.claim_application() returns text language sql as $$select app_private.application_provider_for_listing(l.source_id,l.raw) from public.listings l limit 1$$;
create function public.claim_immomio_application() returns text language sql as $$select app_private.application_provider_for_listing(l.source_id,l.raw) from public.listings l limit 1$$;
create function public.claim_kleinanzeigen_application() returns text language sql as $$select app_private.application_provider_for_listing(l.source_id,l.raw) from public.listings l limit 1$$;
create function app_private.dispatch_due_application_workers() returns text language sql as $$select app_private.application_provider_for_listing(l.source_id,l.raw) from public.listings l limit 1$$;
create function app_private.enqueue_matched_application() returns boolean language sql as $$select app_private.application_provider_ready(u.id,l.source_id,l.raw) from public.listings l cross join public.bot_users u limit 1$$;
create function public.enqueue_application_now(uuid,uuid) returns boolean language sql as $$select app_private.application_provider_ready(u.id,l.source_id,l.raw) from public.listings l cross join public.bot_users u limit 1$$;
`);
const sql=readFileSync(new URL('../supabase/migrations/20260919164605_expand_cooperative_auto_apply_targets.sql',import.meta.url),'utf8');
await db.exec('begin;'+sql+'commit;');
const retireSql=readFileSync(new URL('../supabase/migrations/20261103205000_retire_wg_gesucht_and_kleinanzeigen.sql',import.meta.url),'utf8');
await db.exec('begin;'+retireSql+'commit;');
const result=async(sql,args=[]) => (await db.query(sql,args)).rows;
const id='01234567-89ab-4cde-8123-456789abcdef',id2='11234567-89ab-4cde-8123-456789abcdef';
const url=`https://tenant.immomio.com/apply/${id}`;
const target=async(raw={},canonical=null)=>(await result('select app_private.immomio_application_target($1,$2) t',[raw,canonical]))[0].t;
await test('all official link fields, canonical URL, locale and tracking normalize identically',async()=>{
 for(const field of ['applicationLink','application_link','applicationUrl','application_url','tenant_apply_url']){
  assert.deepEqual(await target({[field]:`https://tenant.immomio.com/de/apply/${id}/?utm_source=x#details`}),{status:'resolved',provider:'immomio',source_identifier:id,url});
 }
 assert.equal((await target({},url)).url,url);
 assert.equal((await target({applicationLink:'',application_url:url})).url,url);
 assert.equal((await target({},url.toUpperCase())).url,url);
});
await test('foreign origins, registrations, malformed UUIDs, ports and control characters never qualify',async()=>{
 for(const bad of [url.replace('https:','http:'),url.replace('.com/','.com.evil/'),url.replace('.com/','.com:443/'),url.replace('tenant.','attacker@tenant.'),url.replace('apply/','auth/register/'),url.replace(id,'------------------------------------'),url+'\n',url+'?next=\\evil',url.replace('/apply/','/de/../apply/')]){
  assert.equal((await target({applicationLink:bad})).status,'missing',bad);
 }
});
await test('conflicting target identities fail closed instead of choosing the first',async()=>{
 assert.equal((await target({applicationLink:url,tenant_apply_url:url.replace(id,id2)})).status,'conflict');
 assert.equal((await target({applicationLink:url},url.replace(id,id2))).status,'conflict');
 assert.equal((await target({applicationLink:url,application_url:url+'?ref=other'})).status,'resolved');
});
await test('routing uses the actual application destination, retaining native fallbacks',async()=>{
 assert.equal((await result('select app_private.application_provider_target(1::smallint,$1,null) p',[{applicationLink:url}]))[0].p,'immomio');
 assert.equal((await result("select app_private.application_provider_target(2::smallint,'{}',null) p"))[0].p,null);
 assert.equal((await result("select app_private.application_provider_target(1::smallint,'{}',null) p"))[0].p,'immoscout');
 assert.equal((await result("select app_private.application_provider_target(3::smallint,'{}',null) p"))[0].p,'immowelt');
 assert.equal((await result("select enabled from public.sources where id=2"))[0].enabled,false);
 assert.equal((await result("select enabled from public.sources where id=6"))[0].enabled,false);
 assert.equal((await result("select count(*)::int n from public.source_connectors where source_id in (2,6)"))[0].n,0);
 assert.equal((await result("select kleinanzeigen_enabled from public.application_preferences where user_id='aaaaaaaa-0000-4000-8000-000000000099'"))[0].kleinanzeigen_enabled,false);
 await assert.rejects(()=>result("select public.set_application_provider_enabled_shared(gen_random_uuid(),'kleinanzeigen',true)"),/invalid_provider/);
 await assert.rejects(
  ()=>result("select public.coach_issue_platform_connect_flow('aaaaaaaa-0000-4000-8000-000000000099',gen_random_uuid(),'kleinanzeigen',repeat('a',40),repeat('b',50))"),
  /provider_unsupported/
 );
 assert.equal((await result('select app_private.application_provider_target(37::smallint,$1,null) p',[{tenant_apply_url:url}]))[0].p,'immomio');
});
const u='aaaaaaaa-0000-4000-8000-000000000001',u2='aaaaaaaa-0000-4000-8000-000000000002';
const l='bbbbbbbb-0000-4000-8000-000000000001',l2='bbbbbbbb-0000-4000-8000-000000000002',a='cccccccc-0000-4000-8000-000000000001',a2='cccccccc-0000-4000-8000-000000000002',token='dddddddd-0000-4000-8000-000000000001';
await db.exec(`insert into sources values (23,'Native','Baugenossenschaft',true,'live','live'),(37,'Hybrid','Baugenossenschaft',true,'live','live');insert into source_connectors(source_id,connector_kind) values(23,'immomio_tenant'),(37,'json_endpoint');`);
await db.query('insert into bot_users(id) values($1),($2)',[u,u2]);
await db.query("insert into platform_connections values($1,'immomio','connected'),($2,'immomio','connected')",[u,u2]);
await db.query('insert into listings(id,source_id,canonical_url,title,raw) values($1,23,$3,\'Test\',\'{}\'),($2,37,$3,\'Test mirror\',\'{}\')',[l,l2,url]);
await db.query('insert into applications(id,user_id,listing_id,source_id,lease_token,lease_until) values($1,$3,$4,23,$6,now()+interval \'3 minutes\'),($2,$3,$5,37,$6,now()+interval \'3 minutes\')',[a,a2,u,l,l2,token]);
await db.query('insert into delivery_events(listing_id,recipient_user_id) values($1,$3),($2,$3)',[l,l2,u]);
await test('account worker obtains the same canonical target without rewriting listing data',async()=>{
 const r=(await result('select public.get_immomio_application_listing($1) j',[l]))[0].j;
 assert.equal(r.raw.applicationLink,url);assert.equal(r.application_target.source_identifier,id);
 assert.deepEqual((await result('select raw from listings where id=$1',[l]))[0].raw,{});
});
await test('wrong lease and changed source identifiers cannot authorize a send',async()=>{
 assert.equal((await result('select public.authorize_immomio_application_send($1,$2,$3) ok',[a,token,id2]))[0].ok,false);
 assert.equal((await result('select public.authorize_immomio_application_send($1,$2,$3) ok',[a,u,id]))[0].ok,false);
});
await test('permissions, profile, opt-in, active offer and 24h newness are rechecked',async()=>{
 for(const setting of ['premium','profile']){
  await db.exec(`set test.${setting}='false'`);
  assert.equal((await result('select public.authorize_immomio_application_send($1,$2,$3) ok',[a,token,id]))[0].ok,false);
  await db.exec(`set test.${setting}='true'`);await db.query("update applications set status='pending' where id=$1",[a]);
 }
 for(const change of ["update bot_users set auto_apply_enabled=false", "update listings set first_seen_at=now()-interval '25 hours'", "update listings set is_active=false"]){
  await db.exec('begin');await db.exec(change);
  assert.equal((await result('select public.authorize_immomio_application_send($1,$2,$3) ok',[a,token,id]))[0].ok,false);
  await db.exec('rollback');
 }
 assert.equal((await result('select count(*)::int n from app_private.application_send_keys'))[0].n,0);
});
await test('one platform object reserves one send across two listing sources',async()=>{
 assert.equal((await result('select public.authorize_immomio_application_send($1,$2,$3) ok',[a,token,id]))[0].ok,true);
 assert.equal((await result('select public.authorize_immomio_application_send($1,$2,$3) ok',[a2,token,id]))[0].ok,false);
 assert.equal((await result('select last_error from applications where id=$1',[a2]))[0].last_error,'duplicate_provider_object');
 assert.equal((await result('select count(*)::int n from app_private.application_send_keys'))[0].n,1);
});
await test('send permission binds user, listing, lease, target and unresolved reservation',async()=>{
 const check=async(args)=>(await result('select public.validate_immomio_application_send($1,$2,$3,$4,$5) ok',args))[0].ok;
 assert.equal(await check([a,token,u,l,id]),true);
 assert.equal(await check([a,token,u2,l,id]),false);
 assert.equal(await check([a,token,u,l2,id]),false);
 assert.equal(await check([a,token,u,l,id2]),false);
 const consume=async()=> (await result('select public.consume_immomio_application_send($1,$2,$3,$4,$5) ok',[a,token,u,l,id]))[0].ok;
 assert.equal(await consume(),true); assert.equal(await consume(),false);
 await db.query("update applications set status='manual_required',last_error='submission_unconfirmed' where id=$1",[a]);
 assert.equal(await check([a,token,u,l,id]),false);
 await db.query("update applications set status='pending' where id=$1",[a2]);
 assert.equal((await result('select public.authorize_immomio_application_send($1,$2,$3) ok',[a2,token,id]))[0].ok,false);
});
await test('readiness separates native and hybrid routing without claiming send verification',async()=>{
 const r=await result('select * from public.cooperative_auto_apply_readiness($1)',[u]);
 assert.equal(r.length,2);assert.equal(r[0].route,'immomio_public');assert.equal(r[1].route,'immomio_hybrid');
 assert.equal(r[0].readiness,'ready_for_provider_check_not_send_verified');
 assert.notEqual(r[0].registration_status,'verified');
});
await test('new RPCs and reservation table deny client roles',async()=>{
 for(const fn of ['public.get_immomio_application_listing(uuid)','public.authorize_immomio_application_send(uuid,uuid,uuid)','public.validate_immomio_application_send(uuid,uuid,uuid,uuid,uuid)','public.cooperative_auto_apply_readiness(uuid)','public.consume_immomio_application_send(uuid,uuid,uuid,uuid,uuid)']){
  const r=(await result("select has_function_privilege('anon',$1,'execute') a,has_function_privilege('authenticated',$1,'execute') b,has_function_privilege('service_role',$1,'execute') c",[fn]))[0];
  assert.deepEqual(r,{a:false,b:false,c:true});
 }
 assert.equal((await result("select has_table_privilege('anon','app_private.application_send_keys','select') ok"))[0].ok,false);
});
await db.close();
