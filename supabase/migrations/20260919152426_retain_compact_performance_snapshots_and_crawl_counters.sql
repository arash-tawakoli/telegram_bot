set local lock_timeout='3s';
set local statement_timeout='30s';

-- Piggyback counters on the source row already updated for every final crawl
-- result; do not create an additional log row or an additional edge invocation.
alter table public.sources
  add column telemetry_since timestamptz not null default now(),
  add column telemetry_crawls bigint not null default 0,
  add column telemetry_errors bigint not null default 0,
  add column telemetry_candidates bigint not null default 0,
  add column telemetry_new_rows bigint not null default 0,
  add column telemetry_elapsed_ms bigint not null default 0;

do $migration$
declare
  definition text;
  needle text := '      updated_at = p_finished_at';
  replacement text := E'      telemetry_crawls = telemetry_crawls + 1,\n'
    || E'      telemetry_errors = telemetry_errors + case when p_success then 0 else 1 end,\n'
    || E'      telemetry_candidates = telemetry_candidates + p_fetched_count,\n'
    || E'      telemetry_new_rows = telemetry_new_rows + p_inserted_count,\n'
    || E'      telemetry_elapsed_ms = telemetry_elapsed_ms + round(greatest(0,extract(epoch from (p_finished_at-p_started_at))*1000))::bigint,\n'
    || '      updated_at = p_finished_at';
begin
  definition := pg_get_functiondef('public.record_crawl_result(smallint,timestamptz,timestamptz,boolean,smallint,text,integer,integer,jsonb,text)'::regprocedure);
  if position('telemetry_crawls' in definition)>0
     or (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then
    raise exception 'Unexpected crawl-result function version; refusing patch';
  end if;
  execute replace(definition,needle,replacement);
end;
$migration$;

create table app_private.performance_snapshots (
  bucket_start timestamptz primary key,
  captured_at timestamptz not null default now(),
  metrics jsonb not null check (jsonb_typeof(metrics)='object')
);
alter table app_private.performance_snapshots enable row level security;
revoke all on app_private.performance_snapshots from public,anon,authenticated;
grant select,insert,delete on app_private.performance_snapshots to service_role;

create function app_private.capture_performance_snapshot()
returns boolean language plpgsql set search_path=''
as $function$
declare
  bucket timestamptz := date_bin(interval '4 hours',now(),timestamptz '2000-01-01');
  inserted integer;
begin
  if exists (select 1 from app_private.performance_snapshots where bucket_start=bucket) then
    return false;
  end if;
  insert into app_private.performance_snapshots(bucket_start,captured_at,metrics)
  select bucket,now(),jsonb_build_object(
    'schema_version',1,
    'postmaster_start',pg_postmaster_start_time(),
    'database_bytes',pg_database_size(current_database()),
    'database',(select to_jsonb(d) from pg_stat_database d where datname=current_database()),
    'wal',(select to_jsonb(w) from pg_stat_wal w),
    'tables',(select jsonb_agg(jsonb_build_object(
      'schema',schemaname,'table',relname,
      'bytes',pg_total_relation_size(relid),
      'index_bytes',pg_indexes_size(relid),
      'live_estimate',n_live_tup,'dead_estimate',n_dead_tup,
      'inserts',n_tup_ins,'updates',n_tup_upd,'hot_updates',n_tup_hot_upd,
      'deletes',n_tup_del,'seq_scans',seq_scan,'index_scans',idx_scan
    ) order by schemaname,relname) from pg_stat_user_tables
       where schemaname in ('public','app_private','pgmq','cron')),
    'sources',(select jsonb_agg(jsonb_build_object(
      'id',id,'name',name,'enabled',enabled,'runtime_mode',runtime_mode,
      'since',telemetry_since,'crawls',telemetry_crawls,'errors',telemetry_errors,
      'candidates',telemetry_candidates,'new_rows',telemetry_new_rows,
      'elapsed_ms',telemetry_elapsed_ms,'consecutive_failures',consecutive_failures
    ) order by id) from public.sources)
  ) on conflict (bucket_start) do nothing;
  get diagnostics inserted=row_count;
  delete from app_private.performance_snapshots where captured_at<now()-interval '35 days';
  return inserted=1;
end;
$function$;
revoke all on function app_private.capture_performance_snapshot() from public,anon,authenticated;
grant execute on function app_private.capture_performance_snapshot() to service_role;

do $migration$
declare definition text;
begin
  definition:=pg_get_functiondef('app_private.maintenance_cleanup()'::regprocedure);
  if position('capture_performance_snapshot' in definition)>0
     or position('  return result;' in definition)=0 then
    raise exception 'Unexpected maintenance version; refusing patch';
  end if;
  definition:=replace(definition,'  return result;',
    E'  result := result || jsonb_build_object(''performance_snapshot_created'',app_private.capture_performance_snapshot());\n  return result;');
  execute definition;
end;
$migration$;

comment on table app_private.performance_snapshots is
  'Four-hour cumulative measurements retained for 35 days. Compare deltas only within the same stats-reset epoch. Source elapsed_ms is elapsed crawl time, not billed CPU. No personal payloads or raw SQL texts.';
select app_private.capture_performance_snapshot();