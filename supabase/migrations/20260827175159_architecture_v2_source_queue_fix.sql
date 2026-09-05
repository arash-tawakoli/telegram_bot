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
    order by coalesce(s.last_checked_at,'-infinity'::timestamptz),s.id
    limit greatest(1,least(coalesce(p_limit,4),16))
    for update skip locked
  loop
    v_job_id := gen_random_uuid();
    select x into v_msg_id
    from pgmq.send('source_jobs',jsonb_build_object('job_id',v_job_id,'source_id',r.id,'worker',r.worker_slug)) as x
    limit 1;
    insert into public.source_jobs(id,queue_msg_id,source_id,status,worker,enqueued_at,updated_at)
    values(v_job_id,v_msg_id,r.id,'enqueued',r.worker_slug,now(),now());
    update public.sources set last_checked_at=now(),updated_at=now() where id=r.id;
    v_count := v_count+1;
  end loop;
  return v_count;
end;
$$;
