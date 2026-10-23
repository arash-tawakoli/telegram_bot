-- Restore the Schleswig-Holstein profile, area retrieval, and matching routines expected by the live schema.
CREATE OR REPLACE FUNCTION public.get_schleswig_holstein_areas()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'area_code',g.area_code,
    'parent_code',g.parent_code,
    'area_type',g.area_type,
    'name',g.name,
    'state_code',g.state_code,
    'official_code',g.official_code
  ) order by case g.area_type when 'state' then 0 when 'county' then 1 when 'independent_city' then 1 when 'municipality' then 2 else 3 end,g.name),'[]'::jsonb)
  from public.geo_areas g
  where g.state_code='SH' and g.is_active
$function$;

CREATE OR REPLACE FUNCTION public.get_schleswig_holstein_area_aliases()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'alias',a.alias,
    'area_code',g.area_code,
    'parent_code',g.parent_code,
    'name',g.name,
    'region_name',coalesce(parent.name,'Schleswig-Holstein')
  ) order by a.alias),'[]'::jsonb)
  from public.geo_area_aliases a
  join public.geo_areas g on g.area_code=a.area_code
  left join public.geo_areas parent on parent.area_code=g.parent_code
  where g.state_code='SH' and g.area_type='municipality' and g.is_active
$function$;

