create index if not exists listings_quiet_source_last_new_idx
on public.listings (source_id, first_seen_at desc)
where source_id in (13,20,46,50);

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
    left join lateral (
      select l.first_seen_at as last_new_at
      from public.listings l
      where s.id in (13,20,46,50)
        and l.source_id = s.id
      order by l.first_seen_at desc
      limit 1
    ) activity on true
    where s.enabled = true
      and s.runtime_mode = 'live'
      and s.delivery_mode = 'live'
      and not exists (
        select 1
        from public.source_jobs j
        where j.source_id = s.id
          and j.status in ('enqueued','processing','retry')
          and j.queue_msg_id is not null
      )
      and (
        s.last_checked_at is null
        or s.last_checked_at <= now() - make_interval(
          mins => least(
            60,
            (
              case
                when s.id in (13,20,46,50)
                     and activity.last_new_at is null
                  then greatest(30, greatest(1, s.poll_interval_minutes))
                when s.id in (13,20,46,50)
                     and activity.last_new_at <= now() - interval '7 days'
                  then greatest(30, greatest(1, s.poll_interval_minutes))
                when s.id in (13,20,46,50)
                     and activity.last_new_at <= now() - interval '72 hours'
                  then greatest(15, greatest(1, s.poll_interval_minutes))
                else greatest(1, s.poll_interval_minutes)
              end
            ) *
            case
              when coalesce(s.consecutive_failures,0) <= 1 then 1
              when s.consecutive_failures = 2 then 2
              when s.consecutive_failures = 3 then 4
              when s.consecutive_failures = 4 then 8
              else 12
            end
          )
        )
      )
    order by
      coalesce(s.crawl_priority,2147483647),
      coalesce(s.last_checked_at,'-infinity'::timestamptz),
      s.id
    limit greatest(1,least(coalesce(p_limit,65),65))
    for update of s skip locked
  loop
    v_job_id := gen_random_uuid();

    select x into v_msg_id
    from pgmq.send(
      'source_jobs',
      jsonb_build_object(
        'job_id',v_job_id,
        'source_id',r.id,
        'worker','source-worker'
      )
    ) as x
    limit 1;

    insert into public.source_jobs(
      id,queue_msg_id,source_id,status,worker,enqueued_at,updated_at
    )
    values(
      v_job_id,v_msg_id,r.id,'enqueued','source-worker',now(),now()
    );

    update public.sources
    set last_checked_at=now(),updated_at=now()
    where id=r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;
