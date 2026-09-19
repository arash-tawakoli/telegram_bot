import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import test from 'node:test';
test('compact counters and bounded snapshots preserve accuracy and private access',async()=>{
const db=new PGlite();
try {
await db.exec(`create schema app_private;
create role anon; create role authenticated; create role service_role;
create table sources(id smallint primary key,name text,enabled boolean default true,runtime_mode text default 'live',last_success_at timestamptz,last_error_at timestamptz,consecutive_failures integer default 0,baseline_completed_at timestamptz,coverage_status text,updated_at timestamptz);
insert into sources(id,name) values(64,'test');
create table crawl_runs(id serial primary key,source_id smallint,started_at timestamptz,finished_at timestamptz,success boolean,connector_priority smallint,connector_label text,fetched_count integer,inserted_count integer,metadata jsonb,error_message text);
create function app_private.maintenance_cleanup() returns jsonb language plpgsql as $$declare result jsonb:='{}';begin
  return result;
end$$;
create function public.record_crawl_result(p_source_id smallint,p_started_at timestamptz,p_finished_at timestamptz,p_success boolean,p_connector_priority smallint,p_connector_label text,p_fetched_count integer,p_inserted_count integer,p_metadata jsonb,p_error text) returns void language plpgsql as $$begin
 if p_success then
  update public.sources set last_success_at=p_finished_at,
      updated_at = p_finished_at
  where id=p_source_id;
 else
  update public.sources set last_error_at=p_finished_at,
      updated_at = p_finished_at
  where id=p_source_id;
 end if;
end$$;`);
await db.exec(await readFile(new URL('../supabase/migrations/20260919152426_retain_compact_performance_snapshots_and_crawl_counters.sql',import.meta.url),'utf8'));
for(const [ok,fetched,inserted] of [[true,10,1],[true,12,1],[false,0,0]]){
 await db.query(`select public.record_crawl_result(64::smallint,now()-interval '2 seconds',now(),$1,1::smallint,'test',$2,$3,'{}',null)`,[ok,fetched,inserted]);
}
const m=(await db.query(`select telemetry_crawls,telemetry_errors,telemetry_candidates,telemetry_new_rows,telemetry_elapsed_ms from sources`)).rows[0];
assert.deepEqual(m,{telemetry_crawls:3,telemetry_errors:1,telemetry_candidates:22,telemetry_new_rows:2,telemetry_elapsed_ms:6000});
assert.equal((await db.query(`select app_private.capture_performance_snapshot() v`)).rows[0].v,false);
assert.equal((await db.query(`select count(*)::int n from app_private.performance_snapshots`)).rows[0].n,1);
assert.equal((await db.query(`select has_function_privilege('anon','app_private.capture_performance_snapshot()','EXECUTE') v`)).rows[0].v,false);
await db.exec(`delete from app_private.performance_snapshots;insert into app_private.performance_snapshots values(now()-interval '36 days',now()-interval '36 days','{}')`);
assert.equal((await db.query(`select app_private.capture_performance_snapshot() v`)).rows[0].v,true);
assert.equal((await db.query(`select count(*)::int n from app_private.performance_snapshots where captured_at<now()-interval '35 days'`)).rows[0].n,0);
await db.query(`select app_private.maintenance_cleanup()`);
} finally { await db.close(); }
});
