-- Reliability fixes for provider application state and source polling.
-- The application-worker code is updated alongside this migration.
CREATE OR REPLACE FUNCTION app_private.enqueue_due_source_jobs(p_limit integer DEFAULT 65)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  r record;
  v_msg_id bigint;
  v_job_id uuid;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT s.id
    FROM public.sources s
    WHERE s.enabled = true
      AND s.runtime_mode = 'live'
      AND (
        s.delivery_mode = 'live'
        OR (
          s.delivery_mode = 'shadow'
          AND (
            (s.id = 69 AND EXISTS (
              SELECT 1 FROM public.source_coverage_state coverage
              WHERE coverage.source_id = s.id
            ))
            OR (
              s.coverage_strategy = 'category_streams_only'
              AND EXISTS (
                SELECT 1 FROM app_private.source_category_streams streams
                WHERE streams.source_id = s.id
                  AND streams.enabled = true
                  AND streams.verified_at IS NOT NULL
              )
            )
          )
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.source_jobs j
        WHERE j.source_id = s.id
          AND j.status IN ('enqueued','processing','retry')
          AND j.queue_msg_id IS NOT NULL
      )
      AND (
        s.last_checked_at IS NULL
        OR s.last_checked_at <= now() - make_interval(
          mins => least(60,greatest(1,s.poll_interval_minutes) *
            CASE
              WHEN coalesce(s.consecutive_failures,0) <= 1 THEN 1
              WHEN s.consecutive_failures = 2 THEN 2
              WHEN s.consecutive_failures = 3 THEN 4
              WHEN s.consecutive_failures = 4 THEN 8
              ELSE 12
            END)
        ) + CASE
          WHEN s.id IN (69,70,71,73) AND s.coverage_status <> 'complete' THEN interval '15 seconds'
          ELSE interval '0 seconds'
        END
      )
    ORDER BY
      CASE WHEN s.id IN (69,70,71,73) THEN 0 ELSE 2 END,
      coalesce(s.crawl_priority,2147483647),
      coalesce(s.last_checked_at,'-infinity'::timestamptz),
      s.id
    LIMIT greatest(1,least(coalesce(p_limit,65),65))
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    v_job_id := gen_random_uuid();
    SELECT x INTO v_msg_id
    FROM pgmq.send('source_jobs',jsonb_build_object(
      'job_id',v_job_id,'source_id',r.id,'worker','source-worker'
    )) AS x LIMIT 1;

    INSERT INTO public.source_jobs(
      id,queue_msg_id,source_id,status,worker,enqueued_at,updated_at
    ) VALUES(v_job_id,v_msg_id,r.id,'enqueued','source-worker',now(),now());

    UPDATE public.sources SET last_checked_at=now(),updated_at=now() WHERE id=r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

DO $$
DECLARE v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname='source-scheduler-every-minute' LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.alter_job(
      v_job_id,
      schedule := '* * * * *',
      command := $cmd$
        select app_private.enqueue_due_source_jobs(1);
        select net.http_post(
          url := 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-worker',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-internal-secret', public.get_bot_secret('internal_worker_secret')
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 55000
        )
        where exists (select 1 from pgmq.q_source_jobs where vt <= now());
      $cmd$
    );
  END IF;
END $$;
