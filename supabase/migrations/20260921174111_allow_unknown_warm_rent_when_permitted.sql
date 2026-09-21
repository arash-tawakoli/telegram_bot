create or replace function app_private.matches_property_filters(p public.search_profiles, l public.listings)
returns boolean
language plpgsql
stable
set search_path to ''
as $function$
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

    if v_price is not null and v_price>p.max_warm_rent then
      return false;
    end if;

    if v_price is null
       and coalesce(p.require_known_warm_rent,false)=false
       and coalesce(nullif(l.cold_rent,0),0)>p.max_warm_rent then
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
$function$;
