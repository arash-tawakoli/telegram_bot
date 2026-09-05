select cron.unschedule('source-engine-every-minute');

select cron.schedule(
  'source-engine-every-minute',
  '* * * * *',
  $$
    with due as (
      select id
      from public.sources
      where enabled = true
        and (
          last_checked_at is null
          or last_checked_at <= now() - make_interval(
            mins => case
              when coalesce(consecutive_failures,0) >= 5 then greatest(poll_interval_minutes,60)
              when coalesce(consecutive_failures,0) >= 3 then greatest(poll_interval_minutes,45)
              when coalesce(consecutive_failures,0) >= 1 then greatest(poll_interval_minutes,30)
              else poll_interval_minutes
            end
          )
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
  $$
);

create or replace view app_private.source_health as
select
  s.id,
  s.name,
  s.source_type,
  s.tier,
  s.enabled,
  s.poll_interval_minutes,
  case
    when coalesce(s.consecutive_failures,0) >= 5 then greatest(s.poll_interval_minutes,60)
    when coalesce(s.consecutive_failures,0) >= 3 then greatest(s.poll_interval_minutes,45)
    when coalesce(s.consecutive_failures,0) >= 1 then greatest(s.poll_interval_minutes,30)
    else s.poll_interval_minutes
  end as effective_poll_interval_minutes,
  s.last_checked_at,
  s.last_success_at,
  s.last_error_at,
  s.consecutive_failures,
  cr.success as last_run_success,
  cr.fetched_count as last_fetched_count,
  cr.inserted_count as last_inserted_count,
  cr.error_message as last_run_error,
  case
    when not s.enabled then 'disabled'
    when s.last_checked_at is null then 'never_checked'
    when coalesce(s.consecutive_failures,0) >= 5 then 'hard_failed'
    when coalesce(s.consecutive_failures,0) > 0 then 'degraded'
    when cr.success is true and coalesce(cr.fetched_count,0) = 0 then 'reachable_empty'
    when cr.success is true then 'healthy'
    else 'unknown'
  end as health_status
from public.sources s
left join lateral (
  select r.success,r.fetched_count,r.inserted_count,r.error_message
  from public.crawl_runs r
  where r.source_id=s.id
  order by r.started_at desc
  limit 1
) cr on true;
