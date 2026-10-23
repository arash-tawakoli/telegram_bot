-- Reduce recurring reads of cron history and prevent cleanup from waiting on active queue rows.
CREATE OR REPLACE FUNCTION app_private.maintenance_cleanup()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
declare
  r record;
  removed integer;
  result jsonb := '{}';
begin
  delete from public.crawl_runs
  where ctid in (
    select ctid
    from public.crawl_runs
    where success=true and finished_at<now()-interval '3 days'
    union all
    select ctid
    from public.crawl_runs
    where success=false and finished_at<now()-interval '30 days'
    limit 5000
  );
  get diagnostics removed = row_count;
  result := jsonb_build_object(
    'crawl_runs_deleted',removed,
    'cron_runs_deleted',0,
    'cron_cleanup_deferred_to_daily_job',true
  );

  for r in
    select * from (values
      ('source_jobs_deleted','public.source_jobs',
        $$((status='done' and finished_at<now()-interval '1 day')
           or (status='dead' and finished_at<now()-interval '7 days'))$$),
      ('queue_archive_deleted','pgmq.a_source_jobs',
        $$archived_at<now()-interval '2 days'$$),
      ('delivery_events_deleted','public.delivery_events',
        $$status in ('sent','skipped') and created_at<now()-interval '90 days'$$),
      ('shadow_runs_deleted','app_private.source_shadow_runs',
        $$checked_at<now()-interval '14 days'$$),
      ('telegram_effects_deleted','app_private.telegram_effects',
        $$update_id in (
          select telegram_update_id
          from public.bot_events
          where created_at<now()-interval '30 days'
            and processing_status='done'
        )$$)
    ) as rules(key,relation,predicate)
  loop
    execute format(
      'delete from %s where ctid in (select ctid from %s where %s limit 5000 for update skip locked)',
      r.relation,r.relation,r.predicate
    );
    get diagnostics removed = row_count;
    result := result || jsonb_build_object(r.key,removed);
  end loop;

  result := result || jsonb_build_object(
    'performance_snapshot_created',
    app_private.capture_performance_snapshot()
  );
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.maintenance_cleanup_cron_history()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
declare
  removed integer;
begin
  delete from cron.job_run_details
  where ctid in (
    select ctid
    from cron.job_run_details
    where (status='succeeded' and end_time<now()-interval '1 day')
       or (status='failed' and end_time<now()-interval '30 days')
    limit 5000
    for update skip locked
  );
  get diagnostics removed = row_count;
  return removed;
end;
$function$;

REVOKE ALL ON FUNCTION app_private.maintenance_cleanup_cron_history() FROM PUBLIC, anon, authenticated;

DO $job$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname='cron-history-retention-daily'
  ) THEN
    PERFORM cron.schedule(
      'cron-history-retention-daily',
      '47 3 * * *',
      'select app_private.maintenance_cleanup_cron_history();'
    );
  END IF;
END;
$job$;
