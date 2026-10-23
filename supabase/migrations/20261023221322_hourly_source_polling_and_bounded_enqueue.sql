-- Poll every live source at most once per hour while keeping the scheduler wake-up frequent enough to drain the queue.
UPDATE public.sources
SET poll_interval_minutes = 60,
    updated_at = now()
WHERE runtime_mode = 'live'
  AND delivery_mode = 'live'
  AND poll_interval_minutes <> 60;

DO $cron$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'source-scheduler-every-minute'
  ORDER BY jobid
  LIMIT 1;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'Required cron job not found: source-scheduler-every-minute';
  END IF;

  PERFORM cron.alter_job(
    v_job_id,
    schedule := '*/5 * * * *',
    command := $command$
      select app_private.enqueue_due_source_jobs(5);
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
    $command$
  );
END;
$cron$;
