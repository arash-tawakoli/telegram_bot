import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
await db.exec(await read('tests/fixtures/ingestion-schema.sql'));
await db.exec(await read('supabase/migrations/20260910095851_ingestion_fingerprint_fast_path.sql'));
await db.exec(`
 ALTER TABLE listings ADD quality_status text DEFAULT 'accepted', ADD dedupe_group_id uuid;
 CREATE FUNCTION app_private.normalized_listing_address(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT lower(coalesce($1,''))$$;
 CREATE TABLE listing_changes(listing_id uuid,changed_fields text[],old_values jsonb,new_values jsonb);
 CREATE INDEX listings_quality_status_idx ON listings(last_seen_at);
 CREATE INDEX listings_active_idx ON listings(last_seen_at);
 CREATE INDEX listings_primary_active_idx ON listings(last_seen_at);
 CREATE INDEX listings_enrichment_status_idx ON listings(last_seen_at);
 CREATE INDEX listings_image_status_idx ON listings(last_seen_at);
`);
await db.exec(await read('supabase/migrations/20260901084043_fix_listing_change_array_append.sql'));
await db.exec('CREATE TRIGGER listings_capture_product_changes AFTER UPDATE ON listings FOR EACH ROW EXECUTE FUNCTION app_private.capture_listing_changes()');
await db.exec(await read('supabase/migrations/20260910202123_listing_hot_updates_and_bounded_maintenance.sql'));
const row={source_id:13,source_listing_key:'test',raw:{price:1000},warm_rent:1000,last_seen_at:'2026-09-10T10:00:00Z',is_active:true,fresh_delivery_eligible:false};
const ingest=async data=>(await db.query('select ingest_listing_batch(13::smallint,$1::jsonb) r',[JSON.stringify([data])])).rows[0].r;
const state=async()=>(await db.query('select xmin::text version,last_seen_at,warm_rent from listings')).rows[0];
await test('same or older observations leave the physical row version unchanged',async()=>{
 await ingest(row);const before=await state();
 for(const stamp of [row.last_seen_at,'2026-09-10T09:00:00Z']) {
  assert.deepEqual(await ingest({...row,last_seen_at:stamp}),{seen:1,fresh:0,changed:0,touched:1});
  assert.deepEqual(await state(),before);
 }
});
await test('new observations keep exact freshness without creating product changes',async()=>{
 await ingest({...row,last_seen_at:'2026-09-10T10:05:00Z'});
 assert.equal(new Date((await state()).last_seen_at).toISOString(),'2026-09-10T10:05:00.000Z');
 assert.equal((await db.query('select count(*)::int n from listing_changes')).rows[0].n,0);
});
await test('direct and trigger-derived price changes still emit product events',async()=>{
 await ingest({...row,warm_rent:950});
 await db.exec(`CREATE FUNCTION derived_price() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.warm_rent:=900;RETURN NEW;END$$;
 CREATE TRIGGER aa_derived BEFORE UPDATE OF title ON listings FOR EACH ROW EXECUTE FUNCTION derived_price();
 UPDATE listings SET title='updated';`);
 assert.deepEqual((await db.query('select new_values from listing_changes')).rows.map(x=>x.new_values.warm_rent),[950,900]);
});
await test('observation column is absent from every index and client access remains denied',async()=>{
 assert.equal((await db.query("select count(*)::int n from pg_indexes where tablename='listings' and indexdef like '%last_seen_at%'")).rows[0].n,0);
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'public.ingest_listing_batch(smallint,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,false);
});
await db.close();
