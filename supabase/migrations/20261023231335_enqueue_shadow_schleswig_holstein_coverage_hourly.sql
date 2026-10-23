-- Keep the SH source's initial baseline progressing hourly in shadow mode.
-- Delivery stays shadow until the complete adaptive coverage cycle is explicitly promoted.
CREATE OR REPLACE FUNCTION app_private.enqueue_due_source_jobs(p_limit integer DEFAULT 65)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
      and (
        s.delivery_mode = 'live'
        or (
          s.id = 69
          and s.delivery_mode = 'shadow'
          and exists (
            select 1 from public.source_coverage_state coverage
            where coverage.source_id = s.id
          )
        )
      )
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
            greatest(1, s.poll_interval_minutes) *
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
