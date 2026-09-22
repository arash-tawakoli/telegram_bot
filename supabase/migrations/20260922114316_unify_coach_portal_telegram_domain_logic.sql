CREATE OR REPLACE FUNCTION app_private.save_search_profile_values(p_user uuid, p_values jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  u public.bot_users%rowtype;
  v public.search_profiles%rowtype;
  v_id uuid;
  slot integer;
  types text[];
  v_type text;
  v_min_rooms numeric;
  v_min_area numeric;
  v_furnished text;
  v_mode text;
  v_boroughs text[] := '{}'::text[];
  v_neighborhoods text[] := '{}'::text[];
  v_districts text[] := '{}'::text[];
begin
  select * into u
  from public.bot_users
  where id=p_user and is_active
  for share;
  if not found then raise exception 'participant_unavailable'; end if;

  if jsonb_typeof(p_values)<>'object' or octet_length(p_values::text)>24000 then
    raise exception 'invalid_profile';
  end if;

  slot:=coalesce((p_values->>'profile_slot')::integer,1);
  if slot<1 or slot>(case when app_private.user_is_premium(p_user) then 4 else 1 end) then
    raise exception 'profile_slot_not_allowed';
  end if;

  if coalesce(jsonb_typeof(p_values->'property_types'),'')<>'array'
     or jsonb_array_length(p_values->'property_types')<>1 then
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
  v_min_rooms:=(p_values->>'min_rooms')::numeric;
  v_min_area:=(p_values->>'min_area_sqm')::numeric;
  if v_min_rooms is null or v_min_rooms not between 1 and 20
     or v_min_area is null or v_min_area not between 0 and 1000 then
    raise exception 'invalid_profile_limits';
  end if;

  v_mode:=p_values->>'location_mode';
  if v_mode not in ('all_hamburg','boroughs','neighborhoods') or v_mode is null then
    raise exception 'invalid_profile_location';
  end if;

  if v_mode='boroughs' then
    if coalesce(jsonb_typeof(p_values->'boroughs'),'')<>'array'
       or jsonb_array_length(p_values->'boroughs')=0 then
      raise exception 'invalid_profile_location';
    end if;
    select coalesce(array_agg(value order by value),'{}'::text[])
      into v_boroughs
    from jsonb_array_elements_text(p_values->'boroughs') t(value);
    if (select count(*) from public.hamburg_boroughs where name=any(v_boroughs))<>cardinality(v_boroughs) then
      raise exception 'invalid_profile_location';
    end if;
    select coalesce(array_agg(hn.name order by hn.id),'{}'::text[])
      into v_districts
    from public.hamburg_neighborhoods hn
    join public.hamburg_boroughs hb on hb.id=hn.borough_id
    where hb.name=any(v_boroughs);
  elsif v_mode='neighborhoods' then
    if coalesce(jsonb_typeof(p_values->'neighborhoods'),'')<>'array'
       or jsonb_array_length(p_values->'neighborhoods')=0 then
      raise exception 'invalid_profile_location';
    end if;
    select coalesce(array_agg(value order by value),'{}'::text[])
      into v_neighborhoods
    from jsonb_array_elements_text(p_values->'neighborhoods') t(value);
    if (select count(*) from public.hamburg_neighborhoods where name=any(v_neighborhoods))<>cardinality(v_neighborhoods) then
      raise exception 'invalid_profile_location';
    end if;
    v_districts:=v_neighborhoods;
    select coalesce(array_agg(distinct hb.name order by hb.name),'{}'::text[])
      into v_boroughs
    from public.hamburg_neighborhoods hn
    join public.hamburg_boroughs hb on hb.id=hn.borough_id
    where hn.name=any(v_neighborhoods);
  else
    v_districts:=array['Ganz Hamburg']::text[];
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
    types,v_mode,v_districts,v_boroughs,v_neighborhoods,
    (p_values->>'max_warm_rent')::numeric,v_min_rooms,v_min_area,0,
    case when p_values?'wbs_only' then (p_values->>'wbs_only')::boolean else coalesce(v.wbs_only,false) end,
    v_furnished,
    case when p_values?'require_known_warm_rent' then (p_values->>'require_known_warm_rent')::boolean else coalesce(v.require_known_warm_rent,false) end,
    case when p_values?'max_deposit' and nullif(p_values->>'max_deposit','') is not null
      then greatest(0,(p_values->>'max_deposit')::numeric) else v.max_deposit end,
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
    updated_at=now()
  returning id into v_id;

  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.save_search_profile_ui(p_user uuid, p_update_id bigint, p_attempt integer, p_values jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  u public.bot_users%rowtype;
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

  if coalesce(p_values->>'_flow','')!~'^[a-f0-9]{12}$' then
    raise exception 'ui_state_changed';
  end if;
  if coalesce(u.onboarding_state->>'_flow','')<>coalesce(p_values->>'_flow','')
     or coalesce(u.onboarding_state->>'_revision','0')<>coalesce(p_values->>'_revision','0') then
    raise exception 'ui_state_changed';
  end if;

  perform app_private.save_search_profile_values(p_user,p_values);

  update public.bot_users
  set onboarding_step=null,onboarding_state='{}',updated_at=now()
  where id=p_user;

  reward:=public.complete_referral_reward(p_user);
  return coalesce(reward,'{}'::jsonb);
end
$function$;

CREATE OR REPLACE FUNCTION public.coach_save_search_profile(p_actor uuid, p_user uuid, p_values jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_actor public.coaching_members%rowtype;
  v_id uuid;
begin
  select * into v_actor
  from public.coaching_members
  where id=p_actor and is_active;
  if not found or not app_private.coaching_actor_can_access(v_actor.id,p_user,false) then
    raise exception 'participant_forbidden';
  end if;

  v_id:=app_private.save_search_profile_values(p_user,p_values);

  insert into public.coaching_audit_events(
    workspace_id,actor_member_id,participant_user_id,action,changes
  )
  values(
    v_actor.workspace_id,v_actor.id,p_user,'search_profile_saved',
    jsonb_build_object(
      'profile_id',v_id,
      'slot',coalesce((p_values->>'profile_slot')::integer,1),
      'property_type',p_values#>>'{property_types,0}'
    )
  );
  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.coach_effective_premium_status(p_users uuid[])
 RETURNS TABLE(user_id uuid, is_premium boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select u.id,app_private.user_is_premium(u.id)
  from public.bot_users u
  where u.id=any(coalesce(p_users,'{}'::uuid[]))
$function$;

CREATE OR REPLACE FUNCTION public.set_application_enabled_shared(p_user uuid, p_enabled boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if not exists(select 1 from public.bot_users where id=p_user and is_active) then
    raise exception 'participant_unavailable';
  end if;
  if p_enabled and not app_private.user_is_premium(p_user) then
    raise exception 'premium_required';
  end if;

  insert into public.application_preferences(user_id,enabled)
  values(p_user,p_enabled)
  on conflict(user_id) do update
  set enabled=excluded.enabled,updated_at=now();

  update public.bot_users
  set auto_apply_enabled=p_enabled,updated_at=now()
  where id=p_user;

  return true;
end
$function$;

revoke all on function public.coach_save_search_profile(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.coach_save_search_profile(uuid,uuid,jsonb) to service_role;

revoke all on function public.coach_effective_premium_status(uuid[]) from public,anon,authenticated;
grant execute on function public.coach_effective_premium_status(uuid[]) to service_role;

revoke all on function public.set_application_enabled_shared(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_application_enabled_shared(uuid,boolean) to service_role;
