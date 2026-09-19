import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const db=new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema app_private;
create table public.sources(id smallint primary key,listing_priority int);
create table public.listing_dedupe_groups(id uuid primary key default gen_random_uuid(),preferred_listing_id uuid,updated_at timestamptz default now());
create table public.listings(
 id uuid primary key default gen_random_uuid(),source_id smallint references sources(id),
 canonical_url text,raw jsonb default '{}',title text,address text,postal_code text,
 rooms numeric,area_sqm numeric,warm_rent numeric,cold_rent numeric,deposit numeric,deposit_text text,resolved_image_url text,
 cross_source_hash text,quality_status text default 'accepted',is_active boolean default true,
 dedupe_group_id uuid references listing_dedupe_groups(id),is_primary_listing boolean default true,
 duplicate_of_listing_id uuid,dedupe_match_reason text,first_seen_at timestamptz default now(),last_seen_at timestamptz default now()
);
create table public.delivery_events(id uuid primary key default gen_random_uuid(),listing_id uuid references listings(id),status text,next_retry_at timestamptz,error_message text,delivery_outcome_unknown boolean default false);
insert into sources values(23,1),(32,2),(37,3);
`);
// Load the actual production helper bodies, rather than weakening fixtures with stubbed comparisons.
let s=read('20260919164605_expand_cooperative_auto_apply_targets.sql');
let start=s.indexOf('create or replace function app_private.immomio_application_target(');
await db.exec(s.slice(start,s.indexOf('end $fn$;',start)+'end $fn$;'.length));
s=read('20260828094408_listing_priority_dedupe_and_cost_semantics.sql');
start=s.indexOf('create or replace function app_private.normalized_listing_address(');
await db.exec(s.slice(start,s.indexOf('$$;',s.indexOf('as $$',start))+'$$;'.length));
s=read('20260919150847_avoid_redundant_ingest_locks_and_dedupe_writes.sql');
start=s.indexOf('create or replace function app_private.refresh_listing_dedupe_group(');
await db.exec(s.slice(start));
await db.exec('begin;'+read('20260919171615_preserve_cooperative_object_identity_dedupe.sql')+'commit;');
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const ids=[1,2,3,4].map(n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`);
const url=id=>`https://tenant.immomio.com/apply/${id}`;
async function add(target,{source=32,address='Teststrasse 10, 21073 Hamburg',canonical=url(target),raw={},seen='2026-08-01T10:00:00Z'}={}){
 const [r]=await query("insert into listings(source_id,canonical_url,raw,title,address,postal_code,rooms,area_sqm,warm_rent,cross_source_hash,first_seen_at,last_seen_at) values($1,$2,$3,'Testwohnung',$4,'21073',3,84,1729.25,'same-building-fingerprint',$5,$5) returning id",[source,canonical,raw,address,seen]);
 return r.id;
}
const assign=async id=>(await query('select app_private.assign_listing_dedupe($1) id',[id]))[0].id;
const units=[];
await test('four different verified apartment targets at one address retain four groups',async()=>{
 for(const target of ids){const id=await add(target);units.push(id);await assign(id);}
 const [r]=await query('select count(distinct dedupe_group_id)::int groups,count(*) filter(where is_primary_listing)::int primaries from listings');
 assert.deepEqual(r,{groups:4,primaries:4});
});
let mirror;
await test('same verified object across a different source and locale remains one group',async()=>{
 mirror=await add(ids[0],{source:37,canonical:`https://tenant.immomio.com/de/apply/${ids[0]}/?utm_source=fixture`});
 assert.equal(await assign(mirror),await assign(units[0]));
 assert.equal((await query('select is_primary_listing from listings where id=$1',[mirror]))[0].is_primary_listing,false);
});
await test('repeated identity assignment is a physical no-op and keeps history unchanged',async()=>{
 const snap=()=>query('select l.id,l.ctid::text tuple,l.first_seen_at,l.last_seen_at,l.raw,l.dedupe_group_id,g.ctid::text group_tuple from listings l join listing_dedupe_groups g on g.id=l.dedupe_group_id order by l.id');
 const before=await snap();
 for(const id of [...units,mirror])await assign(id);
 assert.deepEqual(await snap(),before);
});
await test('a known different target cannot bridge through an unresolved member of a group',async()=>{
 const noTarget=await add(ids[1],{canonical:'https://example.test/offer/local',raw:{}});
 const group=await assign(noTarget);
 const [known]=await query("select l.id,app_private.immomio_application_target(l.raw,l.canonical_url)->>'source_identifier' target from listings l where l.dedupe_group_id=$1 and l.id<>$2 limit 1",[group,noTarget]);
 const different=ids.find(x=>x!==known.target);
 const other=await add(different,{source:23});
 assert.notEqual(await assign(other),group);
});
await test('repair splits existing incompatible groups without touching listing facts',async()=>{
 await db.exec('begin');
 const [row]=await query('select dedupe_group_id from listings where id=$1',[units[0]]);
 await query('update listings set dedupe_group_id=$1 where id=$2',[row.dedupe_group_id,units[1]]);
 const before=await query('select first_seen_at,last_seen_at,raw from listings where id=$1',[units[1]]);
 assert.notEqual(await assign(units[1]),row.dedupe_group_id);
 assert.deepEqual(await query('select first_seen_at,last_seen_at,raw from listings where id=$1',[units[1]]),before);
 await db.exec('rollback');
});
await test('uncertain Telegram outcomes remain untouched while safe duplicates are skipped',async()=>{
 await query("insert into delivery_events(listing_id,status,delivery_outcome_unknown) values($1,'failed',true),($1,'pending',false)",[mirror]);
 await assign(mirror);
 const r=await query('select status,delivery_outcome_unknown from delivery_events order by delivery_outcome_unknown');
 assert.deepEqual(r,[{status:'skipped',delivery_outcome_unknown:false},{status:'failed',delivery_outcome_unknown:true}]);
});
await test('identity assignment is not a public client API',async()=>{
 const [r]=await query("select has_function_privilege('anon','app_private.assign_listing_dedupe(uuid)','execute') anon,has_function_privilege('authenticated','app_private.assign_listing_dedupe(uuid)','execute') authenticated,has_function_privilege('service_role','app_private.assign_listing_dedupe(uuid)','execute') backend");
 assert.deepEqual(r,{anon:false,authenticated:false,backend:true});
});
await db.close();
