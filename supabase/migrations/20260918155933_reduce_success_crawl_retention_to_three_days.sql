
create or replace function app_private.maintenance_cleanup()
returns jsonb
language plpgsql
set search_path to ''
as $function$
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
  result := jsonb_build_object('crawl_runs_deleted',removed);

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
       $$checked_at<now()-interval '30 days'$$),
      ('telegram_effects_deleted','app_private.telegram_effects',
       $$update_id in (
         select telegram_update_id
         from public.bot_events
         where created_at<now()-interval '30 days'
           and processing_status='done'
       )$$),
      ('cron_runs_deleted','cron.job_run_details',
       $$((status='succeeded' and end_time<now()-interval '3 days')
          or (status='failed' and end_time<now()-interval '30 days'))$$)
    ) as rules(key,relation,predicate)
  loop
    execute format(
      'delete from %s where ctid in (select ctid from %s where %s limit 5000)',
      r.relation,r.relation,r.predicate
    );
    get diagnostics removed = row_count;
    result := result || jsonb_build_object(r.key,removed);
  end loop;

  return result;
end;
$function$;
