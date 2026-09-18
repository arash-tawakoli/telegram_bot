-- Simplify delivery policy: an active, accepted, primary listing from a live source
-- is deliverable when it matches a profile and has not already been delivered to that user.
-- Enrichment, first-seen age, freshness flags and baseline state remain telemetry only.

CREATE OR REPLACE FUNCTION app_private.queue_listing_delivery_v3()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_group uuid;
  v_primary boolean;
  v_source_ready boolean;
  v_haystack text := lower(concat_ws(' ',new.property_type,new.title,new.district,new.address,new.raw::text));
begin
  if not coalesce(new.is_active,false) or coalesce(new.quality_status,'unchecked')='rejected' then
    return new;
  end if;

  if v_haystack ~ '(^|[[:space:]])(ich|wir)[[:space:]]+suche(n)?[[:space:]].{0,40}(wohnung|apartment|wg-zimmer|zimmer|haus)'
     or v_haystack ~ '[[:space:]]sucht[[:space:]]+(dringend[[:space:]]+)?(eine[nr]?[[:space:]]+)?(wohnung|apartment|wg-zimmer|zimmer|haus)'
     or v_haystack ~ '^[[:space:]]*(wohnung|apartment|wg-zimmer|zimmer|haus)[[:space:]]+gesucht'
  then
    return new;
  end if;

  select (s.enabled and s.runtime_mode='live' and s.delivery_mode='live')
    into v_source_ready
  from public.sources s
  where s.id=new.source_id;

  if not coalesce(v_source_ready,false) then
    perform app_private.assign_listing_dedupe(new.id);
    return new;
  end if;

  v_group := app_private.assign_listing_dedupe(new.id);

  select l.is_primary_listing
    into v_primary
  from public.listings l
  where l.id=new.id;

  if not coalesce(v_primary,false) or v_group is null then
    return new;
  end if;

  insert into public.delivery_events(
    profile_id,listing_id,dedupe_key,status,delivery_format,recipient_user_id,next_retry_at
  )
  select
    p.id,new.id,'group:'||v_group::text,'pending','photo_card',p.user_id,null
  from public.search_profiles p
  join public.bot_users owner_user
    on owner_user.id=p.user_id
   and owner_user.is_active=true
  where p.is_active=true
    and (p.profile_slot=1 or app_private.user_is_premium(p.user_id))
    and (
      coalesce(cardinality(p.property_types),0)=0
      or (
        v_haystack ~ '(tauschwohnung|tauschangebot|wohnungstausch|wohnung[[:space:]-]*tausch|tausche)'
        and 'Tauschwohnung'=any(p.property_types)
      )
      or (
        v_haystack !~ '(tauschwohnung|tauschangebot|wohnungstausch|wohnung[[:space:]-]*tausch|tausche)'
        and coalesce(new.property_type,'Wohnung')=any(p.property_types)
      )
    )
    and (
      p.max_warm_rent is null
      or coalesce(nullif(new.warm_rent,0),nullif(new.cold_rent,0)) is null
      or coalesce(nullif(new.warm_rent,0),nullif(new.cold_rent,0))<=p.max_warm_rent
    )
    and (not p.require_known_warm_rent or coalesce(new.warm_rent,0)>0)
    and (p.max_deposit is null or new.deposit is null or new.deposit<=p.max_deposit)
    and (not p.wbs_only or new.wbs_required is true)
    and (
      p.furnished_preference='any'
      or (p.furnished_preference='yes' and new.furnished is true)
      or (p.furnished_preference='no' and new.furnished is false)
    )
    and (coalesce(p.min_rooms,0)<=0 or new.rooms is null or new.rooms>=p.min_rooms)
    and (coalesce(p.min_area_sqm,0)<=0 or new.area_sqm is null or new.area_sqm>=p.min_area_sqm)
    and (
      p.location_mode='all_hamburg'
      or (p.location_mode='boroughs' and coalesce(cardinality(p.boroughs),0)>=7)
      or (
        p.location_mode='neighborhoods'
        and exists(
          select 1
          from unnest(p.neighborhoods) n
          where lower(concat_ws(' ',new.district,new.address,new.title,new.raw::text))
                like '%'||lower(n)||'%'
        )
      )
      or (
        p.location_mode='boroughs'
        and exists(
          select 1
          from public.hamburg_neighborhoods hn
          join public.hamburg_boroughs hb on hb.id=hn.borough_id
          where hb.name=any(p.boroughs)
            and lower(concat_ws(' ',new.district,new.address,new.title,new.raw::text))
                like '%'||lower(hn.name)||'%'
        )
      )
      or (
        coalesce(cardinality(p.districts),0)>0
        and (
          'Ganz Hamburg'=any(p.districts)
          or exists(
            select 1
            from unnest(p.districts) d
            where lower(concat_ws(' ',new.district,new.address,new.title,new.raw::text))
                  like '%'||lower(d)||'%'
          )
        )
      )
    )
  on conflict do nothing;

  return new;
