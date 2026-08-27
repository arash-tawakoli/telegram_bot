-- Restore tier-based polling and stagger source execution to avoid request bursts.
-- Also removes invalid placeholder connectors that parse HTML as JSON and fixes
-- the confirmed KAIFU/BGFG connector targets.

update public.sources
set poll_interval_minutes = case tier
  when 'K1' then 15
  when 'K2' then 30
  when 'K3' then 60
  else poll_interval_minutes
end,
updated_at = now();

-- These generic JSON fallbacks had no JSON endpoint configured and therefore
-- attempted to parse each source's HTML page as JSON on every crawl.
update public.source_connectors
set enabled = false
where (source_id in (23,24,26,27,28,29,32,33,36,39,61,65) and priority = 2)
   or (source_id = 60 and priority in (1,2));

-- KAIFU: target the documented JSON endpoint directly. source-engine target()
-- gives config.url precedence over config.path, so the former url+path config
-- never reached this endpoint.
update public.source_connectors
set config = jsonb_build_object('url','https://kaifu.de/api/property-supply/all')
where source_id = 33 and priority = 1;

-- BGFG: use the Immomio iframe endpoint exposed by the current public
-- "Aktuelle Angebote" page as the primary connector.
update public.source_connectors
set config = jsonb_build_object(
  'url',
  'https://homepage.immomio.com/de/properties?token=eyJhbGciOiJIUzI1NiJ9.eyJjdXN0b21lcklkIjoxNTY2MDQwMzUsImlkIjoxNzA2MDA0NjIsImNyZWF0ZWQiOjE2NDIxNjYwNDY2Mzh9.1QlkdnxWyyJMcRS1JubN1EkDrHPRaqfASe6oUJq7ptU'
)
where source_id = 28 and priority = 1;

update public.source_connectors
set config = jsonb_build_object('url','https://www.bgfg.de/zuhause-finden/aktuelle-angebote')
where source_id = 28 and priority = 3;

-- Replace any previous source-engine scheduler with a due-source scheduler.
-- At the configured tier intervals, four claims per minute provide sufficient
-- capacity while avoiding the previous 64-request burst.
do $$
declare
  j bigint;
begin
  for j in
    select jobid from cron.job
    where jobname in ('source-engine-every-minute','source-engine-every-10-seconds')
  loop
    perform cron.unschedule(j);
  end loop;
end $$;

select cron.schedule(
  'source-engine-every-minute',
  '* * * * *',
  $cron$
    with due as (
      select id
      from public.sources
      where enabled = true
        and (
          last_checked_at is null
          or last_checked_at <= now() - make_interval(mins => poll_interval_minutes)
        )
      order by coalesce(last_checked_at, '-infinity'::timestamptz), id
      limit 4
      for update skip locked
    ), claimed as (
      update public.sources s
      set last_checked_at = now(), updated_at = now()
      from due
      where s.id = due.id
      returning s.id
    )
    select net.http_post(
      url := case
        when claimed.id = 1 then 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-immoscout'
        when claimed.id = 2 then 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-kleinanzeigen'
        when claimed.id = 3 then 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-immowelt'
        else 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-engine'
      end,
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-internal-secret', public.get_bot_secret('internal_worker_secret')
      ),
      body := jsonb_build_object('source_id', claimed.id),
      timeout_milliseconds := 15000
    )
    from claimed;
  $cron$
);
