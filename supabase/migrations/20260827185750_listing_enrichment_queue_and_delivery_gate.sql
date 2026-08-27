create or replace function app_private.queue_listing_enrichment_id(p_listing_id uuid)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_status text;
  v_existing bigint;
  v_msg bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_listing_id::text, 913));

  select status,queue_msg_id into v_status,v_existing
  from public.listing_enrichment_jobs
  where listing_id=p_listing_id;

  if v_status in ('queued','processing','retrying') and v_existing is not null then
    return v_existing;
  end if;

  select pgmq.send('listing_enrichment',jsonb_build_object('listing_id',p_listing_id)) into v_msg;

  insert into public.listing_enrichment_jobs(
    listing_id,queue_msg_id,status,attempts,error_message,queued_at,started_at,finished_at,updated_at
  ) values (
    p_listing_id,v_msg,'queued',0,null,now(),null,null,now()
  )
  on conflict(listing_id) do update set
    queue_msg_id=excluded.queue_msg_id,
    status='queued',attempts=0,error_message=null,
    queued_at=now(),started_at=null,finished_at=null,updated_at=now();

  update public.listings
  set enrichment_status='pending',enrichment_error=null
  where id=p_listing_id;

  return v_msg;
end;
$$;
revoke all on function app_private.queue_listing_enrichment_id(uuid) from public,anon,authenticated;
grant execute on function app_private.queue_listing_enrichment_id(uuid) to service_role;

