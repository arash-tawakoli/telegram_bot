-- Queue infrastructure only; connector definitions and existing workers are unchanged.
select pgmq.create('source_jobs') where not exists (select 1 from pgmq.meta where queue_name='source_jobs');

alter table public.sources add column if not exists worker_slug text;
update public.sources set worker_slug = case
  when id=1 then 'source-immoscout'
  when id=2 then 'source-kleinanzeigen'
  when id=3 then 'source-immowelt'
  when id in (23,28,29,30,32,34,36,39,65) then 'source-immomio'
  else 'source-engine'
end
where worker_slug is distinct from case
  when id=1 then 'source-immoscout'
  when id=2 then 'source-kleinanzeigen'
  when id=3 then 'source-immowelt'
  when id in (23,28,29,30,32,34,36,39,65) then 'source-immomio'
  else 'source-engine'
end;

create index if not exists sources_worker_slug_idx on public.sources(worker_slug) where enabled=true;

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
    select msg_id into v_msg_id
    from pgmq.send('source_jobs',jsonb_build_object('job_id',v_job_id,'source_id',r.id,'worker',r.worker_slug));
    insert into public.source_jobs(id,queue_msg_id,source_id,status,worker,enqueued_at,updated_at)
    values(v_job_id,v_msg_id,r.id,'enqueued',r.worker_slug,now(),now());
    update public.sources set last_checked_at=now(),updated_at=now() where id=r.id;
    v_count := v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.claim_source_jobs(p_worker text, p_qty integer default 4)
returns table(job_id uuid,queue_msg_id bigint,source_id smallint,worker_slug text,attempt integer)
language plpgsql
security definer
set search_path=''
as $$
declare r record; v_job uuid; v_source smallint; v_worker text;
begin
  for r in
    select * from pgmq.read('source_jobs',120,greatest(1,least(coalesce(p_qty,4),8)),'{}'::jsonb)
  loop
    begin
      v_job := (r.message->>'job_id')::uuid;
      v_source := (r.message->>'source_id')::smallint;
      v_worker := r.message->>'worker';
    exception when others then
      perform pgmq.archive('source_jobs',r.msg_id);
      continue;
    end;

    update public.source_jobs j
    set status='processing',attempts=j.attempts+1,started_at=coalesce(j.started_at,now()),worker=coalesce(v_worker,j.worker),updated_at=now()
    where j.id=v_job and j.queue_msg_id=r.msg_id
    returning j.attempts into attempt;

    if found then
      job_id:=v_job; queue_msg_id:=r.msg_id; source_id:=v_source; worker_slug:=v_worker;
      return next;
    else
      perform pgmq.archive('source_jobs',r.msg_id);
    end if;
  end loop;
end;
$$;

create or replace function public.finish_source_job(p_job_id uuid,p_success boolean,p_error text default null)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare j public.source_jobs%rowtype; v_delay integer;
begin
  select * into j from public.source_jobs where id=p_job_id for update;
  if not found then return false; end if;

  if p_success then
    perform pgmq.archive('source_jobs',j.queue_msg_id);
    update public.source_jobs set status='done',error_message=null,finished_at=now(),updated_at=now() where id=p_job_id;
    return true;
  end if;

  if j.attempts>=5 then
    perform pgmq.archive('source_jobs',j.queue_msg_id);
    update public.source_jobs set status='dead',error_message=left(coalesce(p_error,'worker failed'),1500),finished_at=now(),updated_at=now() where id=p_job_id;
    return false;
  end if;

  v_delay:=case when j.attempts<=1 then 60 when j.attempts=2 then 300 else 900 end;
  perform * from pgmq.set_vt('source_jobs',j.queue_msg_id,v_delay);
  update public.source_jobs set status='retry',error_message=left(coalesce(p_error,'worker failed'),1500),updated_at=now() where id=p_job_id;
  return false;
end;
$$;

revoke all on function public.claim_source_jobs(text,integer) from public,anon,authenticated;
revoke all on function public.finish_source_job(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_source_jobs(text,integer) to service_role;
grant execute on function public.finish_source_job(uuid,boolean,text) to service_role;

-- Keep the existing job name for operational continuity, but its responsibility is now enqueue-only.
select cron.unschedule('source-engine-every-minute') where exists (select 1 from cron.job where jobname='source-engine-every-minute');
select cron.schedule('source-engine-every-minute','* * * * *',$$select app_private.enqueue_due_source_jobs(4);$$);

-- Remove stale active job rows left by interrupted orchestration; queue messages, if any, are archived first.
update public.source_jobs set status='dead',finished_at=now(),updated_at=now(),error_message=coalesce(error_message,'superseded during queue migration')
where status in ('enqueued','processing','retry') and enqueued_at < now()-interval '2 hours';
