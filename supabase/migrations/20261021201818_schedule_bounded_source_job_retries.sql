do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='source-dead-letter-retry-every-5-minutes' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
  perform cron.schedule('source-dead-letter-retry-every-5-minutes','*/5 * * * *','select app_private.retry_transient_dead_source_jobs(1,false);');
end $$;
