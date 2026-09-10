-- Preserve minute-level readiness/recovery checks and five-minute source eligibility.
-- pg_net starts requests after the SQL transaction commits.
SELECT cron.schedule('source-scheduler-every-minute','* * * * *',$cron$
select app_private.enqueue_due_source_jobs(65);
select net.http_post(
    url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-worker',
    headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
    body:='{}'::jsonb,
    timeout_milliseconds:=55000
  )
where exists (select 1 from pgmq.q_source_jobs where vt <= now());
$cron$);
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='source-worker-every-minute';
SELECT cron.schedule('notification-dispatcher-every-minute','* * * * *',$cron$
select app_private.prepare_current_delivery_queue();select net.http_post(url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/notification-dispatcher',headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),body:='{}'::jsonb,timeout_milliseconds:=145000)
where exists (
  select 1 from public.delivery_events
  where (status in ('pending','failed') and delivery_outcome_unknown=false
         and dispatch_attempts<5 and (next_retry_at is null or next_retry_at<=now()))
     or (status='processing' and last_attempt_at<now()-interval '10 minutes')
);
$cron$);
-- Diagnostics only: source-shadow does not ingest listings or send notifications.
SELECT cron.schedule('source-shadow-probes','12 * * * *',$cron$
select net.http_post(url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-shadow',headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),body:='{}'::jsonb,timeout_milliseconds:=55000);
$cron$);
-- Bound operational log growth; preserve failures longer. Business records untouched.
SELECT cron.schedule('architecture-maintenance-daily','17 4 * * *',$cron$
select app_private.maintenance_cleanup();
delete from cron.job_run_details where runid in (
 select runid from cron.job_run_details
 where (status='succeeded' and end_time<now()-interval '7 days')
    or (status='failed' and end_time<now()-interval '30 days')
 order by runid limit 20000
);
$cron$);
