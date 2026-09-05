alter table public.sources
  add column if not exists crawl_priority integer;

comment on column public.sources.crawl_priority is
  'Source crawl priority from the 2026-08-29 Hamburg 65-source ranking. Lower number = higher scheduling priority.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='sources_crawl_priority_positive'
      and conrelid='public.sources'::regclass
  ) then
    alter table public.sources
      add constraint sources_crawl_priority_positive
      check (crawl_priority is null or crawl_priority > 0);
  end if;
end $$;

update public.sources s
set crawl_priority = v.priority,
    updated_at = now()
from (values
  (1,1),(2,2),(3,3),(6,4),(5,5),(4,6),(7,7),(14,8),(9,9),(21,10),
  (12,11),(8,12),(10,13),(11,14),(15,15),(20,16),(25,17),(63,18),(27,19),(24,20),
  (40,21),(22,22),(38,23),(28,24),(26,25),(29,26),(31,27),(48,28),(65,29),(23,30),
  (33,31),(45,32),(18,33),(13,34),(19,35),(41,36),(61,37),(17,38),(16,39),(55,40),
  (56,41),(32,42),(43,43),(37,44),(39,45),(46,46),(35,47),(30,48),(44,49),(42,50),
  (54,51),(52,52),(60,53),(34,54),(49,55),(51,56),(47,57),(50,58),(53,59),(36,60),
  (62,61),(57,62),(64,63),(58,64),(59,65)
) as v(source_id,priority)
where s.id=v.source_id;

create unique index if not exists sources_crawl_priority_uidx
  on public.sources(crawl_priority)
  where crawl_priority is not null;

create or replace function app_private.enqueue_due_source_jobs(p_limit integer default 3)
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
      coalesce(s.crawl_priority,2147483647),
      coalesce(s.last_checked_at,'-infinity'::timestamptz),
      s.id
    limit greatest(1,least(coalesce(p_limit,3),16))
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
$function$;

create or replace function public.claim_source_jobs(p_worker text, p_qty integer default 3)
returns table(job_id uuid, queue_msg_id bigint, source_id smallint, worker_slug text, attempt integer)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r record;
  v_job uuid;
  v_source smallint;
  v_worker text;
  v_attempt integer;
  v_status text;
  v_limit integer := greatest(1,least(coalesce(p_qty,3),3));
  v_claimed integer := 0;
begin
  for r in
    select j.id as job_id,j.queue_msg_id,j.source_id,j.worker as worker_slug,q.read_ct
    from public.source_jobs j
    join pgmq.q_source_jobs q on q.msg_id=j.queue_msg_id
    where j.status in ('enqueued','retry')
      and j.source_id in (1,2)
      and q.vt <= clock_timestamp()
    order by j.enqueued_at, case when j.source_id=1 then 0 else 1 end
    limit 1
    for update of j,q skip locked
  loop
    perform * from pgmq.set_vt('source_jobs',r.queue_msg_id,120);
    update public.source_jobs j
    set status='processing',attempts=j.attempts+1,
        started_at=coalesce(j.started_at,now()),
        worker=coalesce(r.worker_slug,j.worker),updated_at=now()
    where j.id=r.job_id and j.queue_msg_id=r.queue_msg_id
      and j.status in ('enqueued','retry')
    returning j.attempts into v_attempt;
    if found then
      job_id:=r.job_id;queue_msg_id:=r.queue_msg_id;source_id:=r.source_id;
      worker_slug:=r.worker_slug;attempt:=v_attempt;v_claimed:=v_claimed+1;return next;
    end if;
  end loop;
  if v_claimed>=v_limit then return; end if;
  for r in select * from pgmq.read('source_jobs',120,v_limit-v_claimed,'{}'::jsonb)
  loop
    begin
      v_job := (r.message->>'job_id')::uuid;v_source := (r.message->>'source_id')::smallint;v_worker := r.message->>'worker';
    exception when others then
      perform pgmq.archive('source_jobs',r.msg_id);continue;
    end;
    update public.source_jobs j
    set status='processing',attempts=j.attempts+1,started_at=coalesce(j.started_at,now()),worker=coalesce(v_worker,j.worker),updated_at=now()
    where j.id=v_job and j.queue_msg_id=r.msg_id and j.status in ('enqueued','retry')
    returning j.attempts into v_attempt;
    if found then
      job_id:=v_job;queue_msg_id:=r.msg_id;source_id:=v_source;worker_slug:=v_worker;attempt:=v_attempt;return next;
    else
      select j.status into v_status from public.source_jobs j where j.id=v_job and j.queue_msg_id=r.msg_id;
      if v_status is distinct from 'processing' then perform pgmq.archive('source_jobs',r.msg_id);end if;
    end if;
  end loop;
end;
$function$;

select cron.alter_job(
  job_id := 9,
  command := 'select app_private.enqueue_due_source_jobs(3);'
);