create or replace function app_private.queue_listing_enrichment_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if tg_op='INSERT'
     or old.canonical_url is distinct from new.canonical_url
     or old.raw is distinct from new.raw
     or old.image_url is distinct from new.image_url then
    perform app_private.queue_listing_enrichment_id(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists listings_queue_enrichment on public.listings;
create trigger listings_queue_enrichment
after insert or update of canonical_url,raw,image_url
on public.listings
for each row execute function app_private.queue_listing_enrichment_trigger();

create or replace function public.claim_listing_enrichment_jobs(p_qty integer default 6)
returns table(msg_id bigint,read_ct bigint,listing_id uuid)
language plpgsql
security definer
set search_path=''
as $$
begin
  return query
  with claimed as (
    select r.msg_id::bigint,r.read_ct::bigint,(r.message->>'listing_id')::uuid as listing_id
    from pgmq.read('listing_enrichment',180,least(greatest(p_qty,1),12)) r
  ), marked as (
    update public.listing_enrichment_jobs j
    set status='processing',attempts=c.read_ct::integer,
        started_at=coalesce(j.started_at,now()),updated_at=now()
    from claimed c
    where j.listing_id=c.listing_id and j.queue_msg_id=c.msg_id
    returning c.msg_id,c.read_ct,c.listing_id
  )
  select m.msg_id,m.read_ct,m.listing_id from marked m;
end;
$$;
revoke execute on function public.claim_listing_enrichment_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_listing_enrichment_jobs(integer) to service_role;

create or replace function public.finish_listing_enrichment_job(
  p_listing_id uuid,
  p_msg_id bigint,
  p_attempt integer,
  p_success boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_delay integer;
begin
  if p_success then
    perform pgmq.archive('listing_enrichment',p_msg_id);
    update public.listing_enrichment_jobs
    set status='done',attempts=p_attempt,error_message=null,finished_at=now(),updated_at=now()
    where listing_id=p_listing_id and queue_msg_id=p_msg_id;
    return true;
  end if;

  if p_attempt>=5 then
    perform pgmq.archive('listing_enrichment',p_msg_id);
    update public.listing_enrichment_jobs
    set status='dead',attempts=p_attempt,error_message=left(p_error,2000),finished_at=now(),updated_at=now()
    where listing_id=p_listing_id and queue_msg_id=p_msg_id;
    update public.listings
    set enrichment_status='error',enrichment_error=left(p_error,2000),enrichment_checked_at=now()
    where id=p_listing_id;
    return false;
  end if;

  v_delay:=case when p_attempt<=1 then 60 when p_attempt=2 then 300 else 900 end;
  perform pgmq.set_vt('listing_enrichment',p_msg_id,v_delay);
  update public.listing_enrichment_jobs
  set status='retrying',attempts=p_attempt,error_message=left(p_error,2000),updated_at=now()
  where listing_id=p_listing_id and queue_msg_id=p_msg_id;
  update public.listings
  set enrichment_status='retrying',enrichment_error=left(p_error,2000),enrichment_checked_at=now()
  where id=p_listing_id;
  return false;
end;
$$;
revoke execute on function public.finish_listing_enrichment_job(uuid,bigint,integer,boolean,text) from public,anon,authenticated;
grant execute on function public.finish_listing_enrichment_job(uuid,bigint,integer,boolean,text) to service_role;

create or replace function app_private.enqueue_stale_listing_enrichment(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  r record;
  v_count integer:=0;
begin
  for r in
    select l.id
    from public.listings l
    left join public.listing_enrichment_jobs j on j.listing_id=l.id
    where l.is_active=true
      and coalesce(j.status,'done') not in ('queued','processing','retrying')
      and (
        l.enrichment_checked_at is null
        or (l.image_status='fallback' and coalesce(l.image_last_checked_at,'-infinity'::timestamptz)<now()-interval '24 hours')
        or (l.enrichment_status='error' and coalesce(l.enrichment_checked_at,'-infinity'::timestamptz)<now()-interval '6 hours')
      )
    order by l.last_seen_at desc
    limit least(greatest(p_limit,1),250)
  loop
    perform app_private.queue_listing_enrichment_id(r.id);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function app_private.queue_new_listing_delivery()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_canonical uuid;
begin
  if not coalesce(new.enrichment_delivery_eligible,false)
     or coalesce(new.enrichment_status,'pending')<>'done' then
    return new;
  end if;

  if not exists (
    select 1 from public.sources s
    where s.id=new.source_id and s.enabled=true and s.last_success_at is not null and s.delivery_mode='live'
  ) then return new; end if;

  v_canonical:=app_private.upsert_listing_architecture(new.id);

  insert into public.matches(profile_id,recipient_user_id,canonical_listing_id,listing_id,dedupe_key,status,match_snapshot)
  select p.id,p.user_id,v_canonical,new.id,
         coalesce(new.cross_source_hash,'source:'||new.source_id::text||':'||new.source_listing_key),
         'matched',
         jsonb_build_object('max_warm_rent',p.max_warm_rent,'min_rooms',p.min_rooms,'min_area_sqm',p.min_area_sqm,'location_mode',p.location_mode)
  from public.search_profiles p
  join public.bot_users u on u.id=p.user_id
  where p.is_active=true and u.is_active=true
    and (coalesce(cardinality(p.property_types),0)=0 or coalesce(new.property_type,'Wohnung')=any(p.property_types))
    and (p.max_warm_rent is null or coalesce(new.warm_rent,new.cold_rent) is null or coalesce(new.warm_rent,new.cold_rent)<=p.max_warm_rent)
    and (coalesce(p.min_rooms,0)<=0 or new.rooms is null or new.rooms>=p.min_rooms)
    and (coalesce(p.min_area_sqm,0)<=0 or new.area_sqm is null or new.area_sqm>=p.min_area_sqm)
    and (not p.wbs_only or coalesce(new.wbs_required,false))
    and (coalesce(p.furnished_preference,'any')='any' or new.furnished is null
         or (p.furnished_preference in ('yes','furnished') and new.furnished=true)
         or (p.furnished_preference in ('no','unfurnished') and new.furnished=false))
    and (
      p.location_mode='all_hamburg'
      or (p.location_mode='neighborhoods' and exists (
        select 1 from unnest(p.neighborhoods) n where lower(concat_ws(' ',new.district,new.address,new.title)) like '%'||lower(n)||'%'
      ))
      or (p.location_mode='boroughs' and exists (
        select 1 from public.hamburg_neighborhoods hn
        join public.hamburg_boroughs hb on hb.id=hn.borough_id
        where hb.name=any(p.boroughs)
          and lower(concat_ws(' ',new.district,new.address,new.title)) like '%'||lower(hn.name)||'%'
      ))
      or (coalesce(cardinality(p.districts),0)>0 and ('Ganz Hamburg'=any(p.districts) or exists (
        select 1 from unnest(p.districts) d where lower(concat_ws(' ',new.district,new.address,new.title)) like '%'||lower(d)||'%'
      )))
    )
  on conflict(profile_id,canonical_listing_id) do update set
    listing_id=excluded.listing_id,dedupe_key=excluded.dedupe_key,status='matched',match_snapshot=excluded.match_snapshot,updated_at=now();

  insert into public.notification_outbox(match_id,recipient_user_id,profile_id,canonical_listing_id,listing_id,dedupe_key,status)
  select distinct on(m.recipient_user_id)
         m.id,m.recipient_user_id,m.profile_id,m.canonical_listing_id,m.listing_id,m.dedupe_key,'pending'
  from public.matches m
  join public.search_profiles p on p.id=m.profile_id
  where m.canonical_listing_id=v_canonical and m.status='matched' and p.is_active=true
  order by m.recipient_user_id,p.updated_at desc,p.created_at desc
  on conflict(recipient_user_id,dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists listings_queue_enriched_delivery on public.listings;
create trigger listings_queue_enriched_delivery
after update of enrichment_status on public.listings
for each row
when (new.enrichment_status='done' and old.enrichment_status is distinct from new.enrichment_status)
execute function app_private.queue_new_listing_delivery();
