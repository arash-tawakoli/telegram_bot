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

  v_min_rooms:=(p_values->>'min_rooms')::numeric;
  v_min_area:=(p_values->>'min_area_sqm')::numeric;
  v_min_room_area:=0;
  if v_min_rooms is null or v_min_rooms not between 1 and 20
     or v_min_area is null or v_min_area not between 0 and 1000 then
    raise exception 'invalid_profile_limits';
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
$function$;

CREATE OR REPLACE FUNCTION public.telegram_fast_action_v2(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_action text:=coalesce(p_payload#>>'{callback_query,data}',''); v_tg bigint:=nullif(p_payload#>>'{callback_query,from,id}','')::bigint;
  v_lang text;v_base jsonb;v_claim integer;v_user jsonb;v_uid uuid;v_premium boolean;v_limit integer;v_state jsonb;v_step text;v_view text;
  v_data jsonb:='{}'::jsonb;v_reward jsonb:='{}'::jsonb;v_types text[]:='{}'::text[];v_ints integer[]:='{}'::integer[];
  v_slot integer;v_page integer:=0;v_pages integer:=1;v_revision integer:=0;v_amount numeric;v_profile public.search_profiles%rowtype;
  v_location_mode text;v_districts text[]:='{}'::text[];v_boroughs text[]:='{}'::text[];v_neighborhoods text[]:='{}'::text[];
  v_code text;v_total integer;v_is_critical boolean:=false;v_supported boolean:=false;
begin
 if v_tg is null or v_action='' then return jsonb_build_object('fast',false);end if;
 v_supported:=v_action in('home','settings','help','profile','profiles','new','draft','cancel','types','location','boroughs','neighborhoods','rent','rent:custom','roomarea','rooms','area','profile:save','pause','resume','status','referral','language','saved','premium')
 or v_action~'^loc:(all|boroughs|neighborhoods)$'
 or v_action~'^borough:(all|clear|done|[0-9]+)$' or v_action~'^neighborhood:(all|clear|prev|next|done|[0-9]+)$'
 or v_action~'^rent:(800|1000|1250|2000)$' or v_action~'^roomarea:(0|8|10|12|15|20)$' or v_action~'^rooms:(1|2|3|4)$'
 or v_action~'^area:(20|50|70|90)$' or v_action~'^profile:view:[1-4]$' or v_action~'^profile:delete:[1-4]$'
 or v_action~'^profile:delete-confirm:[1-4]$' or v_action~'^profile:(pause|resume):[1-4]$' or v_action~'^saved:[0-9]+$';
 if not v_supported then return jsonb_build_object('fast',false);end if;
 select ui_language into v_lang from public.bot_users where telegram_user_id=v_tg;
 if v_lang is distinct from 'de' or p_payload#>'{callback_query,message,photo}' is not null then return jsonb_build_object('fast',false);end if;
 v_base:=public.prepare_telegram_update(p_payload);v_claim:=coalesce((v_base->>'claim')::integer,0);
 if v_claim<=0 then return v_base||jsonb_build_object('fast',true);end if;
 v_user:=v_base->'user';v_uid:=(v_user->>'id')::uuid;
 if coalesce((v_user->>'is_active')::boolean,false) is false then perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');return jsonb_build_object('fast',true,'blocked',true,'claim',v_claim);end if;
 v_premium:=app_private.user_is_premium(v_uid);v_limit:=case when v_premium then 4 else 1 end;
 select onboarding_state,onboarding_step into v_state,v_step from public.bot_users where id=v_uid;v_state:=coalesce(v_state,'{}');v_revision:=coalesce((v_state->>'_revision')::integer,0);
 select coalesce(array_agg(x),'{}'::text[]) into v_types from jsonb_array_elements_text(coalesce(v_state->'property_types','[]'))x;
 if v_action='home' then v_view:='home';
 elsif v_action='settings' then v_view:='settings';
 elsif v_action='help' then v_view:='help';
 elsif v_action='premium' then v_view:='premium';
 elsif v_action='language' then v_view:='language';
 elsif v_action in('profile','profiles') then v_view:='profile_list';
 elsif v_action~'^profile:view:' then v_slot:=split_part(v_action,':',3)::integer;if v_slot>v_limit then v_view:='premium';else select * into v_profile from public.search_profiles where user_id=v_uid and profile_slot=v_slot;v_view:=case when found then'profile_detail'else'profile_list'end;if found then v_data:=v_data||jsonb_build_object('profile',to_jsonb(v_profile));end if;end if;
 elsif v_action~'^profile:delete:[1-4]$' then v_slot:=split_part(v_action,':',3)::integer;v_view:='profile_delete_confirm';v_data:=v_data||jsonb_build_object('slot',v_slot);
 elsif v_action~'^profile:delete-confirm:' then v_slot:=split_part(v_action,':',3)::integer;v_is_critical:=true;delete from public.search_profiles where user_id=v_uid and profile_slot=v_slot and v_slot<=v_limit;v_view:='profile_list';
 elsif v_action~'^profile:(pause|resume):' then v_slot:=split_part(v_action,':',3)::integer;v_is_critical:=true;update public.search_profiles set is_active=(split_part(v_action,':',2)='resume'),updated_at=now()where user_id=v_uid and profile_slot=v_slot and v_slot<=v_limit;select * into v_profile from public.search_profiles where user_id=v_uid and profile_slot=v_slot;v_view:='profile_detail';v_data:=v_data||jsonb_build_object('profile',to_jsonb(v_profile));
 elsif v_action='new' then select s into v_slot from generate_series(1,v_limit)s where not exists(select 1 from public.search_profiles where user_id=v_uid and profile_slot=s)order by s limit 1;if v_slot is null then v_view:='profile_list';else v_state:=jsonb_build_object('profile_slot',v_slot,'property_types','[]'::jsonb,'location_mode',null,'borough_ids','[]'::jsonb,'neighborhood_ids','[]'::jsonb,'neighborhood_page',0,'max_warm_rent',null,'min_rooms',null,'min_area_sqm',null,'min_room_area_sqm',null,'wbs_only',false,'furnished_preference','any','require_known_warm_rent',false,'max_deposit',null,'_flow',substr(encode(extensions.gen_random_bytes(6),'hex'),1,12),'_revision',0);update public.bot_users set onboarding_step='types',onboarding_state=v_state,updated_at=now()where id=v_uid;v_view:='types';end if;
 elsif v_action='cancel' then update public.bot_users set onboarding_step=null,onboarding_state='{}',updated_at=now()where id=v_uid;v_state:='{}';v_view:='home';
 elsif v_action='draft' then v_view:=case when v_step='roomarea' then 'rooms' when v_step in('types','location','boroughs','neighborhoods','rent','rent_custom','rooms','area','review')then v_step else'types'end;
 elsif v_action='roomarea' then v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'rooms',v_state,v_revision);v_view:='rooms';
 elsif v_action in('types','location','boroughs','neighborhoods','rent','rooms','area') then v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,v_action,v_state,v_revision);v_view:=v_action;
 elsif v_action~'^loc:' then
  if split_part(v_action,':',2)='all'then v_state:=jsonb_set(jsonb_set(jsonb_set(v_state,'{location_mode}',to_jsonb('all_hamburg'::text),true),'{borough_ids}','[]',true),'{neighborhood_ids}','[]',true);v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'rent',v_state,v_revision);v_view:='rent';
  elsif split_part(v_action,':',2)='boroughs'then v_state:=jsonb_set(jsonb_set(v_state,'{location_mode}',to_jsonb('boroughs'::text),true),'{neighborhood_ids}','[]',true);v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'boroughs',v_state,v_revision);v_view:='boroughs';
  else v_state:=jsonb_set(jsonb_set(v_state,'{location_mode}',to_jsonb('neighborhoods'::text),true),'{borough_ids}','[]',true);v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'neighborhoods',v_state,v_revision);v_view:='neighborhoods';end if;
 elsif v_action~'^borough:' then
  select coalesce(array_agg(value::integer),'{}')into v_ints from jsonb_array_elements_text(coalesce(v_state->'borough_ids','[]'));
  if split_part(v_action,':',2)='all'then select coalesce(array_agg(id order by sort_order),'{}')into v_ints from public.hamburg_boroughs;elsif split_part(v_action,':',2)='clear'then v_ints:='{}';elsif split_part(v_action,':',2)='done'then if cardinality(v_ints)=0 then v_view:='boroughs';else v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'rent',v_state,v_revision);v_view:='rent';end if;else v_slot:=split_part(v_action,':',2)::integer;if v_slot=any(v_ints)then v_ints:=array_remove(v_ints,v_slot);else v_ints:=array_append(v_ints,v_slot);end if;end if;
  if v_view is null then v_state:=jsonb_set(v_state,'{borough_ids}',to_jsonb(v_ints),true);v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'boroughs',v_state,v_revision);v_view:='boroughs';end if;
 elsif v_action~'^neighborhood:' then
  select coalesce(array_agg(value::integer),'{}')into v_ints from jsonb_array_elements_text(coalesce(v_state->'neighborhood_ids','[]'));v_page:=coalesce((v_state->>'neighborhood_page')::integer,0);select greatest(1,ceil(count(*)/10.0)::integer)into v_pages from public.hamburg_neighborhoods;
  if split_part(v_action,':',2)='all'then select coalesce(array_agg(id order by id),'{}')into v_ints from public.hamburg_neighborhoods;elsif split_part(v_action,':',2)='clear'then v_ints:='{}';elsif split_part(v_action,':',2)='prev'then v_page:=greatest(0,v_page-1);elsif split_part(v_action,':',2)='next'then v_page:=least(v_pages-1,v_page+1);elsif split_part(v_action,':',2)='done'then if cardinality(v_ints)=0 then v_view:='neighborhoods';else v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'rent',v_state,v_revision);v_view:='rent';end if;else v_slot:=split_part(v_action,':',2)::integer;if v_slot=any(v_ints)then v_ints:=array_remove(v_ints,v_slot);else v_ints:=array_append(v_ints,v_slot);end if;end if;
  if v_view is null then v_state:=jsonb_set(jsonb_set(v_state,'{neighborhood_ids}',to_jsonb(v_ints),true),'{neighborhood_page}',to_jsonb(v_page),true);v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'neighborhoods',v_state,v_revision);v_view:='neighborhoods';end if;
 elsif v_action='rent:custom'then v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'rent_custom',v_state,v_revision);v_view:='rent_custom';
 elsif v_action~'^rent:'then v_amount:=split_part(v_action,':',2)::numeric;v_state:=jsonb_set(v_state,'{max_warm_rent}',to_jsonb(v_amount),true);v_step:='rooms';v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,v_step,v_state,v_revision);v_view:=v_step;
 elsif v_action~'^roomarea:'then v_amount:=split_part(v_action,':',2)::numeric;v_state:=jsonb_set(v_state,'{min_room_area_sqm}',to_jsonb(v_amount),true);v_step:='rooms';v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,v_step,v_state,v_revision);v_view:=v_step;
 elsif v_action~'^rooms:'then v_amount:=split_part(v_action,':',2)::numeric;v_state:=jsonb_set(v_state,'{min_rooms}',to_jsonb(v_amount),true);v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'area',v_state,v_revision);v_view:='area';
 elsif v_action~'^area:'then v_amount:=split_part(v_action,':',2)::numeric;v_state:=jsonb_set(v_state,'{min_area_sqm}',to_jsonb(v_amount),true);v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'review',v_state,v_revision);v_view:='review';
 elsif v_action='profile:save'then
  v_is_critical:=true;v_location_mode:=v_state->>'location_mode';
  if v_location_mode='all_hamburg'then v_districts:=array['Ganz Hamburg'];elsif v_location_mode='boroughs'then select coalesce(array_agg(name order by sort_order),'{}')into v_boroughs from public.hamburg_boroughs where id in(select value::integer from jsonb_array_elements_text(coalesce(v_state->'borough_ids','[]')));select coalesce(array_agg(name order by id),'{}')into v_districts from public.hamburg_neighborhoods where borough_id in(select value::integer from jsonb_array_elements_text(coalesce(v_state->'borough_ids','[]')));elsif v_location_mode='neighborhoods'then select coalesce(array_agg(name order by id),'{}')into v_neighborhoods from public.hamburg_neighborhoods where id in(select value::integer from jsonb_array_elements_text(coalesce(v_state->'neighborhood_ids','[]')));select coalesce(array_agg(distinct b.name),'{}')into v_boroughs from public.hamburg_neighborhoods n join public.hamburg_boroughs b on b.id=n.borough_id where n.id in(select value::integer from jsonb_array_elements_text(coalesce(v_state->'neighborhood_ids','[]')));v_districts:=v_neighborhoods;end if;
  v_state:=v_state||jsonb_build_object('districts',to_jsonb(v_districts),'boroughs',to_jsonb(v_boroughs),'neighborhoods',to_jsonb(v_neighborhoods),'min_rooms',coalesce(v_state->'min_rooms','0'::jsonb),'min_area_sqm',coalesce(v_state->'min_area_sqm','0'::jsonb),'min_room_area_sqm','0'::jsonb);
  v_reward:=public.save_search_profile_ui(v_uid,(p_payload->>'update_id')::bigint,v_claim,v_state);v_state:='{}';v_view:='profile_saved';
 elsif v_action in('pause','resume')then v_is_critical:=true;update public.search_profiles set is_active=(v_action='resume'),updated_at=now()where user_id=v_uid;v_view:=v_action;
 elsif v_action='status'then v_view:='status';v_data:=v_data||jsonb_build_object('active_profiles',(select count(*)from public.search_profiles where user_id=v_uid and is_active and profile_slot<=v_limit),'profile_limit',v_limit,'source_count',(select count(*)from public.sources),'referral_count',(select count(*)from public.referrals where referrer_user_id=v_uid and status='rewarded'));
 elsif v_action='referral'then select code into v_code from public.referral_codes where user_id=v_uid and active=true limit 1;if v_code is null then v_code:=upper(substr(encode(extensions.gen_random_bytes(6),'hex'),1,8));insert into public.referral_codes(user_id,code,active)values(v_uid,v_code,true)on conflict(user_id)do update set active=true returning code into v_code;end if;v_view:='referral';v_data:=v_data||jsonb_build_object('code',v_code);
 elsif v_action='saved'or v_action~'^saved:'then if not v_premium then v_view:='premium';else v_page:=case when v_action='saved'then 0 else split_part(v_action,':',2)::integer end;select count(*)into v_total from public.saved_listings where user_id=v_uid;v_pages:=greatest(1,ceil(v_total/8.0)::integer);v_page:=greatest(0,least(v_page,v_pages-1));v_view:='saved';v_data:=v_data||jsonb_build_object('total',v_total,'page',v_page,'pages',v_pages,'items',(select coalesce(jsonb_agg(row_data order by created_at desc),'[]')from(select sl.created_at,jsonb_build_object('title',l.title,'canonical_url',l.canonical_url,'is_active',l.is_active)row_data from public.saved_listings sl join public.listings l on l.id=sl.listing_id where sl.user_id=v_uid order by sl.created_at desc limit 8 offset v_page*8)x));end if;
 end if;
 if v_view='profile_list'then v_data:=v_data||jsonb_build_object('profiles',(select coalesce(jsonb_agg(jsonb_build_object('profile_slot',profile_slot,'name',name,'is_active',is_active)order by profile_slot),'[]')from public.search_profiles where user_id=v_uid and profile_slot<=v_limit),'profile_limit',v_limit);end if;
 if v_view in('boroughs','neighborhoods','review')then v_data:=v_data||jsonb_build_object('boroughs',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)order by sort_order),'[]')from public.hamburg_boroughs),'neighborhoods',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'borough_id',borough_id)order by id),'[]')from public.hamburg_neighborhoods));end if;
 perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
 return jsonb_build_object('fast',true,'claim',v_claim,'view',v_view,'state',v_state,'data',v_data,'user',v_user,'is_premium',v_premium,'critical',v_is_critical,'reward',v_reward);
end $function$;

update public.search_profiles
set min_rooms = case when coalesce(min_rooms,0)<1 then 1 else min_rooms end,
    min_area_sqm = case
      when coalesce(min_area_sqm,0)>0 then min_area_sqm
      when coalesce(min_room_area_sqm,0)>0 then min_room_area_sqm
      else 0
    end,
    min_room_area_sqm = 0,
    updated_at = now()
where cardinality(property_types)=1
  and property_types[1]='WG'
  and (
    coalesce(min_rooms,0)<1
    or coalesce(min_room_area_sqm,0)<>0
  );