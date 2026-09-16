select cron.alter_job(
  34,
  schedule => '* * * * *',
  command => $cron$
    select net.http_post(
      url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/application-worker',
      headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
      body:='{"action":"process"}'::jsonb,
      timeout_milliseconds:=55000
    )
    where exists(
      select 1
      from public.applications a
      join public.listings l on l.id=a.listing_id
      where (
        (a.status='pending' and a.next_attempt_at<=now() and (a.lease_until is null or a.lease_until<now()))
        or (a.status='processing' and (a.lease_until is null or a.lease_until<now()))
      )
      and app_private.application_provider_for_listing(l.source_id,l.raw) is distinct from 'immomio'
    );
  $cron$
);
