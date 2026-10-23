-- Reduce background crawl scheduling pressure while preserving Telegram delivery and application workers.
-- The source queue is still processed normally; only crawl enqueue bursts and wake-ups are throttled.
DO $migration$
DECLARE
  v_job_id bigint;
  v_command text;
BEGIN
  SELECT jobid, command
    INTO v_job_id, v_command
  FROM cron.job
  WHERE jobname = 'source-scheduler-every-minute'
  ORDER BY jobid
  LIMIT 1;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'Expected source scheduler cron job was not found';
  END IF;

  IF position('enqueue_due_source_jobs(12)' IN v_command) > 0 THEN
    v_command := replace(v_command, 'enqueue_due_source_jobs(12)', 'enqueue_due_source_jobs(3)');
  ELSIF position('enqueue_due_source_jobs(3)' IN v_command) = 0 THEN
    RAISE EXCEPTION 'Unexpected source scheduler command; refusing to overwrite it';
  END IF;

  PERFORM cron.alter_job(
    v_job_id,
    schedule := '*/2 * * * *',
    command := v_command,
    active := true
  );
END
$migration$;
