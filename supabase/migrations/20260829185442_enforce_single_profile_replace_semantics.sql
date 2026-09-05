create or replace function app_private.replace_single_search_profile()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare v_id uuid;
begin
  select id into v_id from public.search_profiles where user_id=new.user_id order by created_at limit 1;
  if v_id is null then return new; end if;
  update public.search_profiles set
    name=new.name,
    max_warm_rent=new.max_warm_rent,
    min_rooms=new.min_rooms,
    min_area_sqm=new.min_area_sqm,
    districts=new.districts,
    property_types=new.property_types,
    furnished_preference=new.furnished_preference,
    wbs_only=new.wbs_only,
    move_in_from=new.move_in_from,
    is_active=new.is_active,
    location_mode=new.location_mode,
    boroughs=new.boroughs,
    neighborhoods=new.neighborhoods,
    updated_at=now()
  where id=v_id;
  return null;
end;$function$;

drop trigger if exists search_profiles_single_profile_replace on public.search_profiles;
create trigger search_profiles_single_profile_replace
before insert on public.search_profiles
for each row execute function app_private.replace_single_search_profile();
