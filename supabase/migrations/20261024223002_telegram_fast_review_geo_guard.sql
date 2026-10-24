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
  v_code text;v_parent_code text;v_codes text[]:='{}'::text[];v_total integer;v_is_critical boolean:=false;v_supported boolean:=false;
begin
 if v_tg is null or v_action='' then return jsonb_build_object('fast',false);end if;
 v_supported:=v_action in('home','settings','help','profile','profiles','new','draft','cancel','types','location','boroughs','neighborhoods','rent','rent:custom','roomarea','rooms','area','profile:save','pause','resume','status','referral','language','saved','premium')
 or v_action~'^loc:(all|boroughs|neighborhoods|all_sh|counties_sh|municipalities_sh)$'
 or v_action~'^sharea:(back|all|clear|prev|next|done|[A-Z0-9]+)$'
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
 elsif v_action='new' then select s into v_slot from generate_series(1,v_limit)s where not exists(select 1 from public.search_profiles where user_id=v_uid and profile_slot=s)order by s limit 1;if v_slot is null then v_view:='profile_list';else v_state:=jsonb_build_object('profile_slot',v_slot,'property_types','[]'::jsonb,'location_mode',null,'borough_ids','[]'::jsonb,'neighborhood_ids','[]'::jsonb,'location_area_codes','[]'::jsonb,'area_page',0,'sh_area_level','counties','neighborhood_page',0,'max_warm_rent',null,'min_rooms',null,'min_area_sqm',null,'min_room_area_sqm',null,'wbs_only',false,'furnished_preference','any','require_known_warm_rent',false,'max_deposit',null,'_flow',substr(encode(extensions.gen_random_bytes(6),'hex'),1,12),'_revision',0);update public.bot_users set onboarding_step='types',onboarding_state=v_state,updated_at=now()where id=v_uid;v_view:='types';end if;
 elsif v_action='cancel' then update public.bot_users set onboarding_step=null,onboarding_state='{}',updated_at=now()where id=v_uid;v_state:='{}';v_view:='home';
 elsif v_action='draft' then v_view:=case when v_step='roomarea' then 'rooms' when v_step in('types','location','boroughs','neighborhoods','shareas','rent','rent_custom','rooms','area','review')then v_step else'types'end;
 elsif v_action='roomarea' then v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'rooms',v_state,v_revision);v_view:='rooms';
 elsif v_action in('types','location','boroughs','neighborhoods','rent','rooms','area') then v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,v_action,v_state,v_revision);v_view:=v_action;
 elsif v_action~'^loc:' then
  if split_part(v_action,':',2)='all'then v_state:=v_state||jsonb_build_object('location_mode','all_hamburg','borough_ids','[]'::jsonb,'neighborhood_ids','[]'::jsonb,'location_area_codes','[]'::jsonb,'area_page',0);v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'rent',v_state,v_revision);v_view:='rent';
  elsif split_part(v_action,':',2)='boroughs'then v_state:=v_state||jsonb_build_object('location_mode','boroughs','neighborhood_ids','[]'::jsonb,'location_area_codes','[]'::jsonb,'area_page',0);v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'boroughs',v_state,v_revision);v_view:='boroughs';
  elsif split_part(v_action,':',2)='all_sh'then v_state:=v_state||jsonb_build_object('location_mode','all_schleswig_holstein','borough_ids','[]'::jsonb,'neighborhood_ids','[]'::jsonb,'location_area_codes','[]'::jsonb,'area_page',0);v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'rent',v_state,v_revision);v_view:='rent';
  elsif split_part(v_action,':',2) in('counties_sh','municipalities_sh')then v_state:=v_state||jsonb_build_object('location_mode','schleswig_holstein_areas','borough_ids','[]'::jsonb,'neighborhood_ids','[]'::jsonb,'location_area_codes','[]'::jsonb,'area_page',0,'sh_area_level',case when split_part(v_action,':',2)='municipalities_sh' then 'municipalities' else 'counties' end);v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'shareas',v_state,v_revision);v_view:='shareas';
  else v_state:=jsonb_set(jsonb_set(v_state,'{location_mode}',to_jsonb('neighborhoods'::text),true),'{borough_ids}','[]',true);v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'neighborhoods',v_state,v_revision);v_view:='neighborhoods';end if;
 elsif v_action~'^borough:' then
  select coalesce(array_agg(value::integer),'{}')into v_ints from jsonb_array_elements_text(coalesce(v_state->'borough_ids','[]'));
  if split_part(v_action,':',2)='all'then select coalesce(array_agg(id order by sort_order),'{}')into v_ints from public.hamburg_boroughs;elsif split_part(v_action,':',2)='clear'then v_ints:='{}';elsif split_part(v_action,':',2)='done'then if cardinality(v_ints)=0 then v_view:='boroughs';else v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'rent',v_state,v_revision);v_view:='rent';end if;else v_slot:=split_part(v_action,':',2)::integer;if v_slot=any(v_ints)then v_ints:=array_remove(v_ints,v_slot);else v_ints:=array_append(v_ints,v_slot);end if;end if;
  if v_view is null then v_state:=jsonb_set(v_state,'{borough_ids}',to_jsonb(v_ints),true);v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'boroughs',v_state,v_revision);v_view:='boroughs';end if;
 elsif v_action~'^neighborhood:' then
  select coalesce(array_agg(value::integer),'{}')into v_ints from jsonb_array_elements_text(coalesce(v_state->'neighborhood_ids','[]'));v_page:=coalesce((v_state->>'neighborhood_page')::integer,0);select greatest(1,ceil(count(*)/10.0)::integer)into v_pages from public.hamburg_neighborhoods;
  if split_part(v_action,':',2)='all'then select coalesce(array_agg(id order by id),'{}')into v_ints from public.hamburg_neighborhoods;elsif split_part(v_action,':',2)='clear'then v_ints:='{}';elsif split_part(v_action,':',2)='prev'then v_page:=greatest(0,v_page-1);elsif split_part(v_action,':',2)='next'then v_page:=least(v_pages-1,v_page+1);elsif split_part(v_action,':',2)='done'then if cardinality(v_ints)=0 then v_view:='neighborhoods';else v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'rent',v_state,v_revision);v_view:='rent';end if;else v_slot:=split_part(v_action,':',2)::integer;if v_slot=any(v_ints)then v_ints:=array_remove(v_ints,v_slot);else v_ints:=array_append(v_ints,v_slot);end if;end if;
  if v_view is null then v_state:=jsonb_set(jsonb_set(v_state,'{neighborhood_ids}',to_jsonb(v_ints),true),'{neighborhood_page}',to_jsonb(v_page),true);v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'neighborhoods',v_state,v_revision);v_view:='neighborhoods';end if;
 elsif v_action~'^sharea:' then
  v_location_mode:=case when v_state->>'sh_area_level' in('counties','municipalities','mixed') then v_state->>'sh_area_level' else 'counties' end;
  v_page:=greatest(0,coalesce((v_state->>'area_page')::integer,0));
  select coalesce(array_agg(value),'{}'::text[]) into v_codes from jsonb_array_elements_text(coalesce(v_state->'location_area_codes','[]'));
  v_code:=split_part(v_action,':',2);
  select greatest(1,ceil(count(*)/20.0)::integer) into v_pages from public.geo_areas where state_code='SH' and is_active and (case when v_location_mode='counties' then area_type in('county','independent_city') when v_location_mode='municipalities' then area_type='municipality' else area_type in('county','independent_city','municipality') end);
  if v_code='back' then v_view:='location';
  elsif v_code='prev' then v_page:=greatest(0,v_page-1);
  elsif v_code='next' then v_page:=least(v_pages-1,v_page+1);
  elsif v_code='clear' then v_codes:='{}';v_page:=0;
  elsif v_code='all' then select coalesce(array_agg(area_code order by name),'{}') into v_codes from public.geo_areas where state_code='SH' and is_active and (case when v_location_mode='counties' then area_type in('county','independent_city') when v_location_mode='municipalities' then area_type='municipality' else area_type in('county','independent_city','municipality') end);
  elsif v_code='done' then if cardinality(v_codes)=0 then v_view:='shareas';else v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'rent',v_state,v_revision);v_view:='rent';end if;
  else
    if exists(select 1 from public.geo_areas where state_code='SH' and is_active and area_code=v_code) then
      if exists(select 1 from public.geo_areas where state_code='SH' and is_active and area_code=v_code and area_type in('county','independent_city')) then
        if v_code=any(v_codes) then v_codes:=array_remove(v_codes,v_code);else v_codes:=array_append(array(select x from unnest(v_codes)x where x not in(select area_code from public.geo_areas where state_code='SH' and is_active and parent_code=v_code)),v_code);end if;
      else
        select parent_code into v_parent_code
        from public.geo_areas
        where state_code='SH' and is_active and area_code=v_code
        limit 1;
        if v_parent_code=any(v_codes) then
          v_codes:=array_remove(v_codes,v_parent_code);
          v_codes:=array(
            select x from unnest(v_codes) x where x<>v_code
            union
            select sibling.area_code
            from public.geo_areas sibling
            where sibling.state_code='SH' and sibling.is_active
              and sibling.parent_code=v_parent_code and sibling.area_code<>v_code
            order by 1
          );
        elsif v_code=any(v_codes) then
          v_codes:=array_remove(v_codes,v_code);
        else
          v_codes:=array_append(v_codes,v_code);
        end if;
      end if;
    end if;
  end if;
  if v_view is null or v_view='shareas' then v_state:=v_state||jsonb_build_object('location_mode','schleswig_holstein_areas','sh_area_level',v_location_mode,'location_area_codes',to_jsonb(v_codes),'area_page',v_page);v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,'shareas',v_state,v_revision);v_view:='shareas';end if;
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
 if v_view in('boroughs','neighborhoods','review')then v_data:=v_data||jsonb_build_object('boroughs',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)order by sort_order),'[]')from public.hamburg_boroughs),'neighborhoods',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'borough_id',borough_id)order by id),'[]')from public.hamburg_neighborhoods));end if; if v_view='shareas' or (v_view='review' and v_state->>'location_mode'='schleswig_holstein_areas') then v_data:=v_data||jsonb_build_object('schleswig_holstein_areas',public.get_schleswig_holstein_areas());end if;
 perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
 return jsonb_build_object('fast',true,'claim',v_claim,'view',v_view,'state',v_state,'data',v_data,'user',v_user,'is_premium',v_premium,'critical',v_is_critical,'reward',v_reward);
end $function$
