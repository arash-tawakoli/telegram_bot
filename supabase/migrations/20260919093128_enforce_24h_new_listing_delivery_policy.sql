CREATE OR REPLACE FUNCTION app_private.delivery_newness_qualified(p_listing_id uuid, p_as_of timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v record;
  v_label text;
  v_local timestamp;
  v_match text[];
  v_day date;
  v_pub timestamptz;
begin
  select
    l.source_id,
    l.first_seen_at,
    l.fresh_delivery_eligible,
    l.raw,
    l.enrichment_evidence,
    s.baseline_completed_at
  into v
  from public.listings l
  join public.sources s on s.id=l.source_id
  where l.id=p_listing_id;

  if not found then return false; end if;

  if v.baseline_completed_at is null
     or v.first_seen_at is null
     or v.first_seen_at < p_as_of - interval '24 hours'
     or v.first_seen_at > p_as_of + interval '5 minutes'
  then
    return false;
  end if;

  if v.source_id=2 then
    if coalesce(v.raw->>'lane','') <> 'fast'
       or not coalesce(v.fresh_delivery_eligible,false)
    then
      return false;
    end if;

    v_label := btrim(coalesce(v.raw->>'sorting_date',''));
    v_local := p_as_of at time zone 'Europe/Berlin';

    v_match := regexp_match(v_label,'^Heute,[[:space:]]*([0-9]{1,2}):([0-9]{2})$','i');
    if v_match is not null then
      v_day := v_local::date;
    else
      v_match := regexp_match(v_label,'^Gestern,[[:space:]]*([0-9]{1,2}):([0-9]{2})$','i');
      if v_match is null then return false; end if;
      v_day := v_local::date - 1;
    end if;

    begin
      v_pub := make_timestamptz(
        extract(year from v_day)::int,
        extract(month from v_day)::int,
        extract(day from v_day)::int,
        v_match[1]::int,
        v_match[2]::int,
        0,
        'Europe/Berlin'
      );
    exception when others then
      return false;
    end;

    return v_pub >= p_as_of - interval '24 hours'
       and v_pub <= p_as_of + interval '5 minutes';
  end if;

  if v.source_id=1 then
    return coalesce(v.fresh_delivery_eligible,false)
       and coalesce(v.raw->>'delivery_lane','') in ('fresh_global','fresh_borough');
  end if;

  if not coalesce(v.fresh_delivery_eligible,false) then
    return false;
  end if;

  v_label := nullif(btrim(coalesce(v.enrichment_evidence#>>'{preview,facts,published_text}','')),'');
  if v_label is not null then
    if v_label ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      begin
        return to_date(v_label,'YYYY-MM-DD') = (p_as_of at time zone 'Europe/Berlin')::date;
      exception when others then
        return false;
      end;
    elsif v_label ~ '^[0-9]{2}\.[0-9]{2}\.[0-9]{4}$' then
      begin
        return to_date(v_label,'DD.MM.YYYY') = (p_as_of at time zone 'Europe/Berlin')::date;
      exception when others then
        return false;
      end;
    elsif v_label ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      begin
        v_pub := v_label::timestamptz;
        return v_pub >= p_as_of - interval '24 hours'
           and v_pub <= p_as_of + interval '5 minutes';
      exception when others then
        return false;
      end;
    end if;
  end if;

  return true;
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

  if not found then return null; end if;

  if not coalesce(v_listing.is_active,false)
     or not coalesce(v_listing.is_primary_listing,false)
     or coalesce(v_listing.quality_status,'unchecked')='rejected'
     or not coalesce(v_listing.source_enabled,false)
     or v_listing.runtime_mode<>'live'
     or v_listing.delivery_mode<>'live'
  then
    return null;
  end if;

  if coalesce(new.event_type,'new_listing')='new_listing'
     and not app_private.delivery_newness_qualified(new.listing_id,statement_timestamp())
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
          when not coalesce(s.enabled,false) or s.runtime_mode<>'live' or s.delivery_mode<>'live'
            then 'source not live blocked by delivery guard'
          else 'listing is not qualified as <=24h new inventory'
        end
    from public.listings l
    join public.sources s on s.id=l.source_id
    where l.id=de.listing_id
      and de.status in ('pending','failed')
      and coalesce(de.delivery_outcome_unknown,false)=false
      and (
        not coalesce(l.is_active,false)
        or coalesce(l.quality_status,'unchecked')='rejected'
        or not coalesce(l.is_primary_listing,false)
        or not coalesce(s.enabled,false)
        or s.runtime_mode<>'live'
        or s.delivery_mode<>'live'
        or (
          coalesce(de.event_type,'new_listing')='new_listing'
          and not app_private.delivery_newness_qualified(l.id,statement_timestamp())
        )
      )
    returning de.id
  )
  select count(*) into v_count from stopped;

  return v_count;
end;
$function$


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

  select l.is_primary_listing into v_primary
  from public.listings l
  where l.id=new.id;

  if not coalesce(v_primary,false) or v_group is null then
    return new;
  end if;

  if not app_private.delivery_newness_qualified(new.id,statement_timestamp()) then
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
          select 1 from unnest(p.neighborhoods) n
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
            select 1 from unnest(p.districts) d
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


CREATE OR REPLACE FUNCTION app_private.enqueue_matched_application()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if coalesce(new.event_type,'new_listing') <> 'new_listing'
     or not app_private.delivery_newness_qualified(new.listing_id,statement_timestamp())
  then
    return new;
  end if;

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


comment on function app_private.delivery_newness_qualified(uuid,timestamptz) is
'Qualifies only genuinely new <=24h listings for new-listing delivery. Kleinanzeigen and ImmoScout coverage lanes are excluded; other sources require an initialized baseline plus source-worker delivery eligibility.';
