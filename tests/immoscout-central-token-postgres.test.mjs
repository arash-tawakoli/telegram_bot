import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = await readFile(new URL('../supabase/migrations/20261103172212_immoscout_central_token_postgres.sql', import.meta.url), 'utf8');

await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE ROLE service_role;
  CREATE SCHEMA app_private;
`);
await db.exec(migration);

test('central ImmoScout credentials are stored in a single disabled-by-default encrypted row', async () => {
  await db.query(`
    INSERT INTO app_private.immoscout_central_credentials
      (singleton,account_hint,ciphertext,iv,status,enabled)
    VALUES ('central','arash@nexalabs.de','ciphertext','iv','connected',0)
  `);
  const row = (await db.query('SELECT singleton,account_hint,status,enabled FROM app_private.immoscout_central_credentials')).rows[0];
  assert.equal(row.singleton, 'central');
  assert.equal(row.status, 'connected');
  assert.equal(Number(row.enabled), 0);
  await assert.rejects(() => db.query(`
    INSERT INTO app_private.immoscout_central_credentials
      (singleton,account_hint,ciphertext,iv,status,enabled)
    VALUES ('other','arash@nexalabs.de','ciphertext','iv','connected',0)
  `));
  await assert.rejects(() => db.query(`
    INSERT INTO app_private.immoscout_central_credentials
      (singleton,account_hint,ciphertext,iv,status,enabled)
    VALUES ('central','other@example.com','ciphertext','iv','connected',0)
  `));
});

test('central OAuth flows are short-lived, unique and bound to a UUID user', async () => {
  await db.query(`
    INSERT INTO app_private.immoscout_central_oauth_flows
      (state_hash,verifier_ciphertext,verifier_iv,admin_telegram_id,user_id,expires_at)
    VALUES ('hash','ciphertext','iv','8538226539','00000000-0000-4000-8000-000000000001',now()+interval '15 minutes')
  `);
  const row = (await db.query('SELECT state_hash,consumed_at FROM app_private.immoscout_central_oauth_flows')).rows[0];
  assert.equal(row.state_hash, 'hash');
  assert.equal(row.consumed_at, null);
  await assert.rejects(() => db.query(`
    INSERT INTO app_private.immoscout_central_oauth_flows
      (state_hash,verifier_ciphertext,verifier_iv,admin_telegram_id,user_id,expires_at)
    VALUES ('hash','ciphertext','iv','8538226539','00000000-0000-4000-8000-000000000001',now()+interval '15 minutes')
  `));
});

test('audit events are append-only records with timestamps', async () => {
  await db.query(`
    INSERT INTO app_private.immoscout_central_audit_events(event_type,account_hint,admin_telegram_id)
    VALUES ('credential_stored','arash@nexalabs.de','8538226539')
  `);
  const row = (await db.query('SELECT event_type,created_at FROM app_private.immoscout_central_audit_events')).rows[0];
  assert.equal(row.event_type, 'credential_stored');
  assert.ok(row.created_at);
});

test('central token tables have row-level security enabled and are not granted to public roles', async () => {
  const rows = (await db.query(`
    SELECT c.relname,c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='app_private'
      AND c.relname IN (
        'immoscout_central_credentials',
        'immoscout_central_oauth_flows',
        'immoscout_central_audit_events'
      )
  `)).rows;
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.relrowsecurity === true));
});

after(async () => { await db.close(); });
