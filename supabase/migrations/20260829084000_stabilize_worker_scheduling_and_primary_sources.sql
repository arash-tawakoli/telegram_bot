-- Stabilize the worker scheduler after the 2026-08-29 database/API saturation incident.
-- The temporary production recovery pause is intentionally NOT persisted here.

-- Once the running PostgREST version supports db-timezone-enabled, avoid
-- enumerating timezone files during schema-cache startup. The bot does not use
-- the Prefer: timezone API feature.
alter role authenticator set pgrst.db_timezone_enabled = 'false';

-- Preserve source queue semantics while giving the two primary Hamburg
-- inventory sources priority when multiple sources are due at the same time.
create or replace function app_private.enqueue_due_source_jobs(p_limit integer default 4)
returns integer
language plpgsql
set search_path=''
as $$
declare
  r record;
  v_msg_id bigint;
  v_job_id uuid;
  v_count integer := 0;
begin
  for r in
    select s.id,s.worker_slug
    from public.sources s
    where s.enabled=true
      and s.worker_slug is not null
      and not exists (
        select 1 from public.source_jobs j
        where j.source_id=s.id and j.status in ('enqueued','processing','retry')
      )
      and (
        s.last_checked_at is null
        or s.last_checked_at <= now()-make_interval(mins=>case
          when coalesce(s.consecutive_failures,0)>=5 then greatest(s.poll_interval_minutes,60)
          when coalesce(s.consecutive_failures,0)>=3 then greatest(s.poll_interval_minutes,45)
          when coalesce(s.consecutive_failures,0)>=1 then greatest(s.poll_interval_minutes,30)
          else s.poll_interval_minutes end)
      )
    order by
      case when s.id=1 then 0 when s.id=2 then 1 else 2 end,
      coalesce(s.last_checked_at,'-infinity'::timestamptz),
      s.id
    limit greatest(1,least(coalesce(p_limit,4),16))
    for update skip locked
  loop
    v_job_id := gen_random_uuid();
    select x into v_msg_id
    from pgmq.send(
      'source_jobs',
      jsonb_build_object('job_id',v_job_id,'source_id',r.id,'worker',r.worker_slug)
    ) as x
    limit 1;

    insert into public.source_jobs(
      id,queue_msg_id,source_id,status,worker,enqueued_at,updated_at
    ) values (
      v_job_id,v_msg_id,r.id,'enqueued',r.worker_slug,now(),now()
    );

    update public.sources
    set last_checked_at=now(),updated_at=now()
    where id=r.id;

    v_count := v_count+1;
  end loop;

  return v_count;
end;
$$;

-- Reduce asynchronous Edge Function pressure. Do not change active/inactive
-- state here: production may intentionally be in recovery mode while this
-- migration is recorded.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname='notification-dispatcher-every-minute'),
  schedule := '30 seconds'
);

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname='source-job-runner-every-10-seconds'),
  schedule := '* * * * *'
);

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname='listing-enricher-every-10-seconds'),
  schedule := '30 seconds',
  command := $$select net.http_post(
      url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/listing-enricher',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'x-internal-secret',public.get_bot_secret('internal_worker_secret')
      ),
      body:='{"qty":3}'::jsonb,
      timeout_milliseconds:=15000
    ) as request_id;$$
);

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname='listing-enrichment-backfill-every-minute'),
  schedule := '*/5 * * * *',
  command := 'select app_private.enqueue_stale_listing_enrichment(10);'
);

notify pgrst, 'reload config';
