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
  v_provider text := lower(coalesce(p_raw->>'provider',''));
  v_stream text := lower(coalesce(p_raw->>'category_stream',''));
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

  -- Only trust the current classifier cache. Older versions are
  -- intentionally recomputed so fresh matching benefits from v4.
  if coalesce(v_c->>'version','')='4'
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
         v_text ~ '(tauschwohnung|tauschangebot|wohnungstausch|wohnung[[:space:]-]*tausch|(^|[[:space:]])tausche([[:space:]]|$)|(^|[[:space:]])tauschen([[:space:]]|$)|nur[[:space:]]+tauschen)'
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
       or v_text ~ '(^|[[:space:]])(zur[[:space:]]+miete|vermietung|vermiete|mieten|untermiete|zwischenmiete)([[:space:]]|$)' then
      v_mode:='rent';
      v_mode_evidence:='text_rent';
    else
      v_mode:='unknown';
      v_mode_evidence:='insufficient';
    end if;

    if coalesce(p_property_kind,'') in ('apartment','house','room') then
      v_kind:=p_property_kind;
      v_kind_evidence:='stored_kind';
    elsif v_stream='room' then
      v_kind:='room';
      v_kind_evidence:='room_stream';
    elsif v_stream='house' then
      v_kind:='house';
      v_kind_evidence:='house_stream';
    elsif v_text ~ '(wg[[:space:]-]*zimmer|zimmer[[:space:]]+in[[:space:]]+(einer[[:space:]]+)?wg|zimmer.{0,60}[0-9]+er.{0,24}wg|privatzimmer|untermietzimmer|mitbewohner(in)?([[:space:]]|$)|zimmer.{0,40}gemeinschafts(küche|bad))' then
      v_kind:='room';
      v_kind_evidence:='text_room';
    elsif v_text ~ '(^|[^[:alnum:]])(einfamilienhaus|reihenhaus|doppelhaus|doppelhaushälfte|bungalow|villa|stadthaus|haus[[:space:]]+zur[[:space:]]+miete|haus[[:space:]]+mieten)([^[:alnum:]]|$)' then
      v_kind:='house';
      v_kind_evidence:='text_house';
    elsif v_text ~ '(wohnung|whg([^[:alnum:]]|$)|zi[.]?[[:space:]-]*whg([^[:alnum:]]|$)|zimmerwohnung|apartment|appartment|penthouse|maisonette|loft|studio|etagenwohnung|terrassenwohnung|dachgeschosswohnung|erdgeschosswohnung)' then
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
    elsif v_provider='kleinanzeigen'
       and coalesce((p_raw->>'native_offer')::boolean,false)
       and v_stream='' then
      -- The default Kleinanzeigen rental lane is the apartment lane.
      -- Explicit house/room evidence above always wins.
      v_kind:='apartment';
      v_kind_evidence:='provider_default_apartment';
    elsif v_provider='wunderflats_catalog' then
      -- Wunderflats generic titles are apartment inventory unless
      -- explicit room/house evidence above says otherwise.
      v_kind:='apartment';
      v_kind_evidence:='provider_default_apartment';
    elsif v_mode='swap' then
      -- Telegram exposes swap as its own top-level category, so a
      -- residential swap with unknown subtype is still Tauschwohnung.
      v_kind:='apartment';
      v_kind_evidence:='swap_default';
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
    'version',4,
    'kind',coalesce(v_kind,'unknown'),
    'mode',coalesce(v_mode,'unknown'),
    'category',v_category,
    'kind_evidence',coalesce(v_kind_evidence,'insufficient'),
    'mode_evidence',coalesce(v_mode_evidence,'insufficient')
  );
end;
$function$

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
  v_rooms numeric;
  v_area numeric;
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

  v_rooms:=nullif(l.rooms,0);
  v_area:=nullif(l.area_sqm,0);

  if v_category='WG' then
    -- Missing room area is unknown, not a proven mismatch.
    if coalesce(p.min_room_area_sqm,0)>0
       and v_area is not null
       and v_area<p.min_room_area_sqm then
      return false;
    end if;
  else
    -- Missing room count / area is unknown, not a proven mismatch.
    if coalesce(p.min_rooms,0)>0
       and v_rooms is not null
       and v_rooms<p.min_rooms then
      return false;
    end if;

    if coalesce(p.min_area_sqm,0)>0
       and v_area is not null
       and v_area<p.min_area_sqm then
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
