-- Architecture v3: one scheduler, one source queue, one generic source worker,
-- listings + dedupe, direct delivery_events, Telegram dispatcher.

alter table public.sources add column if not exists coverage_strategy text not null default 'generic';
alter table public.sources add column if not exists runtime_mode text not null default 'live';
alter table public.sources add column if not exists coverage_status text not null default 'unknown';
alter table public.sources add column if not exists baseline_completed_at timestamptz;

alter table public.sources drop constraint if exists sources_runtime_mode_check;
alter table public.sources add constraint sources_runtime_mode_check check (runtime_mode in ('live','shadow'));
alter table public.sources drop constraint if exists sources_coverage_status_check;
alter table public.sources add constraint sources_coverage_status_check check (coverage_status in ('unknown','partial','complete','degraded'));

create table if not exists public.source_coverage_state (
  source_id smallint primary key references public.sources(id) on delete cascade,
  cycle_id uuid,
  strategy text not null default 'generic',
  status text not null default 'idle',
  segment text,
  cursor jsonb not null default '{}'::jsonb,
  expected_count integer,
  seen_count integer not null default 0,
  request_count integer not null default 0,
  cycle_started_at timestamptz,
  cycle_finished_at timestamptz,
  last_complete_at timestamptz,
  backoff_until timestamptz,
  consecutive_errors integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.source_coverage_state enable row level security;
revoke all on public.source_coverage_state from anon, authenticated;
grant all on public.source_coverage_state to service_role;

-- Coverage method is runtime metadata; K1/K2/K3 remains the independent source category.
update public.sources set coverage_strategy = case
  when id=1 then 'adaptive_partition'
  when id=2 then 'district_pagination'
  when id in (23,24,25,26,27,28,29,30,32,33,34,35,36,37,39,43,61,65,5,7) then 'tenant_api'
  when id in (3,6,8,9,10,12,14,15,16,21,22) then 'pagination'
  when id in (38,41,42,46,52,53,58) then 'full_page'
  when id in (49,50) then 'availability'
  else 'generic'
end;

-- Runtime shadow is separate from K1/K2/K3.
update public.sources
set runtime_mode='shadow', delivery_mode='shadow', enabled=false, worker_slug=null, updated_at=now()
where id in (18,51,54,56,57,59,62,63,64);

update public.sources
set runtime_mode='live', delivery_mode='live', worker_slug='source-worker',
    poll_interval_minutes=case
      when id in (1,2) then 1
      when id in (3,6,14) then 2
      when tier='K1' then 5
      when tier='K2' then 10
      else 30
    end,
    updated_at=now()
where id not in (18,51,54,56,57,59,62,63,64) and enabled=true;

-- Restore the user-authored master classification where previous experiments changed it.
update public.sources set tier='K1', poll_interval_minutes=5, updated_at=now() where id=25;
update public.sources set tier='K3', poll_interval_minutes=30, updated_at=now() where id=61;

create or replace function app_private.enqueue_due_source_jobs(p_limit integer default 65)
returns integer language plpgsql set search_path=''
as $function$
declare r record; v_msg_id bigint; v_job_id uuid; v_count integer:=0;
begin
  for r in
    select s.id from public.sources s
    where s.enabled=true and s.runtime_mode='live' and s.delivery_mode='live'
      and not exists (
        select 1 from public.source_jobs j
        where j.source_id=s.id and j.status in ('enqueued','processing','retry')
      )
      and (
        s.last_checked_at is null or
        s.last_checked_at <= now()-make_interval(mins=>case
          when coalesce(s.consecutive_failures,0)>=5 then greatest(s.poll_interval_minutes,60)
          when coalesce(s.consecutive_failures,0)>=3 then greatest(s.poll_interval_minutes,30)
          when coalesce(s.consecutive_failures,0)>=1 then greatest(s.poll_interval_minutes,10)
          else s.poll_interval_minutes end)
      )
    order by coalesce(s.crawl_priority,2147483647),coalesce(s.last_checked_at,'-infinity'::timestamptz),s.id
    limit greatest(1,least(coalesce(p_limit,65),65))
    for update skip locked
  loop
    v_job_id:=gen_random_uuid();
    select x into v_msg_id
    from pgmq.send('source_jobs',jsonb_build_object('job_id',v_job_id,'source_id',r.id,'worker','source-worker')) as x
    limit 1;
    insert into public.source_jobs(id,queue_msg_id,source_id,status,worker,enqueued_at,updated_at)
    values(v_job_id,v_msg_id,r.id,'enqueued','source-worker',now(),now());
    update public.sources set last_checked_at=now(),updated_at=now() where id=r.id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;$function$;

create or replace function public.claim_source_jobs(p_worker text, p_qty integer default 3)
returns table(job_id uuid,queue_msg_id bigint,source_id smallint,worker_slug text,attempt integer)
language plpgsql security definer set search_path=''
as $function$
declare r record; v_job uuid; v_source smallint; v_attempt integer; v_status text; v_limit integer:=greatest(1,least(coalesce(p_qty,3),3));
begin
  for r in select * from pgmq.read('source_jobs',120,v_limit,'{}'::jsonb)
  loop
    begin
      v_job:=(r.message->>'job_id')::uuid;
      v_source:=(r.message->>'source_id')::smallint;
    exception when others then
      perform pgmq.archive('source_jobs',r.msg_id);
      continue;
    end;
    update public.source_jobs j
    set status='processing',attempts=j.attempts+1,started_at=coalesce(j.started_at,now()),worker='source-worker',updated_at=now()
    where j.id=v_job and j.queue_msg_id=r.msg_id and j.status in ('enqueued','retry')
    returning j.attempts into v_attempt;
    if found then
      job_id:=v_job; queue_msg_id:=r.msg_id; source_id:=v_source; worker_slug:='source-worker'; attempt:=v_attempt; return next;
    else
      select j.status into v_status from public.source_jobs j where j.id=v_job and j.queue_msg_id=r.msg_id;
      if v_status is distinct from 'processing' then perform pgmq.archive('source_jobs',r.msg_id); end if;
    end if;
  end loop;
end;$function$;

create or replace function app_private.assign_listing_dedupe(p_listing_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare c public.listings%rowtype; v_group uuid; v_winner uuid;
begin
  select * into c from public.listings where id=p_listing_id for update;
  if not found or c.quality_status='rejected' then return null; end if;
  select l.dedupe_group_id into v_group
  from public.listings l
  where l.id<>c.id and l.is_active=true and l.quality_status<>'rejected' and l.dedupe_group_id is not null
    and (
      (c.cross_source_hash is not null and l.cross_source_hash=c.cross_source_hash)
      or (length(app_private.normalized_listing_address(c.address))>=6
          and app_private.normalized_listing_address(c.address)=app_private.normalized_listing_address(l.address)
          and (c.rooms is null or l.rooms is null or abs(c.rooms-l.rooms)<=0.5)
          and (c.area_sqm is null or l.area_sqm is null or abs(c.area_sqm-l.area_sqm)<=3))
    )
  order by l.first_seen_at limit 1;
  if v_group is null then insert into public.listing_dedupe_groups default values returning id into v_group; end if;
  update public.listings set dedupe_group_id=v_group where id=c.id;
  select l.id into v_winner
  from public.listings l join public.sources s on s.id=l.source_id
  where l.dedupe_group_id=v_group and l.is_active=true and l.quality_status<>'rejected'
  order by s.listing_priority asc,l.last_seen_at desc,l.first_seen_at asc,l.id
  limit 1;
  update public.listings
  set is_primary_listing=(id=v_winner),
      duplicate_of_listing_id=case when id=v_winner then null else v_winner end,
      dedupe_match_reason=case when id=v_winner then 'primary' else 'duplicate' end
  where dedupe_group_id=v_group;
  update public.listing_dedupe_groups set preferred_listing_id=v_winner,updated_at=now() where id=v_group;
  return v_group;
end;$function$;

create or replace function app_private.queue_listing_delivery_v3()
returns trigger language plpgsql set search_path=''
as $function$
declare v_group uuid; v_primary boolean; v_source_ready boolean;
begin
  if new.quality_status='rejected' or not coalesce(new.enrichment_delivery_eligible,true) then return new; end if;
  select (s.enabled and s.runtime_mode='live' and s.delivery_mode='live' and s.baseline_completed_at is not null)
    into v_source_ready from public.sources s where s.id=new.source_id;
  if not coalesce(v_source_ready,false) then
    perform app_private.assign_listing_dedupe(new.id);
    return new;
  end if;
  v_group:=app_private.assign_listing_dedupe(new.id);
  select is_primary_listing into v_primary from public.listings where id=new.id;
  if not coalesce(v_primary,false) or v_group is null then return new; end if;
  insert into public.delivery_events(profile_id,listing_id,dedupe_key,status,delivery_format)
  select p.id,new.id,'group:'||v_group::text,'pending','photo_card'
  from public.search_profiles p join public.bot_users u on u.id=p.user_id
  where p.is_active=true and u.is_active=true
    and (coalesce(cardinality(p.property_types),0)=0 or coalesce(new.property_type,'Wohnung')=any(p.property_types))
    and (p.max_warm_rent is null or coalesce(new.warm_rent,new.cold_rent) is null or coalesce(new.warm_rent,new.cold_rent)<=p.max_warm_rent)
    and (coalesce(p.min_rooms,0)<=0 or new.rooms is null or new.rooms>=p.min_rooms)
    and (coalesce(p.min_area_sqm,0)<=0 or new.area_sqm is null or new.area_sqm>=p.min_area_sqm)
    and (not p.wbs_only or coalesce(new.wbs_required,false))
    and (coalesce(p.furnished_preference,'any')='any' or new.furnished is null
      or (p.furnished_preference in ('yes','furnished') and new.furnished=true)
      or (p.furnished_preference in ('no','unfurnished') and new.furnished=false))
    and (p.location_mode='all_hamburg'
      or (p.location_mode='neighborhoods' and exists(select 1 from unnest(p.neighborhoods) n where lower(concat_ws(' ',new.district,new.address,new.title)) like '%'||lower(n)||'%'))
      or (p.location_mode='boroughs' and exists(select 1 from public.hamburg_neighborhoods hn join public.hamburg_boroughs hb on hb.id=hn.borough_id where hb.name=any(p.boroughs) and lower(concat_ws(' ',new.district,new.address,new.title)) like '%'||lower(hn.name)||'%'))
      or (coalesce(cardinality(p.districts),0)>0 and ('Ganz Hamburg'=any(p.districts) or exists(select 1 from unnest(p.districts) d where lower(concat_ws(' ',new.district,new.address,new.title)) like '%'||lower(d)||'%'))))
  on conflict do nothing;
  return new;
end;$function$;

-- One profile per Telegram user: a second insert replaces the existing profile.
create or replace function app_private.replace_single_search_profile()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_id uuid;
begin
  select id into v_id from public.search_profiles where user_id=new.user_id order by created_at limit 1;
  if v_id is null then return new; end if;
  update public.search_profiles set
    name=new.name,max_warm_rent=new.max_warm_rent,min_rooms=new.min_rooms,min_area_sqm=new.min_area_sqm,
    districts=new.districts,property_types=new.property_types,furnished_preference=new.furnished_preference,
    wbs_only=new.wbs_only,move_in_from=new.move_in_from,is_active=new.is_active,location_mode=new.location_mode,
    boroughs=new.boroughs,neighborhoods=new.neighborhoods,updated_at=now()
  where id=v_id;
  return null;
end;$function$;

drop trigger if exists search_profiles_single_profile_replace on public.search_profiles;
create trigger search_profiles_single_profile_replace before insert on public.search_profiles
for each row execute function app_private.replace_single_search_profile();

-- Remove superseded v2 trigger paths.
drop trigger if exists listings_00_sync_architecture on public.listings;
drop trigger if exists listings_queue_enriched_delivery on public.listings;
drop trigger if exists listings_queue_enrichment on public.listings;
drop trigger if exists listings_queue_fast_delivery on public.listings;
drop trigger if exists listings_queue_new_delivery on public.listings;
drop trigger if exists listings_source_specific_repair on public.listings;
drop trigger if exists listings_sync_immoscout_inventory_member_type on public.listings;
drop trigger if exists delivery_events_sync_outbox on public.delivery_events;
drop trigger if exists sources_log_immomio_success on public.sources;
drop trigger if exists sources_suppress_generic_legacy_delivery on public.sources;
drop trigger if exists listings_normalize_fallback_logo on public.listings;
drop trigger if exists listings_queue_delivery_v3 on public.listings;
create trigger listings_queue_delivery_v3 after insert on public.listings for each row execute function app_private.queue_listing_delivery_v3();

-- Retire asynchronous enrichment and the v2 canonical/outbox bridge.
drop function if exists app_private.enqueue_stale_listing_enrichment(integer) cascade;
drop function if exists app_private.queue_listing_enrichment_id(uuid) cascade;
drop function if exists app_private.queue_listing_enrichment_trigger() cascade;
drop function if exists public.claim_listing_enrichment_jobs(integer) cascade;
drop function if exists public.finish_listing_enrichment_job(uuid,bigint,integer,boolean,text) cascade;
do $do$ begin
  if exists(select 1 from pgmq.meta where queue_name='listing_enrichment') then perform pgmq.drop_queue('listing_enrichment'); end if;
end $do$;
drop table if exists public.listing_enrichment_jobs cascade;

drop function if exists app_private.queue_new_listing_delivery() cascade;
drop function if exists app_private.outbox_enqueue_delivery_event() cascade;
drop function if exists app_private.sync_outbox_from_delivery_event() cascade;
drop function if exists app_private.process_availability_runs(integer) cascade;
drop function if exists app_private.reconcile_occurrence_evidence(integer) cascade;
drop function if exists app_private.sync_listing_architecture_trigger() cascade;
drop function if exists app_private.upsert_listing_architecture(uuid) cascade;
drop function if exists app_private.refresh_canonical_listing(uuid) cascade;
drop table if exists public.notification_outbox cascade;
drop table if exists public.matches cascade;
drop table if exists public.listing_occurrences cascade;
drop table if exists public.canonical_listings cascade;

drop function if exists public.enqueue_immoscout_inventory_continuation() cascade;
drop table if exists public.immoscout_inventory_members cascade;
drop table if exists public.immoscout_inventory_partitions cascade;
drop table if exists public.immoscout_inventory_runs cascade;
drop table if exists public.source_scan_members cascade;
drop table if exists public.source_scan_state cascade;
drop table if exists public.source_field_capabilities cascade;
drop table if exists public.image_cache cascade;
drop table if exists public.app_settings cascade;
drop function if exists app_private.log_immomio_source_success() cascade;
drop function if exists app_private.suppress_generic_source_legacy_delivery() cascade;
drop function if exists app_private.normalize_listing_fallback_logo() cascade;

create or replace function app_private.maintenance_cleanup()
returns jsonb language plpgsql set search_path=''
as $function$
declare v_jobs integer:=0;v_archive integer:=0;v_runs integer:=0;v_events integer:=0;
begin
  delete from public.source_jobs where (status='done' and finished_at<now()-interval '7 days') or (status='dead' and finished_at<now()-interval '30 days');
  get diagnostics v_jobs=row_count;
  delete from pgmq.a_source_jobs where archived_at<now()-interval '14 days'; get diagnostics v_archive=row_count;
  delete from public.crawl_runs where (success=true and finished_at<now()-interval '7 days') or (success=false and finished_at<now()-interval '30 days'); get diagnostics v_runs=row_count;
  delete from public.delivery_events where status in ('sent','skipped') and created_at<now()-interval '90 days'; get diagnostics v_events=row_count;
  return jsonb_build_object('source_jobs_deleted',v_jobs,'queue_archive_deleted',v_archive,'crawl_runs_deleted',v_runs,'delivery_events_deleted',v_events);
end;$function$;

-- Exactly four production schedules: scheduler, source worker, Telegram dispatcher, maintenance.
select cron.unschedule(jobid) from cron.job where jobname in (
  'source-engine-every-minute','source-job-runner-every-10-seconds','listing-availability-every-5-minutes',
  'occurrence-evidence-every-5-minutes','listing-enricher-every-10-seconds','listing-enrichment-backfill-every-minute',
  'source-field-capability-refresh-every-15-minutes','immoscout-inventory-continuation',
  'immoscout-rolling-validation-every-minute','source-scheduler-every-minute','source-worker-every-minute'
);
select cron.schedule('source-scheduler-every-minute','* * * * *','select app_private.enqueue_due_source_jobs(65);');
select cron.schedule('source-worker-every-minute','* * * * *',$cron$
select net.http_post(
  url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
  body:='{}'::jsonb,
  timeout_milliseconds:=55000
);$cron$);