end;
$function$

CREATE OR REPLACE FUNCTION app_private.require_deliverable_delivery_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_listing record;
begin
  if coalesce(new.event_type,'new_listing') <> 'new_listing' then
    return new;
  end if;

  select
    l.is_active,
    l.is_primary_listing,
    l.quality_status,
    s.enabled as source_enabled,
    s.runtime_mode,
    s.delivery_mode
  into v_listing
  from public.listings l
  join public.sources s on s.id=l.source_id
  where l.id=new.listing_id;

  if not found then
    return null;
  end if;

  if not coalesce(v_listing.is_active,false)
     or not coalesce(v_listing.is_primary_listing,false)
     or coalesce(v_listing.quality_status,'unchecked')='rejected'
     or not coalesce(v_listing.source_enabled,false)
     or v_listing.runtime_mode<>'live'
     or v_listing.delivery_mode<>'live'
  then
    return null;
  end if;

  return new;
end;
$function$

CREATE OR REPLACE FUNCTION app_private.prepare_current_delivery_queue()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with stopped as (
    update public.delivery_events de
    set status='skipped',
        next_retry_at=null,
        error_message=case
          when not coalesce(l.is_active,false) then 'inactive listing blocked by delivery guard'
          when coalesce(l.quality_status,'unchecked')='rejected' then 'rejected listing blocked by delivery guard'
          when not coalesce(l.is_primary_listing,false) then 'deduplicated listing blocked by delivery guard'
          else 'source not live blocked by delivery guard'
        end
    from public.listings l
    join public.sources s on s.id=l.source_id
    where l.id=de.listing_id
      and de.event_type='new_listing'
      and de.status in ('pending','failed')
      and (
        not coalesce(l.is_active,false)
        or coalesce(l.quality_status,'unchecked')='rejected'
        or not coalesce(l.is_primary_listing,false)
        or not coalesce(s.enabled,false)
        or s.runtime_mode<>'live'
        or s.delivery_mode<>'live'
      )
    returning de.id
  )
  select count(*) into v_count from stopped;

  return v_count;
end;
$function$

CREATE OR REPLACE FUNCTION app_private.prepare_listing_fast_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- Enrichment stays as data-quality telemetry only; it is not a delivery gate.
  new.enrichment_status := 'done';
  new.enrichment_delivery_eligible := true;
  new.enrichment_error := null;
  return new;
end;
$function$

