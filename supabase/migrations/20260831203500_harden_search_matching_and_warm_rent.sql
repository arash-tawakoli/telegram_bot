create or replace function app_private.enrich_listing_fields()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  txt text := coalesce(new.raw::text,'');
  m text[];
  room_candidate numeric;
begin
  if new.source_id=1 and new.cold_rent is null and new.warm_rent is null and new.raw->>'parser'='immoscout24_official_chatgpt_mcp' then
    begin new.cold_rent:=nullif(new.raw#>>'{entry,price,value}','')::numeric; exception when others then null; end;
  end if;
  if new.source_id in (6,10) and new.warm_rent is null and new.cold_rent is not null then
    new.warm_rent:=new.cold_rent;
    new.cold_rent:=null;
    new.warm_rent_is_calculated:=false;
  end if;

  if new.warm_rent is null then
    begin
      new.warm_rent:=coalesce(
        nullif(new.raw->>'warmRent','')::numeric,
        nullif(new.raw->>'totalRentGross','')::numeric,
        nullif(new.raw->>'totalRent','')::numeric,
        nullif(new.raw->>'grossRent','')::numeric,
        nullif(new.raw->>'monthlyTotalRent','')::numeric
      );
      if new.warm_rent is not null then new.warm_rent_is_calculated:=false; end if;
    exception when others then null;
    end;
  end if;

  if new.warm_rent is null then
    m:=regexp_match(txt,'(?i)(?:Warmmiete|Bruttowarmmiete|Bruttomiete|Gesamtmiete|Miete\s*warm|Miete\s*inkl\.?\s*(?:NK|Nebenkosten))[^0-9]{0,60}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)');
    if m is not null then new.warm_rent:=app_private.parse_eur(m[1]); new.warm_rent_is_calculated:=false; end if;
  end if;
  if new.warm_rent is null then
    m:=regexp_match(txt,'(?i)([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)\s*(?:€|EUR)?\s*(?:inkl\.?\s*(?:NK|Nebenkosten)|inklusive\s+Nebenkosten)');
    if m is not null then new.warm_rent:=app_private.parse_eur(m[1]); new.warm_rent_is_calculated:=false; end if;
  end if;
  if new.cold_rent is null then m:=regexp_match(txt,'(?i)(?:Nettokaltmiete|Kaltmiete|Grundmiete|Nettomiete|(?:^|Kosten[^A-Za-z]{0,20})Miete\s*:)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.cold_rent:=app_private.parse_eur(m[1]); end if; end if;
  if new.heating_costs is null then m:=regexp_match(txt,'(?i)(?:Heizkosten|Heizungskosten)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.heating_costs:=app_private.parse_eur(m[1]); end if; end if;
  if new.additional_costs is null then m:=regexp_match(txt,'(?i)(?:Nebenkosten|sonstige Kosten)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.additional_costs:=app_private.parse_eur(m[1]); end if; end if;
  if new.operating_costs is null then m:=regexp_match(txt,'(?i)(?:Betriebskosten|Betriebskostenvorauszahlung)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.operating_costs:=app_private.parse_eur(m[1]); end if; end if;
  if new.deposit is null then m:=regexp_match(txt,'(?i)(?:Kaution|Mietkaution|Mietsicherheit)[^0-9]{0,50}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.deposit:=app_private.parse_eur(m[1]); end if; end if;

  if new.rooms is null and new.source_id=6 then
    m:=regexp_match(coalesce(new.raw->>'text',''),'(?i)([0-9]+(?:[.,][0-9]+)?)\s*[-– ]?\s*Zimmer(?:-Wohnung)?');
    if m is not null then room_candidate:=replace(m[1],',','.')::numeric; if room_candidate between 0.5 and 20 then new.rooms:=room_candidate; end if; end if;
  end if;

  if new.warm_rent is null and new.cold_rent is not null and (new.additional_costs is not null or new.operating_costs is not null or new.heating_costs is not null) then
    new.warm_rent:=new.cold_rent+coalesce(new.additional_costs,new.operating_costs,0)+coalesce(new.heating_costs,0);
    new.warm_rent_is_calculated:=true;
  elsif new.warm_rent is not null and not coalesce(new.warm_rent_is_calculated,false) then
    new.warm_rent_is_calculated:=false;
  end if;

  if new.warm_rent is not null and new.cold_rent is not null and new.warm_rent<new.cold_rent then
    new.warm_rent:=null;
    new.warm_rent_is_calculated:=false;
  end if;
  return new;
end;
$function$;

create or replace function app_private.queue_listing_delivery_v3()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_group uuid;
  v_primary boolean;
  v_source_ready boolean;
  v_haystack text := lower(concat_ws(' ',new.property_type,new.title,new.district,new.address,new.raw::text));
begin
  if tg_op='UPDATE' and new.source_id=3 and not coalesce(old.fresh_delivery_eligible,false) and coalesce(new.fresh_delivery_eligible,false) then return new; end if;
  if new.quality_status='rejected' or not coalesce(new.enrichment_delivery_eligible,true) then return new; end if;
  if not coalesce(new.fresh_delivery_eligible,false) then return new; end if;

  -- Reject obvious wanted ads, but do not reject normal "Nachmieter gesucht" offers.
  if v_haystack ~ '(^|[[:space:]])(ich|wir)[[:space:]]+suche(n)?[[:space:]].{0,40}(wohnung|apartment|wg-zimmer|zimmer|haus)'
     or v_haystack ~ '[[:space:]]sucht[[:space:]]+(dringend[[:space:]]+)?(eine[nr]?[[:space:]]+)?(wohnung|apartment|wg-zimmer|zimmer|haus)'
     or v_haystack ~ '^[[:space:]]*(wohnung|apartment|wg-zimmer|zimmer|haus)[[:space:]]+gesucht' then
    return new;
  end if;

  select (s.enabled and s.runtime_mode='live' and s.delivery_mode='live')
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
  from public.search_profiles p
  join public.bot_users u on u.id=p.user_id
  where p.is_active=true and u.is_active=true
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
      or (
        coalesce(nullif(new.warm_rent,0),nullif(new.cold_rent,0)) is not null
        and coalesce(nullif(new.warm_rent,0),nullif(new.cold_rent,0))<=p.max_warm_rent
      )
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
          where lower(concat_ws(' ',new.district,new.address,new.title,new.raw::text)) like '%'||lower(n)||'%'
        )
      )
      or (
        p.location_mode='boroughs'
        and exists(
          select 1
          from public.hamburg_neighborhoods hn
          join public.hamburg_boroughs hb on hb.id=hn.borough_id
          where hb.name=any(p.boroughs)
            and lower(concat_ws(' ',new.district,new.address,new.title,new.raw::text)) like '%'||lower(hn.name)||'%'
        )
      )
      or (
        coalesce(cardinality(p.districts),0)>0
        and (
          'Ganz Hamburg'=any(p.districts)
          or exists(
            select 1 from unnest(p.districts) d
            where lower(concat_ws(' ',new.district,new.address,new.title,new.raw::text)) like '%'||lower(d)||'%'
          )
        )
      )
    )
  on conflict do nothing;
  return new;
end;
$function$;
