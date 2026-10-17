DO $migration$
DECLARE
  r record;
  v_command text;
BEGIN
  FOR r IN
    SELECT jobid, command
    FROM cron.job
    WHERE command ILIKE '%saga_recovery_probe_candidate_exists%'
  LOOP
    v_command := r.command;
    IF position('extract(minute from now())::int % 5 = 0 and app_private.saga_recovery_probe_candidate_exists()' IN v_command) = 0 THEN
      v_command := replace(
        v_command,
        'or app_private.saga_recovery_probe_candidate_exists();',
        'or (extract(minute from now())::int % 5 = 0 and app_private.saga_recovery_probe_candidate_exists());'
      );
      PERFORM cron.alter_job(r.jobid, command := v_command);
    END IF;
  END LOOP;
END
$migration$;