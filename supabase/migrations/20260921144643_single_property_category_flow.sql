-- Single-category search profiles and strict residential category classification.

-- Function bodies are normalized to the final production definitions for replay safety.

CREATE OR REPLACE FUNCTION app_private.classify_listing_category(p_source_id bigint, p_property_type text, p_property_kind text, p_offer_mode text, p_title text, p_raw jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_caps jsonb := '{}'::jsonb;
  v_c jsonb := coalesce(p_raw,'{}'::jsonb)->'_classification';
  v_text text := lower(concat_ws(' ',
    coalesce(p_title,''),
    coalesce(p_raw->>'text',''),
    coalesce(p_raw->>'alt',''),
    coalesce(p_raw->>'query',''),
    coalesce(p_raw#>>'{entry,title}','')
  ));
  v_kind text := null;
  v_mode text := null;
  v_category text := null;
  v_kind_evidence text := null;
  v_mode_evidence text := null;
  v_kinds jsonb := '[]'::jsonb;
  v_modes jsonb := '[]'::jsonb;
begin
  select coalesce(search_capabilities,'{}'::jsonb)
    into v_caps
  from public.sources
  where id=p_source_id;

  v_kinds:=coalesce(v_caps->'configured_kinds','[]'::jsonb);
  v_modes:=coalesce(v_caps->'offer_modes','[]'::jsonb);

  if coalesce(v_c->>'version','') in ('1','3')
     and v_c->>'kind' in ('apartment','house','room')
     and v_c->>'mode' in ('rent','swap','sale','wanted') then
    v_kind:=v_c->>'kind';
    v_mode:=v_c->>'mode';
    v_kind_evidence:='source_classification';
    v_mode_evidence:='source_classification';
  else
    if coalesce(p_offer_mode,'') in ('sale','wanted') then
      v_mode:=p_offer_mode;
      v_mode_evidence:='stored_mode';
    elsif v_text ~ '(^|[[:space:]])(ich|wir)[[:space:]]+suche(n)?[[:space:]].{0,50}(wohnung|apartment|wg[[:space:]-]*zimmer|zimmer|haus)'
       or v_text ~ '(^|[[:space:]])(wohnung|apartment|wg[[:space:]-]*zimmer|zimmer|haus)[[:space:]]+gesucht([[:space:]]|$)'
       or v_text ~ '^[[:space:]]*suche[[:space:]]+(eine[nrsm]?[[:space:]]+|nach[[:space:]]+)?(wohnung|apartment|wg[[:space:]-]*zimmer|zimmer|haus)([[:space:]]|$)' then
      v_mode:='wanted';
      v_mode_evidence:='text_wanted';
    elsif v_text ~ '(^|[[:space:]])(zum[[:space:]]+kauf|kaufpreis|zu[[:space:]]+verkaufen|verkauf|mietkauf|erbpacht)([[:space:]]|$)' then
      v_mode:='sale';
      v_mode_evidence:='text_sale';
    elsif p_property_type='Tauschwohnung'
       or p_offer_mode='swap'
       or (
         v_text ~ '(tauschwohnung|tauschangebot|wohnungstausch|wohnung[[:space:]-]*tausch|(^|[[:space:]])tausche([[:space:]]|$))'
         and v_text !~ '(kein(e|en)?|ohne)[[:space:]]+(tauschwohnung|wohnungstausch|tausch)'
       ) then
      v_mode:='swap';
      v_mode_evidence:=case
        when p_property_type='Tauschwohnung' then 'stored_category'
        when p_offer_mode='swap' then 'stored_mode'
        else 'text_swap'
      end;
    elsif p_offer_mode='rent' then
      v_mode:='rent';
      v_mode_evidence:='stored_mode';
    elsif jsonb_array_length(v_modes)=1 and v_modes->>0 in ('rent','swap') then
      v_mode:=v_modes->>0;
      v_mode_evidence:='source_scope';
    elsif upper(coalesce(p_raw#>>'{entry,price,marketingType}',''))='RENT'
       or v_text ~ '(^|[[:space:]])(zur[[:space:]]+miete|vermietung|vermiete|mieten|untermiete)([[:space:]]|$)' then
      v_mode:='rent';
      v_mode_evidence:='text_rent';
    else
      v_mode:='unknown';
      v_mode_evidence:='insufficient';
    end if;

    if coalesce(p_property_kind,'') in ('apartment','house','room') then
      v_kind:=p_property_kind;
      v_kind_evidence:='stored_kind';
    elsif coalesce(p_raw->>'category_stream','')='room' then
      v_kind:='room';
      v_kind_evidence:='room_stream';
    elsif coalesce(p_raw->>'category_stream','')='house' then
      v_kind:='house';
      v_kind_evidence:='house_stream';
    elsif v_text ~ '(wg[[:space:]-]*zimmer|zimmer[[:space:]]+in[[:space:]]+(einer[[:space:]]+)?wg|zimmer.{0,60}[0-9]+er.{0,24}wg|privatzimmer|untermietzimmer|mitbewohner(in)?([[:space:]]|$))' then
      v_kind:='room';
      v_kind_evidence:='text_room';
    elsif v_text ~ '(^|[^[:alnum:]])(einfamilienhaus|reihenhaus|doppelhaus|doppelhaushälfte|bungalow|villa|stadthaus|haus[[:space:]]+zur[[:space:]]+miete|haus[[:space:]]+mieten)([^[:alnum:]]|$)' then
      v_kind:='house';
      v_kind_evidence:='text_house';
    elsif v_text ~ '(wohnung|whg([.]|[[:space:]]|$)|apartment|penthouse|maisonette|loft|studio|etagenwohnung|terrassenwohnung|dachgeschosswohnung)' then
      v_kind:='apartment';
      v_kind_evidence:='text_apartment';
    elsif p_property_type in ('Wohnung','Haus','WG') then
      v_kind:=case p_property_type
        when 'Wohnung' then 'apartment'
        when 'Haus' then 'house'
        else 'room'
      end;
      v_kind_evidence:='stored_category';
    elsif p_property_type='Tauschwohnung' then
      if jsonb_array_length(v_kinds)=1 and v_kinds->>0 in ('apartment','house','room') then
        v_kind:=v_kinds->>0;
        v_kind_evidence:='source_scope';
      else
        v_kind:='apartment';
        v_kind_evidence:='stored_category';
      end if;
    elsif jsonb_array_length(v_kinds)=1 and v_kinds->>0 in ('apartment','house','room') then
      v_kind:=v_kinds->>0;
      v_kind_evidence:='source_scope';
    else
      v_kind:='unknown';
      v_kind_evidence:='insufficient';
    end if;
  end if;

  v_category:=case
    when v_mode='swap' and v_kind in ('apartment','house','room') then 'Tauschwohnung'
    when v_mode='rent' and v_kind='apartment' then 'Wohnung'
    when v_mode='rent' and v_kind='house' then 'Haus'
    when v_mode='rent' and v_kind='room' then 'WG'
    else null
  end;

  return jsonb_build_object(
    'version',3,
    'kind',coalesce(v_kind,'unknown'),
    'mode',coalesce(v_mode,'unknown'),
    'category',v_category,
    'kind_evidence',coalesce(v_kind_evidence,'insufficient'),
    'mode_evidence',coalesce(v_mode_evidence,'insufficient')
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION app_private.apply_property_classification()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  c jsonb;
begin
  if tg_op='UPDATE' and old.raw?'category_stream' and not new.raw?'category_stream' then
    new.raw:=coalesce(new.raw,'{}'::jsonb)||jsonb_build_object(
      'category_stream',old.raw->'category_stream',
      '_newness',old.raw->'_newness'
    );
    new.fresh_delivery_eligible:=old.fresh_delivery_eligible;
  end if;

  c:=app_private.classify_listing_category(
    new.source_id,new.property_type,new.property_kind,new.offer_mode,new.title,new.raw
  );

  new.property_kind:=coalesce(c->>'kind','unknown');
  new.offer_mode:=coalesce(c->>'mode','unknown');
  new.property_type:=c->>'category';
  new.raw:=coalesce(new.raw,'{}'::jsonb)||jsonb_build_object('_classification',c);

  if new.offer_mode in ('sale','wanted') then
    new.is_active:=false;
    new.quality_status:='rejected';
    new.quality_reason:='not_a_residential_rental_offer';
  elsif new.quality_reason='not_a_residential_rental_offer' then
    new.quality_status:='unchecked';
    new.quality_reason:=null;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION app_private.matches_property_category(p_types text[], p_kind text, p_mode text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    cardinality(p_types)=1
    and p_types[1] = case
      when p_mode='swap' and p_kind in ('apartment','house','room') then 'Tauschwohnung'
      when p_mode='rent' and p_kind='apartment' then 'Wohnung'
      when p_mode='rent' and p_kind='house' then 'Haus'
      when p_mode='rent' and p_kind='room' then 'WG'
      else null
    end,
    false
  );
$function$
;

CREATE OR REPLACE FUNCTION app_private.matches_property_filters(p search_profiles, l listings)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  c jsonb;
  v_category text;
  v_price numeric;
  v_haystack text;
  v_location_ok boolean:=false;
begin
  if cardinality(p.property_types)<>1
     or p.property_types[1] not in ('Wohnung','Haus','WG','Tauschwohnung') then
    return false;
  end if;

  c:=app_private.classify_listing_category(
    l.source_id,l.property_type,l.property_kind,l.offer_mode,l.title,l.raw
  );
  v_category:=c->>'category';

  if v_category is null or v_category<>p.property_types[1] then
    return false;
  end if;

  if p.max_warm_rent is not null then
    v_price:=nullif(l.warm_rent,0);
    if v_price is null or v_price>p.max_warm_rent then
      return false;
    end if;
  end if;

  if coalesce(p.require_known_warm_rent,false) and coalesce(l.warm_rent,0)<=0 then
    return false;
  end if;

  if p.max_deposit is not null and (l.deposit is null or l.deposit>p.max_deposit) then
    return false;
  end if;

  if p.wbs_only and l.wbs_required is distinct from true then
    return false;
  end if;

  if p.furnished_preference='yes' and l.furnished is distinct from true then
    return false;
  elsif p.furnished_preference='no' and l.furnished is distinct from false then
    return false;
  end if;

  if v_category='WG' then
    if coalesce(p.min_room_area_sqm,0)>0
       and (l.area_sqm is null or l.area_sqm<p.min_room_area_sqm) then
      return false;
    end if;
  else
    if coalesce(p.min_rooms,0)>0
       and (l.rooms is null or l.rooms<p.min_rooms) then
      return false;
    end if;
    if coalesce(p.min_area_sqm,0)>0
       and (l.area_sqm is null or l.area_sqm<p.min_area_sqm) then
      return false;
    end if;
  end if;

  v_haystack:=lower(concat_ws(' ',l.district,l.address,l.title,l.raw::text));

  v_location_ok :=
    p.location_mode='all_hamburg'
    or (p.location_mode='boroughs' and coalesce(cardinality(p.boroughs),0)>=7)
    or (
      p.location_mode='neighborhoods'
      and exists(
        select 1 from unnest(p.neighborhoods) n
        where v_haystack like '%'||lower(n)||'%'
      )
    )
    or (
      p.location_mode='boroughs'
      and exists(
        select 1
        from public.hamburg_neighborhoods hn
        join public.hamburg_boroughs hb on hb.id=hn.borough_id
        where hb.name=any(p.boroughs)
          and v_haystack like '%'||lower(hn.name)||'%'
      )
    )
    or (
      coalesce(cardinality(p.districts),0)>0
      and (
        'Ganz Hamburg'=any(p.districts)
        or exists(
          select 1 from unnest(p.districts) d
          where v_haystack like '%'||lower(d)||'%'
        )
      )
    );

  return coalesce(v_location_ok,false);
end;
$function$
;

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
    and app_private.matches_property_filters(p,new)
  on conflict do nothing;

  return new;
end;
$function$
;

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
          when not coalesce(p.is_active,false) then 'inactive search profile blocked by delivery guard'
          when p.profile_slot>1 and not app_private.user_is_premium(p.user_id) then 'profile slot requires premium'
          when not coalesce(l.is_active,false) then 'inactive listing blocked by delivery guard'
          when coalesce(l.quality_status,'unchecked')='rejected' then 'rejected listing blocked by delivery guard'
          when not coalesce(l.is_primary_listing,false) then 'deduplicated listing blocked by delivery guard'
          when not coalesce(s.enabled,false) or s.runtime_mode<>'live' or s.delivery_mode<>'live'
            then 'source not live blocked by delivery guard'
          when not app_private.matches_property_filters(p,l)
            then 'listing no longer matches current profile/category filters'
          else 'listing is not qualified as <=24h new inventory'
        end
    from public.listings l, public.sources s, public.search_profiles p
    where l.id=de.listing_id
      and s.id=l.source_id
      and p.id=de.profile_id
      and de.status in ('pending','failed')
      and coalesce(de.delivery_outcome_unknown,false)=false
      and (
        not coalesce(p.is_active,false)
        or (p.profile_slot>1 and not app_private.user_is_premium(p.user_id))
        or not coalesce(l.is_active,false)
        or coalesce(l.quality_status,'unchecked')='rejected'
        or not coalesce(l.is_primary_listing,false)
        or not coalesce(s.enabled,false)
        or s.runtime_mode<>'live'
        or s.delivery_mode<>'live'
        or not app_private.matches_property_filters(p,l)
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
;

CREATE OR REPLACE FUNCTION public.validate_immomio_application_send(p_id uuid, p_token uuid, p_user uuid, p_listing uuid, p_source_identifier uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(
  select 1
  from public.applications a
  join public.listings l on l.id=a.listing_id
  join public.sources s on s.id=l.source_id
  join public.bot_users u on u.id=a.user_id
  join app_private.application_send_keys k
    on k.application_id=a.id
   and k.user_id=a.user_id
   and k.provider='immomio'
   and k.source_identifier=p_source_identifier
  cross join lateral(select app_private.immomio_application_target(l.raw,l.canonical_url) target)t
  where a.id=p_id
    and a.user_id=p_user
    and a.listing_id=p_listing
    and a.lease_token=p_token
    and a.lease_until>now()
    and a.status='processing'
    and a.submission_started_at is not null
    and t.target->>'status'='resolved'
    and (t.target->>'source_identifier')::uuid=p_source_identifier
    and u.is_active
    and u.auto_apply_enabled
    and app_private.user_is_premium(u.id)
    and app_private.applicant_profile_complete(u.id)
    and app_private.application_target_ready(u.id,l.source_id,l.raw,l.canonical_url)
    and app_private.application_listing_auto_apply_allowed(l.title,l.property_type,l.raw)
    and l.is_active
    and coalesce(l.is_primary_listing,false)
    and coalesce(l.quality_status,'unchecked')<>'rejected'
    and s.enabled
    and s.runtime_mode='live'
    and s.delivery_mode='live'
    and app_private.delivery_newness_qualified(l.id,statement_timestamp())
    and exists(
      select 1
      from public.delivery_events d
      join public.search_profiles p on p.id=d.profile_id
      where d.listing_id=l.id
        and d.recipient_user_id=u.id
        and d.event_type='new_listing'
        and d.status in ('pending','processing','sent')
        and p.user_id=u.id
        and p.is_active
        and app_private.matches_property_filters(p,l)
    )
 );
$function$
;

CREATE OR REPLACE FUNCTION public.save_search_profile_ui(p_user uuid, p_update_id bigint, p_attempt integer, p_values jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  u public.bot_users%rowtype;
  v public.search_profiles%rowtype;
  slot integer;
  types text[];
  v_type text;
  v_min_rooms numeric;
  v_min_area numeric;
  v_min_room_area numeric;
  v_furnished text;
  reward jsonb;
begin
  select * into u from public.bot_users where id=p_user for update;
  if not found
     or not u.is_active
     or not exists(
       select 1 from public.bot_events
       where telegram_update_id=p_update_id
         and telegram_user_id=u.telegram_user_id
         and processing_status='processing'
         and processing_attempt=p_attempt
     ) then
    raise exception 'ui_lease_lost';
  end if;

  if jsonb_typeof(p_values)<>'object' or octet_length(p_values::text)>24000 then
    raise exception 'invalid_profile';
  end if;

  slot:=coalesce((p_values->>'profile_slot')::integer,1);
  if slot<1 or slot>(case when app_private.user_is_premium(p_user) then 4 else 1 end) then
    raise exception 'profile_slot_not_allowed';
  end if;

  if coalesce(p_values->>'_flow','')!~'^[a-f0-9]{12}$' then
    raise exception 'ui_state_changed';
  end if;
  if coalesce(u.onboarding_state->>'_flow','')<>coalesce(p_values->>'_flow','')
     or coalesce(u.onboarding_state->>'_revision','0')<>coalesce(p_values->>'_revision','0') then
    raise exception 'ui_state_changed';
  end if;

  if coalesce(jsonb_typeof(p_values->'property_types'),'')<>'array' then
    raise exception 'invalid_property_types';
  end if;
  if jsonb_array_length(p_values->'property_types')<>1 then
    raise exception 'invalid_property_types';
  end if;

  v_type:=p_values#>>'{property_types,0}';
  if v_type not in ('Wohnung','Haus','WG','Tauschwohnung') then
    raise exception 'invalid_property_types';
  end if;
  types:=array[v_type];

  if (p_values->>'max_warm_rent') is null
     or (p_values->>'max_warm_rent')::numeric not between 100 and 5000 then
    raise exception 'invalid_profile_limits';
  end if;

  if v_type='WG' then
    v_min_rooms:=0;
    v_min_area:=0;
    v_min_room_area:=coalesce((p_values->>'min_room_area_sqm')::numeric,0);
    if v_min_room_area not between 0 and 300 then
      raise exception 'invalid_profile_limits';
    end if;
  else
    v_min_rooms:=(p_values->>'min_rooms')::numeric;
    v_min_area:=(p_values->>'min_area_sqm')::numeric;
    v_min_room_area:=0;
    if v_min_rooms is null or v_min_rooms not between 1 and 20
       or v_min_area is null or v_min_area not between 1 and 1000 then
      raise exception 'invalid_profile_limits';
    end if;
  end if;

  if p_values->>'location_mode' not in ('all_hamburg','boroughs','neighborhoods')
     or p_values->>'location_mode' is null then
    raise exception 'invalid_profile_location';
  end if;
  if (p_values->>'location_mode'='boroughs'
      and jsonb_array_length(coalesce(p_values->'boroughs','[]'::jsonb))=0)
     or (p_values->>'location_mode'='neighborhoods'
      and jsonb_array_length(coalesce(p_values->'neighborhoods','[]'::jsonb))=0) then
    raise exception 'invalid_profile_location';
  end if;

  select * into v
  from public.search_profiles
  where user_id=p_user and profile_slot=slot
  for update;

  v_furnished:=case
    when p_values?'furnished_preference' then
      case p_values->>'furnished_preference'
        when 'furnished' then 'yes'
        when 'unfurnished' then 'no'
        when 'yes' then 'yes'
        when 'no' then 'no'
        else 'any'
      end
    else coalesce(v.furnished_preference,'any')
  end;

  insert into public.search_profiles(
    user_id,profile_slot,name,property_types,location_mode,districts,boroughs,neighborhoods,
    max_warm_rent,min_rooms,min_area_sqm,min_room_area_sqm,wbs_only,furnished_preference,
    require_known_warm_rent,max_deposit,updated_at
  )
  values(
    p_user,slot,coalesce(v.name,case when slot=1 then 'Meine Suche' else 'Meine Suche '||slot end),
    types,p_values->>'location_mode',
    array(select jsonb_array_elements_text(coalesce(p_values->'districts','[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(p_values->'boroughs','[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(p_values->'neighborhoods','[]'::jsonb))),
    (p_values->>'max_warm_rent')::numeric,v_min_rooms,v_min_area,v_min_room_area,
    case when p_values?'wbs_only' then (p_values->>'wbs_only')::boolean else coalesce(v.wbs_only,false) end,
    v_furnished,
    case when p_values?'require_known_warm_rent' then (p_values->>'require_known_warm_rent')::boolean else coalesce(v.require_known_warm_rent,false) end,
    case when p_values?'max_deposit' then (p_values->>'max_deposit')::numeric else v.max_deposit end,
    now()
  )
  on conflict(user_id,profile_slot) do update set
    property_types=excluded.property_types,
    location_mode=excluded.location_mode,
    districts=excluded.districts,
    boroughs=excluded.boroughs,
    neighborhoods=excluded.neighborhoods,
    max_warm_rent=excluded.max_warm_rent,
    min_rooms=excluded.min_rooms,
    min_area_sqm=excluded.min_area_sqm,
    min_room_area_sqm=excluded.min_room_area_sqm,
    wbs_only=excluded.wbs_only,
    furnished_preference=excluded.furnished_preference,
    require_known_warm_rent=excluded.require_known_warm_rent,
    max_deposit=excluded.max_deposit,
    updated_at=now();

  update public.bot_users
  set onboarding_step=null,onboarding_state='{}',updated_at=now()
  where id=p_user;

  reward:=public.complete_referral_reward(p_user);
  return coalesce(reward,'{}');
end;
$function$
;


do $$
begin
  if exists(
    select 1
    from public.search_profiles
    where cardinality(property_types)>0
      and not property_types<@array['Wohnung','Haus','WG','Tauschwohnung']::text[]
  ) then
    raise exception 'cannot migrate invalid existing property_types';
  end if;

  if exists(
    select 1
    from public.search_profiles
    group by user_id
    having sum(cardinality(property_types))>4
  ) then
    raise exception 'cannot split existing profiles into four slots';
  end if;
end;
$$;

create temporary table _tw_profile_split_plan on commit drop as
with multi as (
  select * from public.search_profiles where cardinality(property_types)>1
),
extras as (
  select
    p.id as original_id,
    p.user_id,
    t.category,
    row_number() over(partition by p.user_id order by p.profile_slot,t.ord) as rn
  from multi p
  cross join lateral unnest(p.property_types) with ordinality as t(category,ord)
  where t.ord>1
),
free_slots as (
  select
    u.user_id,
    gs::smallint as new_slot,
    row_number() over(partition by u.user_id order by gs) as rn
  from (select distinct user_id from multi) u
  cross join generate_series(1,4) gs
  where not exists(
    select 1 from public.search_profiles p
    where p.user_id=u.user_id and p.profile_slot=gs
  )
)
select e.original_id,e.user_id,e.category,f.new_slot
from extras e
join free_slots f using(user_id,rn);

do $$
declare
  v_extras integer;
  v_planned integer;
begin
  select coalesce(sum(greatest(cardinality(property_types)-1,0)),0)
    into v_extras
  from public.search_profiles;
  select count(*) into v_planned from _tw_profile_split_plan;
  if v_extras<>v_planned then
    raise exception 'profile split plan incomplete: % extras, % planned',v_extras,v_planned;
  end if;
end;
$$;

insert into public.search_profiles(
  user_id,name,max_warm_rent,min_rooms,min_area_sqm,districts,property_types,
  furnished_preference,wbs_only,move_in_from,is_active,created_at,updated_at,
  location_mode,boroughs,neighborhoods,profile_slot,max_deposit,require_known_warm_rent,min_room_area_sqm
)
select
  p.user_id,
  p.name||' · '||sp.category,
  p.max_warm_rent,
  case when sp.category='WG' then 0 else p.min_rooms end,
  case when sp.category='WG' then 0 else p.min_area_sqm end,
  p.districts,
  array[sp.category]::text[],
  p.furnished_preference,
  p.wbs_only,
  p.move_in_from,
  p.is_active,
  p.created_at,
  now(),
  p.location_mode,
  p.boroughs,
  p.neighborhoods,
  sp.new_slot,
  p.max_deposit,
  p.require_known_warm_rent,
  case when sp.category='WG' then p.min_room_area_sqm else 0 end
from _tw_profile_split_plan sp
join public.search_profiles p on p.id=sp.original_id;

update public.search_profiles p
set
  name=p.name||' · '||p.property_types[1],
  property_types=array[p.property_types[1]]::text[],
  min_rooms=case when p.property_types[1]='WG' then 0 else p.min_rooms end,
  min_area_sqm=case when p.property_types[1]='WG' then 0 else p.min_area_sqm end,
  min_room_area_sqm=case when p.property_types[1]='WG' then p.min_room_area_sqm else 0 end,
  updated_at=now()
where cardinality(p.property_types)>1;

update public.search_profiles
set min_rooms=0,min_area_sqm=0,updated_at=now()
where property_types[1]='WG'
  and (coalesce(min_rooms,0)<>0 or coalesce(min_area_sqm,0)<>0);

update public.search_profiles
set min_room_area_sqm=0,updated_at=now()
where property_types[1]<>'WG'
  and coalesce(min_room_area_sqm,0)<>0;

update public.bot_users b
set onboarding_state=jsonb_set(
      b.onboarding_state,
      '{property_types}',
      coalesce(
        (
          select jsonb_build_array(x.value)
          from jsonb_array_elements_text(b.onboarding_state->'property_types') with ordinality x(value,ord)
          where x.value in ('Wohnung','Haus','WG','Tauschwohnung')
          order by x.ord
          limit 1
        ),
        '[]'::jsonb
      ),
      true
    ),
    updated_at=now()
where jsonb_typeof(b.onboarding_state->'property_types')='array'
  and jsonb_array_length(b.onboarding_state->'property_types')>1;

alter table public.search_profiles
  drop constraint if exists search_profiles_single_property_type_check;

alter table public.search_profiles
  add constraint search_profiles_single_property_type_check
  check (
    cardinality(property_types)=1
    and property_types[1]=any(array['Wohnung','Haus','WG','Tauschwohnung']::text[])
  ) not valid;

alter table public.search_profiles
  validate constraint search_profiles_single_property_type_check;

drop function if exists app_private.queue_unknown_rent_listing();

comment on constraint search_profiles_single_property_type_check on public.search_profiles
  is 'Each search profile targets exactly one category: Wohnung, Haus, WG or Tauschwohnung.';