CREATE OR REPLACE FUNCTION app_private.refresh_listing_dedupe_group(p_group_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_winner uuid;
begin
  if p_group_id is null then
    return null;
  end if;

  select l.id
    into v_winner
  from public.listings l
  join public.sources s on s.id=l.source_id
  where l.dedupe_group_id=p_group_id
    and l.is_active=true
    and l.quality_status<>'rejected'
  order by
    s.listing_priority asc,
    (
      (l.resolved_image_url is not null)::int
      +(l.address is not null)::int
      +(l.warm_rent is not null)::int
      +(l.cold_rent is not null)::int
      +(l.rooms is not null)::int
      +(l.area_sqm is not null)::int
      +(l.deposit is not null or l.deposit_text is not null)::int
    ) desc,
    l.first_seen_at asc,
    l.id
  limit 1;

  if v_winner is null then
    update public.listings
    set is_primary_listing=false,
        duplicate_of_listing_id=null
    where dedupe_group_id=p_group_id;
  else
    update public.listings
    set is_primary_listing=(id=v_winner),
        duplicate_of_listing_id=case when id=v_winner then null else v_winner end
    where dedupe_group_id=p_group_id;
  end if;

  update public.listing_dedupe_groups
  set preferred_listing_id=v_winner,
      updated_at=now()
  where id=p_group_id;

  return v_winner;
end;
$function$

CREATE OR REPLACE FUNCTION app_private.enqueue_matched_application()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  insert into public.applications(user_id, listing_id, source_id)
  select u.id, l.id, l.source_id
  from public.bot_users u
  join public.listings l on l.id=new.listing_id
  join public.sources s on s.id=l.source_id
  where u.id=new.recipient_user_id
    and u.is_active
    and u.auto_apply_enabled
    and app_private.user_is_premium(u.id)
    and app_private.applicant_profile_complete(u.id)
    and app_private.application_provider_ready(u.id,l.source_id,l.raw)
    and app_private.application_listing_auto_apply_allowed(l.title,l.property_type,l.raw)
    and l.is_active
    and coalesce(l.quality_status,'unchecked')<>'rejected'
    and coalesce(l.is_primary_listing,false)
    and s.enabled
    and s.runtime_mode='live'
    and s.delivery_mode='live'
  on conflict(user_id,listing_id) do nothing;

  return new;
end;
$function$

CREATE OR REPLACE FUNCTION public.begin_application_submission(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  a public.applications%rowtype;
begin
  select * into a
  from public.applications
  where id=p_id
  for update;

  if not found or a.status<>'pending' or a.submission_started_at is not null then
    return false;
  end if;

  if not exists (
    select 1
    from public.bot_users u
    join public.listings l on l.id=a.listing_id
    join public.sources s on s.id=l.source_id
    where u.id=a.user_id
      and u.is_active
      and u.auto_apply_enabled
      and app_private.user_is_premium(u.id)
      and app_private.applicant_profile_complete(u.id)
      and app_private.application_provider_ready(u.id,l.source_id,l.raw)
      and app_private.application_listing_auto_apply_allowed(l.title,l.property_type,l.raw)
      and l.is_active
      and coalesce(l.quality_status,'unchecked')<>'rejected'
      and coalesce(l.is_primary_listing,false)
      and s.enabled
      and s.runtime_mode='live'
      and s.delivery_mode='live'
      and l.source_id=a.source_id
      and exists (
        select 1
        from public.delivery_events d
        where d.listing_id=l.id
          and d.recipient_user_id=u.id
      )
  ) then
    update public.applications
    set status='failed',
        last_error='not_eligible'
    where id=p_id;
    return false;
  end if;

  update public.applications
  set status='processing',
      attempts=attempts+1,
      submission_started_at=now()
  where id=p_id;

  return true;
end;
$function$

CREATE OR REPLACE FUNCTION public.enqueue_application_now(p_user uuid, p_listing uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  result_id uuid;
begin
  if p_user is null or p_listing is null then
    return null;
  end if;

  if not exists (
    select 1
    from public.bot_users u
    join public.listings l on l.id=p_listing
    join public.sources s on s.id=l.source_id
    where u.id=p_user
      and u.is_active
      and app_private.user_is_premium(u.id)
      and app_private.applicant_profile_complete(u.id)
      and app_private.application_provider_ready(u.id,l.source_id,l.raw)
      and app_private.application_listing_auto_apply_allowed(l.title,l.property_type,l.raw)
      and l.is_active
      and coalesce(l.quality_status,'unchecked')<>'rejected'
      and coalesce(l.is_primary_listing,false)
      and s.enabled
      and s.runtime_mode='live'
      and s.delivery_mode='live'
      and exists (
        select 1
        from public.delivery_events d
        where d.listing_id=l.id
          and d.recipient_user_id=u.id
      )
  ) then
    return null;
  end if;

  insert into public.applications(user_id,listing_id,source_id)
  select p_user,l.id,l.source_id
  from public.listings l
  where l.id=p_listing
  on conflict(user_id,listing_id) do nothing
  returning id into result_id;

  if result_id is null then
    select id into result_id
    from public.applications
    where user_id=p_user
      and listing_id=p_listing;
  end if;

  return result_id;
end;
$function$

CREATE OR REPLACE FUNCTION app_private.process_partial_coop_provider_checks()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  r record;
  b record;
  v_block text;
  v_plain text;
  v_external_id text;
  v_mirror public.listings%rowtype;
  v_source public.sources%rowtype;
  v_key text;
  v_exists boolean;
  v_matched integer;
  v_inserted integer;
  v_processed integer := 0;
  v_retry_request_id bigint;
begin
  for r in
    select q.id,q.source_id,q.query_kind,q.request_id,q.requested_at,q.error as request_state,
           c.needle,c.query_url,h.status_code,h.timed_out,h.error_msg,h.content
    from app_private.coop_provider_index_requests q
    join app_private.coop_provider_query_config() c
      on c.source_id=q.source_id and c.query_kind=q.query_kind
    join net._http_response h on h.id=q.request_id
    where q.processed_at is null
    order by q.requested_at
    limit 40
  loop
    v_matched := 0;
    v_inserted := 0;

    if coalesce(r.timed_out,false) or r.error_msg is not null then
      if coalesce(r.request_state,'') <> 'retrying_once' then
        select net.http_get(url:=r.query_url,timeout_milliseconds:=15000)
          into v_retry_request_id;
        update app_private.coop_provider_index_requests
        set request_id=v_retry_request_id,
            requested_at=now(),
            status_code=r.status_code,
            error='retrying_once'
        where id=r.id;
        continue;
      end if;

      update app_private.coop_provider_index_requests
      set processed_at=now(),
          status_code=r.status_code,
          error=left(coalesce(r.error_msg,'transport failure'),1000)
      where id=r.id;

      v_processed := v_processed+1;
      continue;
    end if;

    if r.status_code is distinct from 200 then
      update app_private.coop_provider_index_requests
      set processed_at=now(),
          status_code=r.status_code,
          error=left('HTTP '||coalesce(r.status_code::text,'unknown'),1000)
      where id=r.id;

      v_processed := v_processed+1;
      continue;
    end if;

    select * into v_source
    from public.sources
    where id=r.source_id;

    if not found then
      update app_private.coop_provider_index_requests
      set processed_at=now(),
          status_code=r.status_code,
          error='source missing'
      where id=r.id;

      v_processed := v_processed+1;
      continue;
    end if;

    update public.sources
    set last_success_at=now(),
        updated_at=now()
    where id=r.source_id;

    for b in
      select x[1] as block
      from regexp_matches(r.content,'(<li><div class="dd algo[\s\S]*?</li>)','gi') x
    loop
      v_block := lower(b.block);
      v_plain := lower(regexp_replace(b.block,'<[^>]+>',' ','g'));

      if v_block not like '%'||r.needle||'%'
         or v_plain not like '%hamburg%'
         or v_plain !~ '(wohnung|apartment|appartement|mietwohnung)'
         or v_plain !~ '(miete|vermiet|mietwohnung)'
      then
        continue;
      end if;

      v_external_id := null;
      v_mirror := null;

      if r.query_kind='immoscout' then
        v_external_id := coalesce(
          (regexp_match(v_block,'immobilienscout24\.de%2fexpose%2f([0-9]+)'))[1],
          (regexp_match(v_block,'immobilienscout24\.de/expose/([0-9]+)'))[1]
        );

        if v_external_id is not null then
          select l.* into v_mirror
          from public.listings l
          where l.source_id=1
            and l.is_active=true
            and l.quality_status<>'rejected'
            and l.canonical_url ~ ('/expose/'||v_external_id||'([/?#]|$)')
          order by l.last_seen_at desc
          limit 1;
        end if;
      else
        v_external_id := coalesce(
          (regexp_match(v_block,'immowelt\.de%2fexpose%2f([a-f0-9-]{36})'))[1],
          (regexp_match(v_block,'immowelt\.de/expose/([a-f0-9-]{36})'))[1]
        );

        if v_external_id is not null then
          select l.* into v_mirror
          from public.listings l
          where l.source_id=3
            and l.is_active=true
            and l.quality_status<>'rejected'
            and lower(l.canonical_url) ~ ('/expose/'||v_external_id||'([/?#]|$)')
          order by l.last_seen_at desc
          limit 1;
        end if;
      end if;

      if v_external_id is null or v_mirror.id is null then
        continue;
      end if;

      if v_mirror.last_seen_at < now()-interval '2 hours' then
        continue;
      end if;

      v_matched := v_matched+1;
      v_key := 'provider-index:'||r.query_kind||':'||v_external_id;

      select exists(
        select 1
        from public.listings
        where source_id=r.source_id
          and source_listing_key=v_key
      ) into v_exists;

      if not v_exists then
        insert into public.listings(
          source_id,source_listing_key,external_id,canonical_url,title,address,district,postal_code,city,
          warm_rent,cold_rent,rooms,area_sqm,available_from,property_type,furnished,wbs_required,image_url,cross_source_hash,raw,
          first_seen_at,last_seen_at,is_active,heating_costs,additional_costs,operating_costs,deposit,deposit_text,
          resolved_image_url,image_source,image_status,image_last_checked_at,image_error,
          enrichment_status,enrichment_checked_at,enrichment_error,enrichment_evidence,field_conflicts,enrichment_delivery_eligible,
          quality_status,quality_reason,warm_rent_is_calculated,fresh_delivery_eligible,latitude,longitude
        ) values (
          r.source_id,v_key,v_external_id,v_mirror.canonical_url,v_mirror.title,v_mirror.address,v_mirror.district,v_mirror.postal_code,v_mirror.city,
          v_mirror.warm_rent,v_mirror.cold_rent,v_mirror.rooms,v_mirror.area_sqm,v_mirror.available_from,v_mirror.property_type,v_mirror.furnished,v_mirror.wbs_required,v_mirror.image_url,v_mirror.cross_source_hash,
          coalesce(v_mirror.raw,'{}'::jsonb)||jsonb_build_object('provider_index',jsonb_build_object('verified',true,'query_kind',r.query_kind,'mirror_source_id',v_mirror.source_id,'mirror_listing_id',v_mirror.id,'verified_at',now())),
          now(),now(),true,v_mirror.heating_costs,v_mirror.additional_costs,v_mirror.operating_costs,v_mirror.deposit,v_mirror.deposit_text,
          v_mirror.resolved_image_url,v_mirror.image_source,v_mirror.image_status,v_mirror.image_last_checked_at,v_mirror.image_error,
          v_mirror.enrichment_status,v_mirror.enrichment_checked_at,v_mirror.enrichment_error,v_mirror.enrichment_evidence,v_mirror.field_conflicts,v_mirror.enrichment_delivery_eligible,
          v_mirror.quality_status,v_mirror.quality_reason,v_mirror.warm_rent_is_calculated,v_mirror.fresh_delivery_eligible,v_mirror.latitude,v_mirror.longitude
        );
        v_inserted := v_inserted+1;
      else
        update public.listings
        set last_seen_at=now(),
            is_active=true
        where source_id=r.source_id
          and source_listing_key=v_key;
      end if;
    end loop;

    update app_private.coop_provider_index_requests
    set processed_at=now(),
        status_code=r.status_code,
        matched_count=v_matched,
        inserted_count=v_inserted,
        error=null
    where id=r.id;

    update public.listings p
    set is_active=false
    where p.source_id=r.source_id
      and p.is_active=true
      and p.raw ? 'provider_index'
      and not exists (
        select 1
        from public.listings m
        where m.id=(p.raw->'provider_index'->>'mirror_listing_id')::uuid
          and m.is_active=true
          and m.last_seen_at>=now()-interval '2 hours'
      );

    v_processed := v_processed+1;
  end loop;

  return v_processed;
end;
$function$


-- Replace legacy delivery gates with active/quality/dedupe/source-live checks.
drop trigger if exists delivery_events_enforce_current_only on public.delivery_events;
drop trigger if exists delivery_events_require_enriched_listing on public.delivery_events;
drop trigger if exists delivery_events_require_deliverable_listing on public.delivery_events;
create trigger delivery_events_require_deliverable_listing
before insert on public.delivery_events
for each row execute function app_private.require_deliverable_delivery_event();

drop trigger if exists listings_queue_delivery_on_fresh_enable on public.listings;
drop trigger if exists zz_guard_current_listing_delivery on public.listings;
drop trigger if exists zz_listings_enforce_current_source_freshness on public.listings;

drop trigger if exists listings_queue_delivery_v3 on public.listings;
create trigger listings_queue_delivery_v3
after insert on public.listings
for each row execute function app_private.queue_listing_delivery_v3();

drop trigger if exists listings_queue_delivery_on_reactivation on public.listings;
create trigger listings_queue_delivery_on_reactivation
after update of is_active on public.listings
for each row
when (old.is_active is distinct from true and new.is_active is true)
execute function app_private.queue_listing_delivery_v3();

drop trigger if exists listings_queue_delivery_when_wg_rent_arrives on public.listings;
create trigger listings_queue_delivery_when_wg_rent_arrives
after update of warm_rent,cold_rent on public.listings
for each row
when (
  new.source_id=6
  and new.is_active is true
  and old.warm_rent is null
  and old.cold_rent is null
  and (new.warm_rent is not null or new.cold_rent is not null)
)
execute function app_private.queue_listing_delivery_v3();

drop trigger if exists zzz_invalidate_listing_ingest_fingerprint on public.listings;
create trigger zzz_invalidate_listing_ingest_fingerprint
before update of
  source_id,source_listing_key,external_id,canonical_url,title,address,district,postal_code,city,
  warm_rent,cold_rent,additional_costs,operating_costs,heating_costs,deposit,deposit_text,
  rooms,area_sqm,available_from,property_type,furnished,wbs_required,image_url,cross_source_hash,
  raw,is_active
on public.listings
for each row
when (old.ingest_fingerprint is not null)
execute function app_private.invalidate_listing_ingest_fingerprint();

-- Remove obsolete delivery policy functions.
drop function if exists app_private.enforce_current_delivery_event();
drop function if exists app_private.require_enriched_delivery_event();
drop function if exists app_private.guard_current_listing_delivery();
drop function if exists app_private.enforce_current_source_freshness();
drop function if exists app_private.current_listing_is_delivery_fresh(bigint,jsonb,boolean);

comment on column public.listings.enrichment_delivery_eligible is
  'Legacy data-quality telemetry. Not used to decide listing delivery.';
comment on column public.listings.fresh_delivery_eligible is
  'Legacy freshness telemetry. Not used to decide listing delivery.';
comment on column public.sources.baseline_completed_at is
  'Crawl coverage telemetry only. Not used to decide listing delivery.';
