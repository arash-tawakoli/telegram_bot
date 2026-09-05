select cron.unschedule('source-worker-every-minute');
select cron.schedule(
  'source-worker-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-worker',
    headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
    body:='{}'::jsonb,
    timeout_milliseconds:=55000
  );
  $$
);
