import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;create schema app_private;
 create table public.source_jobs(id int);grant all on public.source_jobs to anon,authenticated,service_role;
 create table app_private.coop_provider_index_requests(id int);
 create function app_private.internal_operation() returns int language sql as $$select 1$$;`);
await db.exec(await readFile(new URL('../supabase/migrations/20260910100818_backend_internal_least_privilege.sql',import.meta.url),'utf8'));
await test('private routines deny clients and preserve service execution',async()=>{
 const {rows:[r]}=await db.query("select has_function_privilege('anon','app_private.internal_operation()','execute') a,has_function_privilege('authenticated','app_private.internal_operation()','execute') b,has_function_privilege('service_role','app_private.internal_operation()','execute') c");
 assert.deepEqual(r,{a:false,b:false,c:true});
});
await test('source jobs are server-only and provider-index requests gain RLS',async()=>{
 const {rows:[r]}=await db.query("select has_table_privilege('anon','public.source_jobs','select') a,has_table_privilege('authenticated','public.source_jobs','select') b,has_table_privilege('service_role','public.source_jobs','select') c,(select relrowsecurity from pg_class where oid='app_private.coop_provider_index_requests'::regclass) rls");
 assert.deepEqual(r,{a:false,b:false,c:true,rls:true});
});
await test('the private schema blocks client access even for a newly created helper',async()=>{
  await db.exec('create function app_private.future_operation() returns int language sql as $$select 2$$');
  // PostgreSQL global defaults still grant function EXECUTE to PUBLIC. A per-schema
  // default REVOKE cannot override that; each new helper must revoke it explicitly.
  assert.equal((await db.query("select has_schema_privilege('anon','app_private','usage') allowed")).rows[0].allowed,false);
  await db.exec('begin;set local role anon');
  await assert.rejects(db.query('select app_private.future_operation()'),/permission denied/);
  await db.exec('rollback');
});
await db.close();
