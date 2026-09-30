import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),id=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0');
await db.exec(`create role anon;create role authenticated;create role service_role;
 create table sources(id smallint primary key,name text);
 create table listings(id uuid primary key,source_id smallint,title text,canonical_url text,district text,postal_code text,city text);
 create table applications(id uuid primary key,user_id uuid,listing_id uuid,status text,attempts int,last_error text,wait_reason text,created_at timestamptz,sent_at timestamptz,next_attempt_at timestamptz);
 create table application_events(id bigint primary key,application_id uuid,provider text,document_result text,status text,reason text,created_at timestamptz);
 create index on application_events(application_id,created_at);
 insert into sources values(4,'Immowelt');
 insert into listings values('${id(1)}',4,'Offer','https://example.test','Hamburg','20000','Hamburg');
 insert into applications select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(9000)}','${id(1)}','sent',1,null,null,now()-interval '1 day',now(),null from generate_series(100,1304) n;
 insert into applications values('${id(9999)}','${id(9001)}','${id(1)}','sent',1,null,null,now(),now(),null);
 insert into application_events select n,('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'immowelt','link_included','sent',null,now() from generate_series(100,1304) n;
 insert into application_events values(2000,'${id(100)}','immoscout','native_uploaded','sent',null,now()+interval '1 second');
 insert into application_events values(2001,'${id(100)}','kleinanzeigen','transfer_failed','failed',null,now()+interval '1 second');`);
await db.exec(await readFile(new URL('../supabase/migrations/20260930142205_coach_application_pagination.sql',import.meta.url),'utf8'));
const page=async({users=[id(9000)],provider=null,document=null,p=1,size=50,status=null}={})=>(await db.query('select coach_application_page_v1($1,30,$2,$3,$4,$5,$6) result',[users,status,provider,document,p,size])).rows[0].result;
await test('only one page is returned, with an exact total beyond 1000 rows and stable nonoverlapping order',async()=>{
 const first=await page(),second=await page({p:2});assert.equal(first.total,1205);assert.equal(first.applications.length,50);
 assert.equal(first.applications[0].id,id(1304));assert.equal(first.applications[0].listings.sources.name,'Immowelt');
 assert.ok(!second.applications.some(x=>first.applications.some(a=>a.id===x.id)));
 assert.equal((await page({p:25})).applications.length,5);assert.equal((await page({p:26})).applications.length,0);
});
await test('provider and document filters use the newest event, including deterministic equal timestamps',async()=>{
 const old=await page({provider:'immoscout'});assert.equal(old.total,0);
 const current=await page({provider:'kleinanzeigen',document:'transfer_failed'});assert.equal(current.total,1);assert.equal(current.applications[0].id,id(100));
 assert.equal((await page({provider:'immowelt'})).total,1204);assert.equal((await page({status:'failed'})).total,0);
});
await test('scoped UUIDs exclude unrelated participants; empty scope and out-of-range pages disclose nothing',async()=>{
 const result=await page();assert.ok(!result.applications.some(x=>x.user_id===id(9001)));
 assert.equal((await page({users:[]})).total,0);assert.equal((await page({users:[id(9001)]})).total,1);
});
await test('ordinary client roles cannot invoke the page RPC',async()=>{
 const signature='public.coach_application_page_v1(uuid[],integer,text,text,text,integer,integer)';
 const p=(await db.query("select has_function_privilege('anon',$1,'EXECUTE') a,has_function_privilege('authenticated',$1,'EXECUTE') b,has_function_privilege('service_role',$1,'EXECUTE') c",[signature])).rows[0];
 assert.deepEqual(p,{a:false,b:false,c:true});
});
await db.close();
