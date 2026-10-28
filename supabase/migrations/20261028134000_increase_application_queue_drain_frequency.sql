-- Drain application queues once per minute. Each worker claims one application
-- with a lease, and SQL-side send gates enforce per-user timing and daily limits.
DO $$
DECLARE v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname='platform-applications' LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.alter_job(v_job_id,schedule := '* * * * *');
  END IF;
END $$;
