CREATE OR REPLACE FUNCTION app_private.maintenance_cleanup()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE r record; removed integer; result jsonb := '{}';
BEGIN
  -- Separate outcome ranges so the planner uses both columns of the expiry index.
  DELETE FROM public.crawl_runs WHERE ctid IN (
    SELECT ctid FROM public.crawl_runs WHERE success=true AND finished_at<now()-interval '7 days'
    UNION ALL
    SELECT ctid FROM public.crawl_runs WHERE success=false AND finished_at<now()-interval '30 days'
    LIMIT 5000
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  result := jsonb_build_object('crawl_runs_deleted',removed);
  -- Fixed internal relations/predicates only. Same retention, bounded transactions.
  FOR r IN SELECT * FROM (VALUES
    ('source_jobs_deleted','public.source_jobs', $$finished_at < now()-interval '7 days' AND (status='done' OR (status='dead' AND finished_at<now()-interval '30 days'))$$),
    ('queue_archive_deleted','pgmq.a_source_jobs', $$archived_at<now()-interval '14 days'$$),
    ('delivery_events_deleted','public.delivery_events', $$status IN ('sent','skipped') AND created_at<now()-interval '90 days'$$),
    ('shadow_runs_deleted','app_private.source_shadow_runs', $$checked_at<now()-interval '30 days'$$),
    ('telegram_effects_deleted','app_private.telegram_effects', $$update_id IN (SELECT telegram_update_id FROM public.bot_events WHERE created_at<now()-interval '30 days' AND processing_status='done')$$),
    ('cron_runs_deleted','cron.job_run_details', $$end_time < now()-interval '7 days' AND (status='succeeded' OR (status='failed' AND end_time<now()-interval '30 days'))$$)
  ) AS rules(key,relation,predicate)
  LOOP
    EXECUTE format('DELETE FROM %s WHERE ctid IN (SELECT ctid FROM %s WHERE %s LIMIT 5000)',r.relation,r.relation,r.predicate);
    GET DIAGNOSTICS removed = ROW_COUNT;
    result := result || jsonb_build_object(r.key,removed);
  END LOOP;
  RETURN result;
END;
$function$
