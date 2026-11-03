import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = await readFile(
  new URL('../supabase/migrations/20261103104300_listing_24h_retention.sql', import.meta.url),
  'utf8',
);

await db.exec([
  'CREATE ROLE anon;',
  'CREATE ROLE authenticated;',
  'CREATE ROLE service_role;',
  'CREATE SCHEMA app_private;',
  'CREATE TABLE public.sources (id smallint PRIMARY KEY, name text NOT NULL);',
  'CREATE TABLE public.listings (id uuid PRIMARY KEY, source_id smallint NOT NULL REFERENCES public.sources(id), first_seen_at timestamptz NOT NULL, title text, canonical_url text NOT NULL, city text NOT NULL);',
  'CREATE TABLE public.listing_changes (id uuid PRIMARY KEY, listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE);',
  "CREATE TABLE public.applications (id uuid PRIMARY KEY, listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE RESTRICT, status text NOT NULL CHECK (status IN ('pending','processing','sent','failed','manual_required')), last_error text, wait_reason text, lease_token uuid, lease_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now());",
  "CREATE TABLE public.delivery_events (id uuid PRIMARY KEY, listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE, change_id uuid REFERENCES public.listing_changes(id) ON DELETE CASCADE, status text NOT NULL CHECK (status IN ('available','pending','failed','sent','skipped')), error_message text, next_retry_at timestamptz, preview_progress jsonb);",
  'CREATE TABLE public.saved_listings (id uuid PRIMARY KEY, listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE, updated_at timestamptz NOT NULL DEFAULT now());',
  "INSERT INTO public.sources(id,name) VALUES (1,'ImmoScout24');"
].join('\n'));

await db.exec(migration);

const query = async (statement, params = []) => db.query(statement, params);
const count = async (table) => (await query('SELECT count(*)::int AS n FROM ' + table)).rows[0].n;
const cleanup = async (limit) =>
  (await query('SELECT app_private.delete_expired_listings($1) AS deleted', [limit])).rows[0].deleted;

