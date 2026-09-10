import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db = new PGlite();
await db.exec(await readFile(new URL('./fixtures/ingestion-schema.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../supabase/migrations/20260910095851_ingestion_fingerprint_fast_path.sql',import.meta.url),'utf8'));
const payload = (key, extra={}) => ({source_id:13,source_listing_key:key,canonical_url:`https://example.com/${key}`,raw:{source:'test',price:1000},warm_rent:1000,is_active:true,fresh_delivery_eligible:false,last_seen_at:'2026-09-10T10:00:00Z',...extra});
const ingest = async (rows,source=13) => (await db.query('select public.ingest_listing_batch($1::smallint,$2::jsonb) r',[source,JSON.stringify(rows)])).rows[0].r;
const listing = async key => (await db.query('select * from listings where source_id=13 and source_listing_key=$1',[key])).rows[0];

await test('batch ingestion is service-role only',async()=>{
 const {rows:[r]}=await db.query("select has_function_privilege('anon','public.ingest_listing_batch(smallint,jsonb)','EXECUTE') a,has_function_privilege('authenticated','public.ingest_listing_batch(smallint,jsonb)','EXECUTE') b,has_function_privilege('service_role','public.ingest_listing_batch(smallint,jsonb)','EXECUTE') c");
 assert.deepEqual(r,{a:false,b:false,c:true});
});
await test('empty and new batches report exact counts',async()=>{
 assert.deepEqual(await ingest([]),{seen:0,fresh:0,changed:0,touched:0});
 assert.deepEqual(await ingest([payload('one'),payload('two')]),{seen:2,fresh:2,changed:2,touched:0});
});
await test('unchanged payload refreshes observation without enrichment or first-seen changes',async()=>{
 const before=await listing('one');
 const newer=payload('one',{last_seen_at:'2026-09-10T10:05:00Z'});
 assert.deepEqual(await ingest([newer]),{seen:1,fresh:0,changed:0,touched:1});
 const after=await listing('one');
 assert.equal(after.enrichment_marker,before.enrichment_marker);
 assert.deepEqual(after.first_seen_at,before.first_seen_at);
 assert.equal(after.fresh_delivery_eligible,false);
 assert.equal(new Date(after.last_seen_at).toISOString(),'2026-09-10T10:05:00.000Z');
});
await test('JSON key ordering does not invalidate fingerprints',async()=>{
 const row=payload('two'); row.raw={price:1000,source:'test'};
 assert.equal((await ingest([Object.fromEntries(Object.entries(row).reverse())])).touched,1);
});
await test('real changes run normal enrichment and do not promote old inventory',async()=>{
 const before=await listing('one');
 const row=payload('one',{warm_rent:950,fresh_delivery_eligible:true});
 assert.deepEqual(await ingest([row]),{seen:1,fresh:0,changed:1,touched:0});
 const after=await listing('one');
 assert.equal(Number(after.warm_rent),950);
 assert.ok(after.enrichment_marker>before.enrichment_marker);
 assert.equal(after.fresh_delivery_eligible,false);
 assert.equal(new Date(after.last_seen_at).toISOString(),'2026-09-10T10:05:00.000Z');
 assert.equal((await ingest([row])).touched,1);
});
await test('external enrichment invalidates stale cache and next crawl uses normal processing',async()=>{
 await db.exec("update listings set warm_rent=1200 where source_listing_key='two'");
 assert.equal((await listing('two')).ingest_fingerprint,null);
 assert.equal((await ingest([payload('two')])).changed,1);
 assert.equal((await ingest([payload('two')])).touched,1);
});
await test('inactive listings are reactivated by an actual crawl',async()=>{
 await db.exec("update listings set is_active=false where source_listing_key='two'");
 assert.equal((await ingest([payload('two')])).changed,1);
 assert.equal((await listing('two')).is_active,true);
});
await test('malformed batches and source mixing fail without partial writes',async()=>{
 for(const rows of [null,{},[null],[1],[payload('x',{source_id:8})],[payload('x',{id:'00000000-0000-0000-0000-000000000001'})],[payload('x'),payload('x')],[payload('')],[payload('x',{raw:null})],[payload('x',{last_seen_at:null})],[payload('x',{is_active:false})],Array.from({length:101},(_,i)=>payload(`limit-${i}`)),[payload('valid-before-error'),payload('bad',{warm_rent:'invalid'})]]) {
  await assert.rejects(ingest(rows));
 }
 assert.equal((await db.query('select count(*)::int n from listings')).rows[0].n,2);
});
await test('separate sources may reuse the same source key without collision',async()=>{
 assert.equal((await ingest([payload('one',{source_id:8})],8)).fresh,1);
 assert.equal(Number((await listing('one')).warm_rent),950);
});
await db.close();
