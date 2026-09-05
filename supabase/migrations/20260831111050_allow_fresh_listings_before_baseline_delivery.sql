create or replace function app_private.queue_listing_delivery_v3()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare v_group uuid; v_primary boolean; v_source_ready boolean;
begin
  if new.quality_status='rejected' or not coalesce(new.enrichment_delivery_eligible,true) then return new; end if;
  if not coalesce(new.fresh_delivery_eligible,false) then return new; end if;
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
  from public.search_profiles p join public.bot_users u on u.id=p.user_id
  where p.is_active=true and u.is_active=true
    and (coalesce(cardinality(p.property_types),0)=0 or coalesce(new.property_type,'Wohnung')=any(p.property_types))
    and (p.max_warm_rent is null or coalesce(new.warm_rent,new.cold_rent) is null or coalesce(new.warm_rent,new.cold_rent)<=p.max_warm_rent)
    and (coalesce(p.min_rooms,0)<=0 or new.rooms is null or new.rooms>=p.min_rooms)
    and (coalesce(p.min_area_sqm,0)<=0 or new.area_sqm is null or new.area_sqm>=p.min_area_sqm)
    and (not p.wbs_only or coalesce(new.wbs_required,false))
    and (coalesce(p.furnished_preference,'any')='any' or new.furnished is null
      or (p.furnished_preference in ('yes','furnished') and new.furnished=true)
      or (p.furnished_preference in ('no','unfurnished') and new.furnished=false))
    and (p.location_mode='all_hamburg'
      or (p.location_mode='neighborhoods' and exists(select 1 from unnest(p.neighborhoods) n where lower(concat_ws(' ',new.district,new.address,new.title)) like '%'||lower(n)||'%'))
      or (p.location_mode='boroughs' and exists(select 1 from public.hamburg_neighborhoods hn join public.hamburg_boroughs hb on hb.id=hn.borough_id where hb.name=any(p.boroughs) and lower(concat_ws(' ',new.district,new.address,new.title)) like '%'||lower(hn.name)||'%'))
      or (coalesce(cardinality(p.districts),0)>0 and ('Ganz Hamburg'=any(p.districts) or exists(select 1 from unnest(p.districts) d where lower(concat_ws(' ',new.district,new.address,new.title)) like '%'||lower(d)||'%'))))
  on conflict do nothing;
  return new;
end;$function$;