test('expired listing content is deleted while application, delivery and saved-item history survives', async () => {
  await db.exec([
    'INSERT INTO public.listings(id,source_id,first_seen_at,title,canonical_url,city)',
    'VALUES',
    "('00000000-0000-4000-8000-000000000001',1,now()-interval '24 hours 10 minutes','Altbau','https://example.test/1','Hamburg'),",
    "('00000000-0000-4000-8000-000000000002',1,now()-interval '24 hours 5 minutes','Neubau','https://example.test/2','Hamburg'),",
    "('00000000-0000-4000-8000-000000000003',1,now()-interval '23 hours 45 minutes','Frisch','https://example.test/3','Hamburg');",
    "INSERT INTO public.listing_changes(id,listing_id) VALUES ('50000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');",
    'INSERT INTO public.applications(id,listing_id,status,next_attempt_at)',
    'VALUES',
    "('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','sent',now()),",
    "('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','pending',now());",
    "UPDATE public.applications SET lease_token='20000000-0000-4000-8000-000000000001', lease_until=now()+interval '2 minutes', wait_reason='provider_busy' WHERE id='10000000-0000-4000-8000-000000000002';",
    'INSERT INTO public.delivery_events(id,listing_id,change_id,status,next_retry_at,preview_progress)',
    'VALUES',
    "('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','sent',NULL,'{\"message_id\":42}'),",
    "('30000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002',NULL,'pending',now()+interval '5 minutes','{\"message_id\":43}'),",
    "('30000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',NULL,'failed',now()+interval '5 minutes','{\"message_id\":44}');",
    "INSERT INTO public.saved_listings(id,listing_id) VALUES ('40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');"
  ].join('\n'));

  assert.equal(await cleanup(1), 1);
  assert.equal(await count('public.listings'), 2);
  assert.equal(await count('public.applications'), 2);
  assert.equal(await count('public.delivery_events'), 3);
  assert.equal(await count('public.saved_listings'), 1);
  assert.equal(await count('public.listing_changes'), 0);

  const sentApplication = (await query(
    "SELECT listing_id,status,listing_expired_at FROM public.applications WHERE id='10000000-0000-4000-8000-000000000001'"
  )).rows[0];
  assert.equal(sentApplication.listing_id, null);
  assert.equal(sentApplication.status, 'sent');
  assert.ok(sentApplication.listing_expired_at);

  assert.equal(await cleanup(1), 1);
  const pendingApplication = (await query(
    "SELECT listing_id,status,last_error,wait_reason,lease_token,lease_until,listing_expired_at FROM public.applications WHERE id='10000000-0000-4000-8000-000000000002'"
  )).rows[0];
  assert.equal(pendingApplication.listing_id, null);
  assert.equal(pendingApplication.status, 'failed');
  assert.equal(pendingApplication.last_error, 'listing_expired');
  assert.equal(pendingApplication.wait_reason, 'listing_expired');
  assert.equal(pendingApplication.lease_token, null);
  assert.equal(pendingApplication.lease_until, null);
  assert.ok(pendingApplication.listing_expired_at);

  const sentDelivery = (await query(
    "SELECT listing_id,change_id,status,listing_expired_at FROM public.delivery_events WHERE id='30000000-0000-4000-8000-000000000001'"
  )).rows[0];
  assert.equal(sentDelivery.listing_id, null);
  assert.equal(sentDelivery.change_id, null);
  assert.equal(sentDelivery.status, 'sent');
  assert.ok(sentDelivery.listing_expired_at);

  const pendingDelivery = (await query(
    "SELECT listing_id,change_id,status,error_message,next_retry_at,preview_progress FROM public.delivery_events WHERE id='30000000-0000-4000-8000-000000000002'"
  )).rows[0];
  assert.equal(pendingDelivery.listing_id, null);
  assert.equal(pendingDelivery.status, 'skipped');
  assert.equal(pendingDelivery.error_message, 'listing_expired');
  assert.equal(pendingDelivery.next_retry_at, null);
  assert.equal(pendingDelivery.preview_progress, null);

  const failedDelivery = (await query(
    "SELECT listing_id,status,error_message,next_retry_at FROM public.delivery_events WHERE id='30000000-0000-4000-8000-000000000003'"
  )).rows[0];
  assert.equal(failedDelivery.listing_id, null);
  assert.equal(failedDelivery.status, 'failed');
  assert.equal(failedDelivery.error_message, 'provider_503');
  assert.equal(failedDelivery.next_retry_at, null);

  const saved = (await query(
    "SELECT listing_id,listing_expired_at FROM public.saved_listings WHERE id='40000000-0000-4000-8000-000000000001'"
  )).rows[0];
  assert.equal(saved.listing_id, null);
  assert.ok(saved.listing_expired_at);
  assert.equal(await cleanup(10), 0);

  const snapshotColumn = await query(
    "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='applications' AND column_name='listing_snapshot'"
  );
  assert.equal(snapshotColumn.rows[0].n, 0);
});

test('retention is bounded and enforces the full 24-hour cutoff', async () => {
  await db.exec('TRUNCATE public.applications, public.delivery_events, public.saved_listings, public.listing_changes, public.listings CASCADE');
  await db.exec([
    'INSERT INTO public.listings(id,source_id,first_seen_at,title,canonical_url,city)',
    'SELECT',
    "('60000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,",
    "1, now()-interval '24 hours 2 minutes',",
    "'Expired '||n, 'https://example.test/expired/'||n, 'Hamburg'",
    'FROM generate_series(1,3) AS n;',
    'INSERT INTO public.listings(id,source_id,first_seen_at,title,canonical_url,city)',
    'VALUES',
    "('70000000-0000-4000-8000-000000000001',1,now()-interval '23 hours 45 minutes','Not expired','https://example.test/fresh','Hamburg'),",
    "('70000000-0000-4000-8000-000000000002',1,now()-interval '24 hours','At 24 hours','https://example.test/exact','Hamburg'),",
    "('70000000-0000-4000-8000-000000000003',1,now()-interval '23 hours 59 minutes 59 seconds','Just before 24 hours','https://example.test/before','Hamburg');"
  ].join('\n'));

  assert.equal(await cleanup(2), 2);
  assert.equal(await count('public.listings'), 4);
  assert.equal(await cleanup(2), 2);
  assert.equal(await count('public.listings'), 2);
  assert.equal(await cleanup(2), 0);
  const remainingTitles = (await query('SELECT title FROM public.listings ORDER BY title')).rows.map((row) => row.title);
  assert.deepEqual(remainingTitles, ['Just before 24 hours', 'Not expired']);
  await assert.rejects(() => cleanup(5001), /p_limit must be between 1 and 5000/);
});

after(async () => {
  await db.close();
});
