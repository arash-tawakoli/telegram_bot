-- Minimal production fixes for orphaned source jobs and false-live monitor sources.

update public.source_jobs
set status = 'dead',
    error_message = coalesce(nullif(error_message, ''), 'orphaned active job without queue message'),
    finished_at = coalesce(finished_at, now()),
    updated_at = now()
where status in ('enqueued', 'processing', 'retry')
  and queue_msg_id is null;

create or replace function app_private.enqueue_due_source_jobs(p_limit integer default 65)
returns integer
language plpgsql
set search_path to ''
as $function$
declare
  r record;
  v_msg_id bigint;
  v_job_id uuid;
  v_count integer := 0;
begin
  for r in
    select s.id
    from public.sources s
    where s.enabled = true
      and s.runtime_mode = 'live'
      and s.delivery_mode = 'live'
      and not exists (
        select 1
        from public.source_jobs j
        where j.source_id = s.id
          and j.status in ('enqueued', 'processing', 'retry')
          and j.queue_msg_id is not null
      )
      and (
        s.last_checked_at is null
        or s.last_checked_at <= now() - make_interval(mins => case
          when coalesce(s.consecutive_failures, 0) >= 5 then greatest(s.poll_interval_minutes, 60)
          when coalesce(s.consecutive_failures, 0) >= 3 then greatest(s.poll_interval_minutes, 30)
          when coalesce(s.consecutive_failures, 0) >= 1 then greatest(s.poll_interval_minutes, 10)
          else s.poll_interval_minutes
        end)
      )
    order by coalesce(s.crawl_priority, 2147483647),
             coalesce(s.last_checked_at, '-infinity'::timestamptz),
             s.id
    limit greatest(1, least(coalesce(p_limit, 65), 65))
    for update skip locked
  loop
    v_job_id := gen_random_uuid();

    select x into v_msg_id
    from pgmq.send(
      'source_jobs',
      jsonb_build_object('job_id', v_job_id, 'source_id', r.id, 'worker', 'source-worker')
    ) as x
    limit 1;

    insert into public.source_jobs(
      id, queue_msg_id, source_id, status, worker, enqueued_at, updated_at
    ) values (
      v_job_id, v_msg_id, r.id, 'enqueued', 'source-worker', now(), now()
    );

    update public.sources
    set last_checked_at = now(), updated_at = now()
    where id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

update public.sources
set enabled = false,
    runtime_mode = 'shadow',
    delivery_mode = 'shadow',
    updated_at = now()
where id in (14, 31);
