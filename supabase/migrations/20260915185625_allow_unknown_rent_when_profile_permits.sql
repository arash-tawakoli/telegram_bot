create or replace function app_private.queue_listing_delivery_v3()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_group uuid;
  v_primary boolean;
  v_source_ready boolean;
  v_source_type text;
  v_haystack text:=lower(concat_ws(' ',new.property_type,new.title,new.district,new.address,new.raw::text));
begin
  if new.quality_status='rejected' or not coalesce(new.enrichment_delivery_eligible,true) or not coalesce(new.fresh_delivery_eligible,false) then return new; end if;
  if v_haystack ~ '(^|[[:space:]])(ich|wir)[[:space:]]+suche(n)?[[:space:]].{0,40}(wohnung|apartment|wg-zimmer|zimmer|haus)' or v_haystack ~ '[[:space:]]sucht[[:space:]]+(dringend[[:space:]]+)?(eine[nr]?[[:space:]]+)?(wohnung|apartment|wg-zimmer|zimmer|haus)' or v_haystack ~ '^[[:space:]]*(wohnung|apartment|wg-zimmer|zimmer|haus)[[:space:]]+gesucht' then return new; end if;
  select (s.enabled and s.runtime_mode='live' and s.delivery_mode='live'),s.source_type into v_source_ready,v_source_type from public.sources s where s.id=new.source_id;
  if not coalesce(v_source_ready,false) then perform app_private.assign_listing_dedupe(new.id); return new; end if;
  v_group:=app_private.assign_listing_dedupe(new.id);
  select l.is_primary_listing into v_primary from public.listings l where l.id=new.id;
  if not coalesce(v_primary,false) or v_group is null then return new; end if;
  insert into public.delivery_events(profile_id,listing_id,dedupe_key,status,delivery_format,recipient_user_id,next_retry_at)
  select p.id,new.id,'group:'||v_group::text,'pending','photo_card',p.user_id,null
  from public.search_profiles p join public.bot_users owner_user on owner_user.id=p.user_id and owner_user.is_active=true
  where p.is_active=true and (p.profile_slot=1 or app_private.user_is_premium(p.user_id))
    and (coalesce(cardinality(p.property_types),0)=0 or (v_haystack ~ '(tauschwohnung|tauschangebot|wohnungstausch|wohnung[[:space:]-]*tausch|tausche)' and 'Tauschwohnung'=any(p.property_types)) or (v_haystack !~ '(tauschwohnung|tauschangebot|wohnungstausch|wohnung[[:space:]-]*tausch|tausche)' and coalesce(new.property_type,'Wohnung')=any(p.property_types)))
    and (p.max_warm_rent is null or coalesce(nullif(new.warm_rent,0),nullif(new.cold_rent,0)) is null or coalesce(nullif(new.warm_rent,0),nullif(new.cold_rent,0))<=p.max_warm_rent)
    and (not p.require_known_warm_rent or coalesce(new.warm_rent,0)>0)
    and (p.max_deposit is null or new.deposit is null or new.deposit<=p.max_deposit)
    and (not p.wbs_only or new.wbs_required is true)
    and (p.furnished_preference='any' or (p.furnished_preference='yes' and new.furnished is true) or (p.furnished_preference='no' and new.furnished is false))
    and (coalesce(p.min_rooms,0)<=0 or new.rooms is null or new.rooms>=p.min_rooms)
    and (coalesce(p.min_area_sqm,0)<=0 or new.area_sqm is null or new.area_sqm>=p.min_area_sqm)
    and (p.location_mode='all_hamburg' or (p.location_mode='boroughs' and coalesce(cardinality(p.boroughs),0)>=7) or (p.location_mode='neighborhoods' and exists(select 1 from unnest(p.neighborhoods) n where lower(concat_ws(' ',new.district,new.address,new.title,new.raw::text)) like '%'||lower(n)||'%')) or (p.location_mode='boroughs' and exists(select 1 from public.hamburg_neighborhoods hn join public.hamburg_boroughs hb on hb.id=hn.borough_id where hb.name=any(p.boroughs) and lower(concat_ws(' ',new.district,new.address,new.title,new.raw::text)) like '%'||lower(hn.name)||'%')) or (coalesce(cardinality(p.districts),0)>0 and ('Ganz Hamburg'=any(p.districts) or exists(select 1 from unnest(p.districts) d where lower(concat_ws(' ',new.district,new.address,new.title,new.raw::text)) like '%'||lower(d)||'%'))))
  on conflict do nothing;
  return new;
end;
$function$;