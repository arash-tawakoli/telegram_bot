select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'source-engine-every-minute'),
  command := $cron$
    with due as (
      select id
      from public.sources
      where enabled = true
        and (last_checked_at is null or last_checked_at <= now() - make_interval(mins => poll_interval_minutes))
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
