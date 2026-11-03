import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const root = new URL('../', import.meta.url);
const migration = await readFile(
  new URL('supabase/migrations/20261103104300_listing_24h_retention.sql', root),
  'utf8',
);

const sql = (...lines) => lines.join('\n');
await db.exec(sql(
  'CREATE ROLE anon;',
  'CREATE ROLE authenticated;',
  'CREATE ROLE service_role;',
  'CREATE SCHEMA app_private;',
  'CREATE TABLE public.sources (id smallint PRIMARY KEY, name text NOT NULL);',
  'CREATE TABLE public.listings (',
  ' id uuid PRIMARY KEY, source_id smallint NOT NULL REFERENCES public.sources(id),',
  ' first_seen_at timestamptz NOT NULL, title text, canonical_url text NOT NULL,',
  ' district text, postal_code text, city text NOT NULL, warm_rent numeric,',
  ' rooms numeric, area_sqm numeric, address text, property_type text',
  ');',
  'CREATE TABLE public.applications (',
  ' id uuid PRIMARY KEY, listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE RESTRICT,',
  ' source_id bigint NOT NULL,',
  " status text NOT NULL CHECK (status IN ('pending','processing','sent','failed','manual_required')),",
  ' last_error text, wait_reason text, lease_token uuid, lease_until timestamptz,',
  ' next_attempt_at timestamptz NOT NULL DEFAULT now()',
  ');',
  'CREATE TABLE public.saved_listings (',
  ' id bigserial PRIMARY KEY, listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE',
  ');',
  "INSERT INTO public.sources(id,name) VALUES (1,'ImmoScout24');"
));

await db.exec(migration);

const query = async (statement, params = []) => db.query(statement, params);
const count = async table => (await query('SELECT count(*)::int AS n FROM ' + table)).rows[0].n;
const cleanup = async limit => (await query('SELECT app_private.delete_expired_listings($1) AS deleted', [limit])).rows[0].deleted;

await test('deletes expired listings, preserves application snapshots and cancels pending attempts', async () => {
  await db.exec(sql(
    'INSERT INTO public.listings',
    ' (id,source_id,first_seen_at,title,canonical_url,district,postal_code,city,warm_rent,rooms,area_sqm,address,property_type)',
    'VALUES',
    " ('00000000-0000-4000-8000-000000000001',1,now()-interval '24 hours 10 minutes','Altbau','https://example.test/1','Altona','22765','Hamburg',1200,2,55,'Altonaer Straße 1','apartment'),",
    " ('00000000-0000-4000-8000-000000000002',1,now()-interval '24 hours 5 minutes','Neubau','https://example.test/2','Eimsbüttel','20255','Hamburg',1400,3,72,'Eimsbütteler Straße 2','apartment'),",
    " ('00000000-0000-4000-8000-000000000003',1,now()-interval '23 hours 58 minutes','Frisch','https://example.test/3','Wandsbek','22041','Hamburg',900,2,48,'Wandsbeker Markt 3','apartment'),",
    " ('00000000-0000-4000-8000-000000000004',1,now()-interval '1 hour','Neu','https://example.test/4','Mitte','20095','Hamburg',1000,2,50,'Mönckebergstraße 4','apartment');",
    'INSERT INTO public.applications(id,listing_id,source_id,status,next_attempt_at)',
    'VALUES',
    " ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',1,'sent',now()),",
    " ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002',1,'pending',now());",
    "UPDATE public.applications SET lease_token='20000000-0000-4000-8000-000000000001', lease_until=now()+interval '2 minutes', wait_reason='provider_busy' WHERE id='10000000-0000-4000-8000-000000000002';",
    "INSERT INTO public.saved_listings(listing_id) VALUES ('00000000-0000-4000-8000-000000000001');"
  ));

  assert.equal(await cleanup(1),1);
  assert.equal(await count('public.listings'),3);
  assert.equal(await count('public.saved_listings'),0);

  const sent = (await query("SELECT listing_id,status,listing_snapshot FROM public.applications WHERE id='10000000-0000-4000-8000-000000000001'")).rows[0];
  assert.equal(sent.listing_id,null);
  assert.equal(sent.status,'sent');
  assert.equal(sent.listing_snapshot.title,'Altbau');
  assert.equal(sent.listing_snapshot.source_name,'ImmoScout24');
  assert.equal(sent.listing_snapshot.canonical_url,'https://example.test/1');

  assert.equal(await cleanup(1),1);
  const pending = (await query("SELECT listing_id,status,last_error,wait_reason,lease_token,lease_until,listing_snapshot FROM public.applications WHERE id='10000000-0000-4000-8000-000000000002'")).rows[0];
  assert.equal(pending.listing_id,null);
  assert.equal(pending.status,'failed');
  assert.equal(pending.last_error,'listing_expired');
  assert.equal(pending.wait_reason,'listing_expired');
  assert.equal(pending.lease_token,null);
  assert.equal(pending.lease_until,null);
  assert.equal(pending.listing_snapshot.title,'Neubau');

  assert.equal(await count('public.listings'),2);
  assert.equal(await cleanup(10),0);
});

await test('retention is bounded and keeps listings younger than the safety cutoff', async () => {
  await db.exec(sql(
    'INSERT INTO public.listings(id,source_id,first_seen_at,title,canonical_url,city)',
    'SELECT',
    " ('30000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,",
    ' 1, now()-interval \'24 hours 2 minutes\',',
    " 'Expired '||n, 'https://example.test/expired/'||n, 'Hamburg'",
    'FROM generate_series(1,3) AS n;',
    'INSERT INTO public.listings(id,source_id,first_seen_at,title,canonical_url,city)',
    'VALUES',
    " ('40000000-0000-4000-8000-000000000001',1,now()-interval '23 hours 58 minutes','Not expired','https://example.test/fresh','Hamburg');"
  ));

  assert.equal(await cleanup(2),2);
  assert.equal(await count('public.listings'),2);
  assert.equal(await cleanup(2),1);
  assert.equal(await count('public.listings'),1);
  assert.equal(await cleanup(2),0);
  assert.equal((await query('SELECT title FROM public.listings')).rows[0].title,'Not expired');
  await assert.rejects(() => cleanup(5001), /p_limit must be between 1 and 5000/);
});

await db.close();
