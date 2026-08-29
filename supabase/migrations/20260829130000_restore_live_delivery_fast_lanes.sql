-- Restore the live-offer path after the 2026-08-29 DB/API saturation incident.
-- Fast lanes are intentionally separated from expensive inventory/enrichment work.

create or replace function app_private.prepare_listing_fast_delivery()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  new.enrichment_status := 'done';
  new.enrichment_delivery_eligible := true;
  new.enrichment_error := null;
  return new;
end;
$$;
revoke all on function app_private.prepare_listing_fast_delivery() from public, anon, authenticated;

-- New listings must be matchable immediately. Expensive enrichment is no
-- longer a prerequisite for Telegram delivery.
do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgrelid='public.listings'::regclass
      and tgname='listings_queue_enrichment'
      and not tgisinternal
  ) then
    execute 'alter table public.listings disable trigger listings_queue_enrichment';
  end if;
end $$;

drop trigger if exists listings_prepare_fast_delivery on public.listings;
create trigger listings_prepare_fast_delivery
before insert on public.listings
for each row execute function app_private.prepare_listing_fast_delivery();

-- ImmoScout fast lane queues exact profile deliveries itself. Other sources
-- use the generic matcher once, only on a genuine insert.
drop trigger if exists listings_queue_fast_delivery on public.listings;
create trigger listings_queue_fast_delivery
after insert on public.listings
for each row
when (new.source_id <> 1)
execute function app_private.queue_new_listing_delivery();

-- One primary-source slot per runner cycle, chosen by oldest queued job.
-- Remaining capacity continues FIFO so the other sources cannot starve.
create or replace function public.claim_source_jobs(p_worker text, p_qty integer default 4)
returns table(job_id uuid,queue_msg_id bigint,source_id smallint,worker_slug text,attempt integer)
language plpgsql
security definer
set search_path=''
as $$
declare
  r record;
  v_job uuid;
  v_source smallint;
  v_worker text;
  v_attempt integer;
  v_status text;
  v_limit integer := greatest(1,least(coalesce(p_qty,4),8));
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
      job_id:=r.job_id;
      queue_msg_id:=r.queue_msg_id;
      source_id:=r.source_id;
      worker_slug:=r.worker_slug;
      attempt:=v_attempt;
      v_claimed:=v_claimed+1;
      return next;
    end if;
  end loop;

  if v_claimed>=v_limit then return; end if;

  for r in
    select * from pgmq.read('source_jobs',120,v_limit-v_claimed,'{}'::jsonb)
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
    set status='processing',attempts=j.attempts+1,
        started_at=coalesce(j.started_at,now()),
        worker=coalesce(v_worker,j.worker),updated_at=now()
    where j.id=v_job and j.queue_msg_id=r.msg_id
      and j.status in ('enqueued','retry')
    returning j.attempts into v_attempt;

    if found then
      job_id:=v_job;
      queue_msg_id:=r.msg_id;
      source_id:=v_source;
      worker_slug:=v_worker;
      attempt:=v_attempt;
      return next;
    else
      select j.status into v_status
      from public.source_jobs j
      where j.id=v_job and j.queue_msg_id=r.msg_id;
      if v_status is distinct from 'processing' then
        perform pgmq.archive('source_jobs',r.msg_id);
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function public.claim_source_jobs(text,integer) from public,anon,authenticated;
grant execute on function public.claim_source_jobs(text,integer) to service_role;

-- Primary live lanes.
update public.sources
set worker_slug='source-immoscout-fast', poll_interval_minutes=2,
    consecutive_failures=0, last_error_at=null, updated_at=now()
where id=1;

update public.sources
set worker_slug='source-kleinanzeigen-fast', poll_interval_minutes=5,
    consecutive_failures=0, last_error_at=null, updated_at=now()
where id=2;

-- Dispatcher: one invocation per minute. Keep a generous network timeout but
-- avoid 10/30-second overlapping pressure.
select cron.alter_job(
  job_id:=jobid,
  schedule:='* * * * *',
  command:=$cmd$select net.http_post(
    url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/notification-dispatcher',
    headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
    body:=jsonb_build_object('time',now()),
    timeout_milliseconds:=45000
  );$cmd$,
  active:=true
)
from cron.job where jobname='notification-dispatcher-every-minute';

-- Enqueue every minute, but run a bounded batch every two minutes.
select cron.alter_job(job_id:=jobid,schedule:='* * * * *',active:=true)
from cron.job where jobname='source-engine-every-minute';

select cron.alter_job(
  job_id:=jobid,
  schedule:='*/2 * * * *',
  command:=$cmd$select net.http_post(
    url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-job-runner',
    headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
    body:='{}'::jsonb,
    timeout_milliseconds:=110000
  );$cmd$,
  active:=true
)
from cron.job where jobname='source-job-runner-every-10-seconds';

-- Not on the live delivery path. Keep their data intact, only stop recurring
-- execution until they are redesigned with explicit backpressure.
select cron.alter_job(job_id:=jobid,active:=false)
from cron.job
where jobname in (
  'listing-enricher-every-10-seconds',
  'listing-enrichment-backfill-every-minute',
  'immoscout-inventory-continuation'
);
