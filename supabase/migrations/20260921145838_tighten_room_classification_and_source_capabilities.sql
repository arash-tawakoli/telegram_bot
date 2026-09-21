-- Tighten room evidence so labels such as 'WG geeignet' remain Wohnung.

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


update public.sources
set search_capabilities=jsonb_set(
  coalesce(search_capabilities,'{}'::jsonb),
  '{configured_kinds}',
  case id
    when 1 then '["apartment","house","room"]'::jsonb
    when 3 then '["apartment","house","room"]'::jsonb
    when 10 then '["apartment","house","room"]'::jsonb
    when 16 then '["apartment","room"]'::jsonb
    else coalesce(search_capabilities->'configured_kinds','[]'::jsonb)
  end,
  true
)
where id in (1,3,10,16);
