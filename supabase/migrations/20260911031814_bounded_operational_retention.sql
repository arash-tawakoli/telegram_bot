SET lock_timeout = '2s';
SET statement_timeout = '30s';
CREATE INDEX crawl_runs_retention_brin ON public.crawl_runs USING brin (finished_at) WITH (pages_per_range=32, autosummarize=on);
CREATE INDEX source_jobs_retention_brin ON public.source_jobs USING brin (finished_at) WITH (pages_per_range=32, autosummarize=on);
CREATE INDEX source_shadow_retention_brin ON app_private.source_shadow_runs USING brin (checked_at) WITH (pages_per_range=32, autosummarize=on);

CREATE OR REPLACE FUNCTION app_private.maintenance_cleanup()
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $function$
DECLARE r record; removed integer; result jsonb := '{}';
BEGIN
  -- Fixed internal relations/predicates only. Same retention, bounded transactions.
  FOR r IN SELECT * FROM (VALUES
    ('source_jobs_deleted','public.source_jobs', $$finished_at < now()-interval '7 days' AND (status='done' OR (status='dead' AND finished_at<now()-interval '30 days'))$$),
    ('queue_archive_deleted','pgmq.a_source_jobs', $$archived_at<now()-interval '14 days'$$),
    ('crawl_runs_deleted','public.crawl_runs', $$finished_at < now()-interval '7 days' AND (success=true OR (success=false AND finished_at<now()-interval '30 days'))$$),
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
$function$;

-- The successful payload is only job_id/source_id/worker, already in source_jobs.
-- Keep unsuccessful payloads for diagnosis; completion remains attempt-fenced.
CREATE OR REPLACE FUNCTION public.finish_source_job(p_job_id uuid,p_success boolean,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE j public.source_jobs%rowtype;
BEGIN
  SELECT * INTO j FROM public.source_jobs WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_success THEN
    PERFORM pgmq.delete('source_jobs',j.queue_msg_id);
    UPDATE public.source_jobs SET status='done',error_message=null,finished_at=now(),updated_at=now() WHERE id=p_job_id;
    RETURN true;
  END IF;
  PERFORM pgmq.archive('source_jobs',j.queue_msg_id);
  UPDATE public.source_jobs SET status='dead',error_message=left(coalesce(p_error,'worker failed'),1500),finished_at=now(),updated_at=now() WHERE id=p_job_id;
  RETURN false;
END;
$function$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('architecture-maintenance-daily','shadow-history-cleanup');
SELECT cron.schedule('backend-maintenance-hourly','17 * * * *','select app_private.maintenance_cleanup();');
RESET lock_timeout;
RESET statement_timeout;
