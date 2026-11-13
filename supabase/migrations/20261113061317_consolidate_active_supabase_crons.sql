-- Preserve the current task cadences in one transition cron while legacy data stays live.
DO $migration$
DECLARE
  v_job_id bigint;
  v_command text := $command$
DO $orchestrator$
DECLARE
  v_now timestamptz := now();
  v_minute integer := extract(minute FROM now())::integer;
  v_hour integer := extract(hour FROM now())::integer;
BEGIN
  BEGIN
    PERFORM app_private.enqueue_due_source_jobs(1);
    IF EXISTS (SELECT 1 FROM pgmq.q_source_jobs WHERE vt <= v_now) THEN
      PERFORM net.http_post(
        url := 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-worker',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-internal-secret', public.get_bot_secret('internal_worker_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'source_schedule_failed sqlstate=%', SQLSTATE;
  END;

  BEGIN
    IF EXISTS (
      SELECT 1 FROM public.applications a
      WHERE (a.status='pending' AND a.next_attempt_at<=v_now
             AND (a.lease_until IS NULL OR a.lease_until<v_now))
         OR (a.status='processing'
             AND (a.lease_until IS NULL OR a.lease_until<v_now))
    ) THEN
      PERFORM app_private.dispatch_due_application_workers();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'application_dispatch_failed sqlstate=%', SQLSTATE;
  END;

  IF mod(v_minute,5)=0 THEN
    BEGIN
      IF EXISTS (
        SELECT 1 FROM public.delivery_events
        WHERE status IN ('pending','failed')
          AND delivery_outcome_unknown=false
          AND dispatch_attempts<5
          AND (next_retry_at IS NULL OR next_retry_at<=v_now)
      ) THEN
        PERFORM app_private.prepare_current_delivery_queue();
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.delivery_events
        WHERE (status IN ('pending','failed')
               AND delivery_outcome_unknown=false
               AND dispatch_attempts<5
               AND (next_retry_at IS NULL OR next_retry_at<=v_now))
           OR (status='processing' AND last_attempt_at<v_now-interval '10 minutes')
      ) THEN
        PERFORM net.http_post(
          url := 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/notification-dispatcher',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-internal-secret', public.get_bot_secret('internal_worker_secret')
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 145000
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notification_dispatch_failed sqlstate=%', SQLSTATE;
    END;

    BEGIN
      PERFORM app_private.retry_transient_dead_source_jobs(1,false);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'source_dead_letter_retry_failed sqlstate=%', SQLSTATE;
    END;
  END IF;

  IF mod(v_minute,10)=0 THEN
    BEGIN
      IF EXISTS (
        SELECT 1 FROM public.platform_reauth_notifications n
        WHERE n.status='pending' AND n.available_at<=v_now
      ) OR EXISTS (
        SELECT 1 FROM public.platform_connections c
        JOIN public.bot_users u ON u.id=c.user_id
        WHERE c.status='connected' AND u.is_active AND u.auto_apply_enabled
      ) THEN
        PERFORM net.http_post(
          url := 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/platform-session-reminder',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-internal-secret', public.get_bot_secret('internal_worker_secret')
          ),
          body := '{"action":"run"}'::jsonb,
          timeout_milliseconds := 55000
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'platform_session_reminder_failed sqlstate=%', SQLSTATE;
    END;
  END IF;

  IF v_minute=17 AND mod(v_hour,4)=0 THEN
    BEGIN
      PERFORM app_private.maintenance_cleanup();
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'backend_maintenance_failed sqlstate=%', SQLSTATE;
    END;
    BEGIN
      PERFORM app_private.maintenance_cleanup_cron_history();
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'cron_history_retention_failed sqlstate=%', SQLSTATE;
    END;
  END IF;
END
$orchestrator$;
$command$;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname='housing-runtime-orchestrator-every-minute'
  LIMIT 1;

  IF v_job_id IS NULL THEN
    PERFORM cron.schedule('housing-runtime-orchestrator-every-minute','* * * * *',v_command);
  ELSE
    PERFORM cron.alter_job(
      job_id := v_job_id,
      schedule := '* * * * *',
      command := v_command,
      active := true
    );
  END IF;

  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'notification-dispatcher-every-minute',
      'source-scheduler-every-minute',
      'backend-maintenance-hourly',
      'platform-applications',
      'platform-session-reminder',
      'source-dead-letter-retry-every-5-minutes'
    )
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
END
$migration$;
