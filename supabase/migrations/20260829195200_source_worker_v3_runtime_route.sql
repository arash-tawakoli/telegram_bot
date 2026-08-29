-- Route the architecture-v3 source worker schedule to the clean deployment slug.
select cron.unschedule(jobid) from cron.job where jobname='source-worker-every-minute';
select cron.schedule('source-worker-every-minute','* * * * *',$cron$
select net.http_post(
  url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-worker-v3',
  headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
  body:='{}'::jsonb,
  timeout_milliseconds:=55000
);$cron$);
