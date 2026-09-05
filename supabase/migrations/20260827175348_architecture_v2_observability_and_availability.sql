-- Keep exactly one active search profile per user without deleting historical profiles.
with ranked as (
  select id,row_number() over(partition by user_id order by updated_at desc,created_at desc,id) rn
  from public.search_profiles where is_active=true
)
update public.search_profiles p set is_active=false,updated_at=now()
from ranked r where p.id=r.id and r.rn>1;
create unique index if not exists search_profiles_one_active_per_user_uidx
on public.search_profiles(user_id) where is_active=true;

-- Availability is only inferred from successful full/enumerable crawls, and only after this migration.
alter table public.crawl_runs add column if not exists availability_processed_at timestamptz;
update public.crawl_runs set availability_processed_at=now() where availability_processed_at is null;

create or replace function app_private.refresh_canonical_listing(p_canonical uuid)
returns void
language plpgsql
set search_path=''
as $$
declare v_occ uuid;
begin
  select o.id into v_occ
  from public.listing_occurrences o
  where o.canonical_listing_id=p_canonical and o.is_active=true
  order by o.quality_rank,o.last_seen_at desc,o.id limit 1;

  if v_occ is null then
    update public.canonical_listings set preferred_occurrence_id=null,is_active=false,updated_at=now() where id=p_canonical;
    return;
  end if;

  update public.canonical_listings c
  set preferred_occurrence_id=v_occ,title=l.title,address=l.address,district=l.district,postal_code=l.postal_code,city=l.city,
      warm_rent=l.warm_rent,cold_rent=l.cold_rent,rooms=l.rooms,area_sqm=l.area_sqm,available_from=l.available_from,
      property_type=l.property_type,furnished=l.furnished,wbs_required=l.wbs_required,image_url=l.image_url,
      last_seen_at=l.last_seen_at,is_active=true,updated_at=now()
  from public.listing_occurrences o join public.listings l on l.id=o.legacy_listing_id
  where c.id=p_canonical and o.id=v_occ;
end;
$$;

create or replace function app_private.process_availability_runs(p_limit integer default 50)
returns integer
language plpgsql
set search_path=''
as $$
declare r record; c record; v_count integer:=0;
begin
  for r in
    select cr.id,cr.source_id,cr.started_at
    from public.crawl_runs cr
    where cr.success=true and cr.availability_processed_at is null
      and exists (
        select 1 from public.source_connectors sc
        where sc.source_id=cr.source_id and sc.enabled=true and sc.priority=1 and sc.enumerable=true and sc.shadow_only=false
      )
    order by cr.started_at
    limit greatest(1,least(coalesce(p_limit,50),250))
    for update skip locked
  loop
    update public.listing_occurrences o
    set miss_count=o.miss_count+1,
        is_active=case when o.miss_count+1>=3 then false else o.is_active end,
        updated_at=now()
    where o.source_id=r.source_id and o.is_active=true and o.last_seen_at < r.started_at;

    for c in select distinct canonical_listing_id from public.listing_occurrences where source_id=r.source_id
    loop perform app_private.refresh_canonical_listing(c.canonical_listing_id); end loop;

    update public.crawl_runs set availability_processed_at=now() where id=r.id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

-- Operational views are private and not exposed through the Data API.
create or replace view app_private.queue_health as
select 'source_jobs'::text queue,
       count(*) filter(where status in ('enqueued','retry')) pending,
       count(*) filter(where status='processing') processing,
       count(*) filter(where status='dead') dead,
       min(enqueued_at) filter(where status in ('enqueued','retry','processing')) oldest_pending_at,
       extract(epoch from (now()-min(enqueued_at) filter(where status in ('enqueued','retry','processing'))))::bigint oldest_age_seconds
from public.source_jobs
union all
select 'notification_outbox',
       count(*) filter(where status in ('pending','queued','failed')),
       count(*) filter(where status='processing'),
       0,
       min(created_at) filter(where status in ('pending','queued','failed','processing')),
       extract(epoch from (now()-min(created_at) filter(where status in ('pending','queued','failed','processing'))))::bigint
from public.notification_outbox;

create or replace view app_private.source_health_v2 as
select s.id,s.name,s.source_type,s.tier as poll_tier,s.poll_interval_minutes,s.delivery_mode,s.worker_slug,
       s.enabled,s.last_checked_at,s.last_success_at,s.last_error_at,s.consecutive_failures,
       sc.connector_kind,sc.connector_role,sc.evidence_tier,sc.enumerable,sc.shadow_only,
       cr.started_at last_run_at,cr.success last_run_success,cr.fetched_count last_fetched_count,cr.inserted_count last_inserted_count,cr.error_message last_run_error,
       (select count(*) from public.listing_occurrences o where o.source_id=s.id and o.is_active) active_occurrences,
       (select count(*) from public.source_jobs j where j.source_id=s.id and j.status in ('enqueued','processing','retry')) active_jobs
from public.sources s
left join public.source_connectors sc on sc.source_id=s.id and sc.priority=1
left join lateral (
  select cr.* from public.crawl_runs cr where cr.source_id=s.id order by cr.started_at desc limit 1
) cr on true;

create or replace view app_private.architecture_health as
select
  (select count(*) from public.sources) total_sources,
  (select count(*) from public.sources where enabled) active_sources,
  (select count(*) from public.canonical_listings) canonical_listings,
  (select count(*) from public.listing_occurrences) occurrences,
  (select count(*) from public.matches) matches,
  (select count(*) from public.notification_outbox) outbox_events,
  (select count(*) from public.notification_outbox where status in ('pending','queued','failed','processing')) outbox_open,
  (select count(*) from public.source_jobs where status in ('enqueued','retry','processing')) source_jobs_open,
  (select count(*) from public.source_jobs where status='dead') source_jobs_dead,
  (select count(*) from public.search_profiles where is_active) active_profiles;

select cron.unschedule('source-job-runner-every-10-seconds') where exists (select 1 from cron.job where jobname='source-job-runner-every-10-seconds');
select cron.schedule('source-job-runner-every-10-seconds','10 seconds',$$
select net.http_post(
  url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-job-runner',
  headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
  body:='{}'::jsonb,
  timeout_milliseconds:=45000
);
$$);

select cron.unschedule('listing-availability-every-5-minutes') where exists (select 1 from cron.job where jobname='listing-availability-every-5-minutes');
select cron.schedule('listing-availability-every-5-minutes','*/5 * * * *',$$select app_private.process_availability_runs(100);$$);