CREATE OR REPLACE FUNCTION app_private.save_search_profile_values(p_user uuid, p_values jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 u public.bot_users%rowtype; v public.search_profiles%rowtype; v_id uuid; slot integer; types text[]; v_type text;
 v_min_rooms numeric; v_min_area numeric; v_furnished text; v_mode text; v_state_code text:='HH';
 v_boroughs text[]:='{}'::text[]; v_neighborhoods text[]:='{}'::text[]; v_districts text[]:='{}'::text[];
 v_location_area_codes text[]:='{}'::text[]; v_requested_area_codes text[]:='{}'::text[];
begin
 select * into u from public.bot_users where id=p_user and is_active for share;
 if not found then raise exception 'participant_unavailable'; end if;
 if jsonb_typeof(p_values)<>'object' or octet_length(p_values::text)>24000 then raise exception 'invalid_profile'; end if;
 slot:=coalesce((p_values->>'profile_slot')::integer,1);
 if slot<1 or slot>(case when app_private.user_is_premium(p_user) then 4 else 1 end) then raise exception 'profile_slot_not_allowed'; end if;
 if coalesce(jsonb_typeof(p_values->'property_types'),'')<>'array' or jsonb_array_length(p_values->'property_types')<>1 then raise exception 'invalid_property_types'; end if;
 v_type:=p_values#>>'{property_types,0}';
 if v_type not in ('Wohnung','Haus','WG','Tauschwohnung') then raise exception 'invalid_property_types'; end if;
 types:=array[v_type];
 if (p_values->>'max_warm_rent') is null or (p_values->>'max_warm_rent')::numeric not between 100 and 5000 then raise exception 'invalid_profile_limits'; end if;
 v_min_rooms:=(p_values->>'min_rooms')::numeric; v_min_area:=(p_values->>'min_area_sqm')::numeric;
 if v_min_rooms is null or v_min_rooms not between 1 and 20 or v_min_area is null or v_min_area not between 0 and 1000 then raise exception 'invalid_profile_limits'; end if;
 v_mode:=p_values->>'location_mode';
 if v_mode not in ('all_hamburg','boroughs','neighborhoods','all_schleswig_holstein','schleswig_holstein_areas') or v_mode is null then raise exception 'invalid_profile_location'; end if;
 if v_mode='boroughs' then
  if coalesce(jsonb_typeof(p_values->'boroughs'),'')<>'array' or jsonb_array_length(p_values->'boroughs')=0 then raise exception 'invalid_profile_location'; end if;
  select coalesce(array_agg(value order by value),'{}'::text[]) into v_boroughs from jsonb_array_elements_text(p_values->'boroughs') t(value);
  if (select count(*) from public.hamburg_boroughs where name=any(v_boroughs))<>cardinality(v_boroughs) then raise exception 'invalid_profile_location'; end if;
  select coalesce(array_agg(hn.name order by hn.id),'{}'::text[]) into v_districts from public.hamburg_neighborhoods hn join public.hamburg_boroughs hb on hb.id=hn.borough_id where hb.name=any(v_boroughs);
 elsif v_mode='neighborhoods' then
  if coalesce(jsonb_typeof(p_values->'neighborhoods'),'')<>'array' or jsonb_array_length(p_values->'neighborhoods')=0 then raise exception 'invalid_profile_location'; end if;
  select coalesce(array_agg(value order by value),'{}'::text[]) into v_neighborhoods from jsonb_array_elements_text(p_values->'neighborhoods') t(value);
  if (select count(*) from public.hamburg_neighborhoods where name=any(v_neighborhoods))<>cardinality(v_neighborhoods) then raise exception 'invalid_profile_location'; end if;
  v_districts:=v_neighborhoods;
  select coalesce(array_agg(distinct hb.name order by hb.name),'{}'::text[]) into v_boroughs from public.hamburg_neighborhoods hn join public.hamburg_boroughs hb on hb.id=hn.borough_id where hn.name=any(v_neighborhoods);
 elsif v_mode='all_schleswig_holstein' then
  v_state_code:='SH'; v_districts:=array['Ganz Schleswig-Holstein']::text[];
 elsif v_mode='schleswig_holstein_areas' then
  v_state_code:='SH';
  if coalesce(jsonb_typeof(p_values->'location_area_codes'),'')<>'array' or jsonb_array_length(p_values->'location_area_codes')=0 then raise exception 'invalid_profile_location'; end if;
  select coalesce(array_agg(distinct value order by value),'{}'::text[]) into v_requested_area_codes from jsonb_array_elements_text(p_values->'location_area_codes') t(value);
  if cardinality(v_requested_area_codes)=0 or (select count(*) from public.geo_areas where area_code=any(v_requested_area_codes) and state_code='SH' and area_type in ('county','independent_city','municipality'))<>cardinality(v_requested_area_codes) then raise exception 'invalid_profile_location'; end if;
  select coalesce(array_agg(g.area_code order by g.area_code),'{}'::text[]) into v_location_area_codes from public.geo_areas g where g.area_code=any(v_requested_area_codes)
   and not exists(select 1 from public.geo_areas parent where parent.area_code=any(v_requested_area_codes) and g.parent_code=parent.area_code);
  if cardinality(v_location_area_codes)=0 then raise exception 'invalid_profile_location'; end if;
  select coalesce(array_agg(g.name order by g.name),'{}'::text[]) into v_districts from public.geo_areas g where g.area_code=any(v_location_area_codes);
 else v_districts:=array['Ganz Hamburg']::text[];
 end if;
 select * into v from public.search_profiles where user_id=p_user and profile_slot=slot for update;
 v_furnished:=case when p_values?'furnished_preference' then case p_values->>'furnished_preference' when 'furnished' then 'yes' when 'unfurnished' then 'no' when 'yes' then 'yes' when 'no' then 'no' else 'any' end else coalesce(v.furnished_preference,'any') end;
 insert into public.search_profiles(user_id,profile_slot,name,property_types,location_mode,location_state_code,location_area_codes,districts,boroughs,neighborhoods,max_warm_rent,min_rooms,min_area_sqm,min_room_area_sqm,wbs_only,furnished_preference,require_known_warm_rent,max_deposit,updated_at)
 values(p_user,slot,coalesce(v.name,case when slot=1 then 'Meine Suche' else 'Meine Suche '||slot end),types,v_mode,v_state_code,v_location_area_codes,v_districts,v_boroughs,v_neighborhoods,(p_values->>'max_warm_rent')::numeric,v_min_rooms,v_min_area,0,
 case when p_values?'wbs_only' then (p_values->>'wbs_only')::boolean else coalesce(v.wbs_only,false) end,v_furnished,
 case when p_values?'require_known_warm_rent' then (p_values->>'require_known_warm_rent')::boolean else coalesce(v.require_known_warm_rent,false) end,
 case when p_values?'max_deposit' and nullif(p_values->>'max_deposit','') is not null then greatest(0,(p_values->>'max_deposit')::numeric) else v.max_deposit end,now())
 on conflict(user_id,profile_slot) do update set property_types=excluded.property_types,location_mode=excluded.location_mode,location_state_code=excluded.location_state_code,location_area_codes=excluded.location_area_codes,districts=excluded.districts,boroughs=excluded.boroughs,neighborhoods=excluded.neighborhoods,max_warm_rent=excluded.max_warm_rent,min_rooms=excluded.min_rooms,min_area_sqm=excluded.min_area_sqm,min_room_area_sqm=excluded.min_room_area_sqm,wbs_only=excluded.wbs_only,furnished_preference=excluded.furnished_preference,require_known_warm_rent=excluded.require_known_warm_rent,max_deposit=excluded.max_deposit,updated_at=now()
 returning id into v_id;
 return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION app_private.matches_property_filters(p search_profiles, l listings)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare c jsonb; v_category text; v_price numeric; v_rooms numeric; v_area numeric; v_haystack text; v_location_ok boolean:=false;
begin
 if cardinality(p.property_types)<>1 or p.property_types[1] not in ('Wohnung','Haus','WG','Tauschwohnung') then return false; end if;
 if exists(select 1 from public.sources s where s.id=l.source_id and s.source_type='Baugenossenschaft') then v_category:='Wohnung';
 else c:=app_private.classify_listing_category(l.source_id,l.property_type,l.property_kind,l.offer_mode,l.title,l.raw);v_category:=c->>'category';end if;
 if v_category is null or v_category<>p.property_types[1] then return false; end if;
 if p.max_warm_rent is not null then v_price:=nullif(l.warm_rent,0);if v_price is not null and v_price>p.max_warm_rent then return false;end if;
  if v_price is null and coalesce(p.require_known_warm_rent,false)=false and coalesce(nullif(l.cold_rent,0),0)>p.max_warm_rent then return false;end if;end if;
 if coalesce(p.require_known_warm_rent,false) and coalesce(l.warm_rent,0)<=0 then return false;end if;
 if p.max_deposit is not null and (l.deposit is null or l.deposit>p.max_deposit) then return false;end if;
 if p.wbs_only and l.wbs_required is distinct from true then return false;end if;
 if p.furnished_preference='yes' and l.furnished is distinct from true then return false;elsif p.furnished_preference='no' and l.furnished is distinct from false then return false;end if;
 v_rooms:=nullif(l.rooms,0);v_area:=nullif(l.area_sqm,0);
 if coalesce(p.min_rooms,0)>0 and v_rooms is not null and v_rooms<p.min_rooms then return false;end if;
 if coalesce(p.min_area_sqm,0)>0 and v_area is not null and v_area<p.min_area_sqm then return false;end if;
 v_haystack:=lower(concat_ws(' ',l.district,l.address,l.title,l.raw::text));
 v_location_ok:=(p.location_mode='all_hamburg' and coalesce(l.state_code,'HH')='HH')
  or (p.location_mode='boroughs' and coalesce(l.state_code,'HH')='HH' and coalesce(cardinality(p.boroughs),0)>=7)
  or (p.location_mode='neighborhoods' and coalesce(l.state_code,'HH')='HH' and exists(select 1 from unnest(p.neighborhoods) n where v_haystack like '%'||lower(n)||'%'))
  or (p.location_mode='boroughs' and coalesce(l.state_code,'HH')='HH' and exists(select 1 from public.hamburg_neighborhoods hn join public.hamburg_boroughs hb on hb.id=hn.borough_id where hb.name=any(p.boroughs) and v_haystack like '%'||lower(hn.name)||'%'))
  or (p.location_mode='all_schleswig_holstein' and l.state_code='SH')
  or (p.location_mode='schleswig_holstein_areas' and l.state_code='SH' and (l.admin_region_code=any(coalesce(p.location_area_codes,'{}'::text[])) or l.municipality_code=any(coalesce(p.location_area_codes,'{}'::text[]))))
  or (p.location_mode in ('all_hamburg','boroughs','neighborhoods') and coalesce(l.state_code,'HH')='HH' and coalesce(cardinality(p.districts),0)>0 and ('Ganz Hamburg'=any(p.districts) or exists(select 1 from unnest(p.districts) d where v_haystack like '%'||lower(d)||'%')));
 return coalesce(v_location_ok,false);
end
$function$;

REVOKE ALL ON FUNCTION public.get_schleswig_holstein_areas() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_schleswig_holstein_area_aliases() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_schleswig_holstein_areas() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_schleswig_holstein_area_aliases() TO service_role;
REVOKE ALL ON FUNCTION app_private.save_search_profile_values(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.save_search_profile_values(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION app_private.matches_property_filters(public.search_profiles,public.listings) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.matches_property_filters(public.search_profiles,public.listings) TO service_role;

DO $validation$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.search_profiles
    WHERE location_mode IN ('all_schleswig_holstein','schleswig_holstein_areas')
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.search_profiles'::regclass
      AND conname='search_profiles_location_mode_check'
      AND pg_get_constraintdef(oid) LIKE '%all_schleswig_holstein%'
  ) THEN
    RAISE EXCEPTION 'Schleswig-Holstein search profile constraint missing';
  END IF;
END;
$validation$;
