CREATE OR REPLACE FUNCTION public.telegram_fast_applicant_prompt_v1(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_action text:=coalesce(p_payload#>>'{callback_query,data}','');
  v_tg bigint:=nullif(p_payload#>>'{callback_query,from,id}','')::bigint;
  v_lang text;v_base jsonb;v_claim integer;v_user jsonb;v_uid uuid;v_premium boolean;
  v_profile jsonb;v_docs jsonb:='[]'::jsonb;v_missing text[]:='{}';v_name text;v_type text;
begin
  if v_tg is null or not (
    v_action='platforms:profile-new'
    or v_action~'^platforms:profile-field:(first_name|last_name|email|phone|street|house_number|postcode|city|wbs_status|move_in_date|message_apartment|message_house|message_temporary_wg|message_swap)$'
    or v_action~'^platforms:doc-upload:(wbs|urgency_certificate|guarantee|schufa|income_proof|rent_clearance|other)$'
  ) then return jsonb_build_object('fast',false);end if;
  select ui_language into v_lang from public.bot_users where telegram_user_id=v_tg;
  if v_lang is distinct from 'de' then return jsonb_build_object('fast',false);end if;

  v_base:=public.prepare_telegram_update(p_payload);v_claim:=coalesce((v_base->>'claim')::integer,0);
  if v_claim<=0 then return v_base||jsonb_build_object('fast',true);end if;
  v_user:=v_base->'user';v_uid:=(v_user->>'id')::uuid;v_premium:=app_private.user_is_premium(v_uid);
  if not v_premium then
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'claim',v_claim,'view','platforms_locked','user',v_user,'is_premium',false);
  end if;
  select to_jsonb(p) into v_profile from public.applicant_profiles p where p.user_id=v_uid;

  if v_action='platforms:profile-new' then
    if v_profile is null then
      perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
      return jsonb_build_object('fast',true,'claim',v_claim,'view','applicant_setup_prompt','user',v_user,'is_premium',true);
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'document_type',document_type,'original_filename',original_filename,'send_with_auto_apply',send_with_auto_apply) order by created_at),'[]'::jsonb)
      into v_docs from public.applicant_documents where user_id=v_uid;
    v_missing:=public.application_profile_missing_fields(v_uid);
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'claim',v_claim,'view','applicant_profile','user',v_user,'is_premium',true,'data',jsonb_build_object('profile',v_profile,'docs',v_docs,'missing',to_jsonb(v_missing)));
  end if;

  if v_profile is null then
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'claim',v_claim,'view','applicant_none','user',v_user,'is_premium',true);
  end if;

  if v_action~'^platforms:profile-field:' then
    v_name:=split_part(v_action,':',3);
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'claim',v_claim,'view','applicant_prompt','user',v_user,'is_premium',true,'data',jsonb_build_object('name',v_name));
  end if;

  v_type:=split_part(v_action,':',3);
  perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
  return jsonb_build_object('fast',true,'claim',v_claim,'view','doc_upload_prompt','user',v_user,'is_premium',true,'data',jsonb_build_object('type',v_type));
end
$function$
;

CREATE OR REPLACE FUNCTION public.telegram_fast_applicant_read_v1(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_action text:=coalesce(p_payload#>>'{callback_query,data}','');
  v_tg bigint:=nullif(p_payload#>>'{callback_query,from,id}','')::bigint;
  v_lang text;v_base jsonb;v_claim integer;v_user jsonb;v_uid uuid;v_premium boolean;
  v_profile jsonb;v_docs jsonb:='[]'::jsonb;v_missing text[]:='{}';v_view text;v_name text;
begin
  if v_tg is null or not (
    v_action in ('platforms:profile','platforms:profile-texts','platforms:docs')
    or v_action~'^platforms:profile-text:(message_apartment|message_house|message_temporary_wg|message_swap)$'
    or v_action~'^platforms:profile-field:(salutation|household_type|employment_status|income_range|pets|move_in_preference|schufa_status)$'
  ) then return jsonb_build_object('fast',false);end if;

  select ui_language into v_lang from public.bot_users where telegram_user_id=v_tg;
  if v_lang is distinct from 'de' or p_payload#>'{callback_query,message,photo}' is not null then return jsonb_build_object('fast',false);end if;

  v_base:=public.prepare_telegram_update(p_payload);v_claim:=coalesce((v_base->>'claim')::integer,0);
  if v_claim<=0 then return v_base||jsonb_build_object('fast',true);end if;
  v_user:=v_base->'user';v_uid:=(v_user->>'id')::uuid;
  if coalesce((v_user->>'is_active')::boolean,false) is false then
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'blocked',true,'claim',v_claim);
  end if;

  v_premium:=app_private.user_is_premium(v_uid);
  if not v_premium then
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'claim',v_claim,'view','platforms_locked','user',v_user,'is_premium',false);
  end if;

  select to_jsonb(p) into v_profile from public.applicant_profiles p where p.user_id=v_uid;
  if v_profile is null then
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'claim',v_claim,'view','applicant_none','user',v_user,'is_premium',true);
  end if;

  if v_action in ('platforms:profile','platforms:docs') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'document_type',document_type,'original_filename',original_filename,'send_with_auto_apply',send_with_auto_apply
    ) order by created_at),'[]'::jsonb)
    into v_docs
    from public.applicant_documents where user_id=v_uid;
  end if;

  if v_action='platforms:profile' then
    v_missing:=public.application_profile_missing_fields(v_uid);v_view:='applicant_profile';
  elsif v_action='platforms:profile-texts' then v_view:='applicant_texts';
  elsif v_action='platforms:docs' then v_view:='applicant_docs';
  elsif v_action~'^platforms:profile-text:' then
    v_name:=split_part(v_action,':',3);v_view:='applicant_text_detail';
  else
    v_name:=split_part(v_action,':',3);v_view:='applicant_choice';
  end if;

  perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
  return jsonb_build_object(
    'fast',true,'claim',v_claim,'view',v_view,'user',v_user,'is_premium',true,
    'data',jsonb_build_object('profile',v_profile,'docs',v_docs,'missing',to_jsonb(v_missing),'name',v_name)
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.telegram_fast_applicant_write_v1(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_action text:=coalesce(p_payload#>>'{callback_query,data}','');
  v_tg bigint:=nullif(p_payload#>>'{callback_query,from,id}','')::bigint;
  v_lang text;v_base jsonb;v_claim integer;v_user jsonb;v_uid uuid;v_premium boolean;
  v_field text;v_choice text;v_profile jsonb;v_docs jsonb:='[]'::jsonb;v_missing text[]:='{}';
begin
  if v_tg is null or v_action !~ '^platforms:profile-set:(salutation|household_type|employment_status|income_range|pets|move_in_preference|schufa_status):[A-Z0-9_]+$'
     or v_action='platforms:profile-set:move_in_preference:EXACT_DATE'
  then return jsonb_build_object('fast',false);end if;

  select ui_language into v_lang from public.bot_users where telegram_user_id=v_tg;
  if v_lang is distinct from 'de' or p_payload#>'{callback_query,message,photo}' is not null then return jsonb_build_object('fast',false);end if;

  v_base:=public.prepare_telegram_update(p_payload);v_claim:=coalesce((v_base->>'claim')::integer,0);
  if v_claim<=0 then return v_base||jsonb_build_object('fast',true);end if;
  v_user:=v_base->'user';v_uid:=(v_user->>'id')::uuid;v_premium:=app_private.user_is_premium(v_uid);
  if not v_premium then
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'claim',v_claim,'view','platforms_locked','user',v_user,'is_premium',false);
  end if;

  if not exists(select 1 from public.applicant_profiles where user_id=v_uid) then
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'claim',v_claim,'view','applicant_none','user',v_user,'is_premium',true);
  end if;

  v_field:=split_part(v_action,':',3);v_choice:=split_part(v_action,':',4);

  if v_field='salutation' and v_choice=any(array['MR','MS','DIVERSE','NEUTRAL','NOT_SPECIFIED','COMPANY']) then
    update public.applicant_profiles set salutation=v_choice,updated_at=now() where user_id=v_uid;
  elsif v_field='household_type' and v_choice=any(array['SINGLE','TWO_ADULTS','FAMILY','SHARED_FLAT','NOT_SPECIFIED']) then
    update public.applicant_profiles set household_type=v_choice,household_size=case when v_choice='SINGLE' then 1 when v_choice='TWO_ADULTS' then 2 else null end,updated_at=now() where user_id=v_uid;
  elsif v_field='employment_status' and v_choice=any(array['NOT_SPECIFIED','EMPLOYEE','WORKER','SELF_EMPLOYED','CIVIL_SERVANT','APPRENTICE','STUDENT','DOCTORAL','HOMEMAKER','JOBSEEKER','RETIRED','OTHER']) then
    update public.applicant_profiles set employment_status=v_choice,updated_at=now() where user_id=v_uid;
  elsif v_field='income_range' and v_choice=any(array['HOUSING_BENEFIT','UNDER_500','500_1000','1000_1500','1500_2000','2000_3000','3000_4000','4000_5000','OVER_5000','5000_6000','6000_7000','OVER_7000','NOT_SPECIFIED']) then
    update public.applicant_profiles set income_range=v_choice,monthly_net_income=null,updated_at=now() where user_id=v_uid;
  elsif v_field='pets' and v_choice=any(array['NONE','YES','NO']) then
    update public.applicant_profiles set pets=case v_choice when 'NONE' then 'Keine Angaben' when 'YES' then 'Ja' else 'Nein' end,updated_at=now() where user_id=v_uid;
  elsif v_field='move_in_preference' and v_choice=any(array['NOT_SPECIFIED','FLEXIBLE','IMMEDIATE','WITHIN_1_MONTH','WITHIN_3_MONTHS','AFTER_3_MONTHS']) then
    update public.applicant_profiles set move_in_preference=v_choice,move_in_date=null,updated_at=now() where user_id=v_uid;
  elsif v_field='schufa_status' and v_choice=any(array['NOT_SPECIFIED','AVAILABLE','NOT_AVAILABLE']) then
    update public.applicant_profiles set schufa_status=v_choice,updated_at=now() where user_id=v_uid;
  else
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'claim',v_claim,'view','applicant_profile','user',v_user,'is_premium',true,'data',jsonb_build_object('profile',(select to_jsonb(p) from public.applicant_profiles p where user_id=v_uid),'docs','[]'::jsonb,'missing',to_jsonb(public.application_profile_missing_fields(v_uid))));
  end if;

  select to_jsonb(p) into v_profile from public.applicant_profiles p where p.user_id=v_uid;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'document_type',document_type,'original_filename',original_filename,'send_with_auto_apply',send_with_auto_apply) order by created_at),'[]'::jsonb)
  into v_docs from public.applicant_documents where user_id=v_uid;
  v_missing:=public.application_profile_missing_fields(v_uid);
  perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
  return jsonb_build_object('fast',true,'claim',v_claim,'view','applicant_profile','user',v_user,'is_premium',true,'data',jsonb_build_object('profile',v_profile,'docs',v_docs,'missing',to_jsonb(v_missing)));
end
$function$
;

CREATE OR REPLACE FUNCTION public.telegram_fast_platform_action_v1(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_action text := coalesce(p_payload#>>'{callback_query,data}','');
  v_tg bigint := nullif(p_payload#>>'{callback_query,from,id}','')::bigint;
  v_lang text;
  v_base jsonb;
  v_claim integer;
  v_user jsonb;
  v_uid uuid;
  v_premium boolean;
  v_source integer;
  v_provider text;
  v_provider_field text;
  v_enabled boolean;
  v_superseded boolean := false;
  v_missing text[] := '{}';
  v_connections jsonb := '[]'::jsonb;
  v_prefs jsonb := '{}'::jsonb;
  v_global boolean := false;
  v_connection jsonb;
begin
  if v_tg is null or v_action='' then return jsonb_build_object('fast',false); end if;
  if not (
    v_action='platforms'
    or v_action in ('platforms:on','platforms:off')
    or v_action ~ '^platforms:(pause|resume|provider):[1-4]$'
  ) then return jsonb_build_object('fast',false); end if;

  select ui_language into v_lang from public.bot_users where telegram_user_id=v_tg;
  if v_lang is distinct from 'de' or p_payload#>'{callback_query,message,photo}' is not null then
    return jsonb_build_object('fast',false);
  end if;

  v_base := public.prepare_telegram_update(p_payload);
  v_claim := coalesce((v_base->>'claim')::integer,0);
  if v_claim<=0 then return v_base||jsonb_build_object('fast',true); end if;

  v_user := v_base->'user';
  v_uid := (v_user->>'id')::uuid;
  if coalesce((v_user->>'is_active')::boolean,false) is false then
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'blocked',true,'claim',v_claim);
  end if;

  v_premium := app_private.user_is_premium(v_uid);
  if not v_premium then
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'claim',v_claim,'view','platforms_locked','user',v_user,'is_premium',false);
  end if;

  if v_action in ('platforms:on','platforms:off') then
    select exists(
      select 1 from public.bot_events e
      where e.telegram_user_id=v_tg
        and e.telegram_update_id>(p_payload->>'update_id')::bigint
        and coalesce(e.payload#>>'{callback_query,data}','') in ('platforms:on','platforms:off')
    ) into v_superseded;

    if not v_superseded then
      if v_action='platforms:off' then
        perform public.set_application_enabled_shared(v_uid,false);
      else
        v_missing := public.application_profile_missing_fields(v_uid);
        if cardinality(v_missing)>0 then
          perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
          return jsonb_build_object(
            'fast',true,'claim',v_claim,'view','platforms_missing',
            'user',v_user,'is_premium',true,'data',jsonb_build_object('missing',to_jsonb(v_missing))
          );
        end if;
        begin
          perform public.set_application_enabled_shared(v_uid,true);
        exception when others then
          perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
          return jsonb_build_object(
            'fast',true,'claim',v_claim,'view','platforms_enable_error',
            'user',v_user,'is_premium',true,
            'data',jsonb_build_object('reason',
              case
                when sqlerrm like '%provider_required%' then 'provider_required'
                when sqlerrm like '%profile_incomplete%' then 'profile_incomplete'
                else 'unknown'
              end)
          );
        end;
      end if;
    end if;
  elsif v_action ~ '^platforms:(pause|resume):[1-4]$' then
    v_source := split_part(v_action,':',3)::integer;
    v_provider := case v_source when 1 then 'immoscout' when 2 then 'kleinanzeigen' when 3 then 'immomio' else 'immowelt' end;

    select exists(
      select 1 from public.bot_events e
      where e.telegram_user_id=v_tg
        and e.telegram_update_id>(p_payload->>'update_id')::bigint
        and coalesce(e.payload#>>'{callback_query,data}','') in ('platforms:pause:'||v_source,'platforms:resume:'||v_source)
    ) into v_superseded;

    if not v_superseded then
      perform public.set_application_provider_enabled_shared(
        v_uid,v_provider,split_part(v_action,':',2)='resume'
      );
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('provider',provider,'status',status) order by provider),'[]'::jsonb)
  into v_connections
  from public.platform_connections
  where user_id=v_uid;

  select coalesce(auto_apply_enabled,false) into v_global
  from public.bot_users where id=v_uid;

  select coalesce(to_jsonb(p),'{}'::jsonb) into v_prefs
  from public.application_preferences p where p.user_id=v_uid;

  if v_action ~ '^platforms:provider:[1-4]$' then
    v_source := split_part(v_action,':',3)::integer;
    v_provider := case v_source when 1 then 'immoscout' when 2 then 'kleinanzeigen' when 3 then 'immomio' else 'immowelt' end;
    select value into v_connection
    from jsonb_array_elements(v_connections)
    where value->>'provider'=v_provider
    limit 1;
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object(
      'fast',true,'claim',v_claim,'view','platform_provider','user',v_user,'is_premium',true,
      'data',jsonb_build_object('source',v_source,'provider',v_provider,'connection',coalesce(v_connection,'{}'::jsonb))
    );
  end if;

  perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
  return jsonb_build_object(
    'fast',true,'claim',v_claim,'view','platforms','user',v_user,'is_premium',true,
    'data',jsonb_build_object('connections',v_connections,'prefs',v_prefs,'auto_apply_enabled',v_global)
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.telegram_fast_profile_edit_v1(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_action text:=coalesce(p_payload#>>'{callback_query,data}','');
  v_tg bigint:=nullif(p_payload#>>'{callback_query,from,id}','')::bigint;
  v_lang text;v_base jsonb;v_claim integer;v_user jsonb;v_uid uuid;v_premium boolean;v_limit integer;
  v_slot integer;v_field text;v_profile public.search_profiles%rowtype;v_state jsonb;v_revision integer:=0;
  v_borough_ids jsonb:='[]'::jsonb;v_neighborhood_ids jsonb:='[]'::jsonb;v_view text;
begin
  if v_tg is null or not (
    v_action~'^profile:edit:[1-4]$'
    or v_action~'^profile:edit-field:[1-4]:(types|location|rent|roomarea|rooms|area)$'
  ) then return jsonb_build_object('fast',false);end if;
  select ui_language into v_lang from public.bot_users where telegram_user_id=v_tg;
  if v_lang is distinct from 'de' or p_payload#>'{callback_query,message,photo}' is not null then return jsonb_build_object('fast',false);end if;

  v_base:=public.prepare_telegram_update(p_payload);v_claim:=coalesce((v_base->>'claim')::integer,0);
  if v_claim<=0 then return v_base||jsonb_build_object('fast',true);end if;
  v_user:=v_base->'user';v_uid:=(v_user->>'id')::uuid;
  if coalesce((v_user->>'is_active')::boolean,false) is false then
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'blocked',true,'claim',v_claim);
  end if;
  v_premium:=app_private.user_is_premium(v_uid);v_limit:=case when v_premium then 4 else 1 end;
  v_slot:=split_part(v_action,':',3)::integer;
  if v_slot<1 or v_slot>v_limit then
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'claim',v_claim,'view','premium','user',v_user,'is_premium',v_premium);
  end if;
  select * into v_profile from public.search_profiles where user_id=v_uid and profile_slot=v_slot;
  if not found then
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'claim',v_claim,'view','profile_list','user',v_user,'is_premium',v_premium,'data',jsonb_build_object(
      'profiles',(select coalesce(jsonb_agg(jsonb_build_object('profile_slot',profile_slot,'name',name,'is_active',is_active) order by profile_slot),'[]') from public.search_profiles where user_id=v_uid and profile_slot<=v_limit),
      'profile_limit',v_limit
    ));
  end if;

  v_revision:=coalesce(((coalesce(v_user->'onboarding_state','{}'::jsonb))->>'_revision')::integer,0);

  if v_action~'^profile:edit:[1-4]$' then
    perform public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,null,coalesce(v_user->'onboarding_state','{}'::jsonb),v_revision);
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'claim',v_claim,'view','profile_edit_menu','user',v_user,'is_premium',v_premium,'data',jsonb_build_object('profile',to_jsonb(v_profile)));
  end if;

  v_field:=split_part(v_action,':',4);
  select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into v_borough_ids
  from public.hamburg_boroughs where name=any(coalesce(v_profile.boroughs,'{}'::text[]));
  select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into v_neighborhood_ids
  from public.hamburg_neighborhoods
  where name=any(
    case
      when cardinality(coalesce(v_profile.neighborhoods,'{}'::text[]))>0 then v_profile.neighborhoods
      when v_profile.location_mode='neighborhoods' then coalesce(v_profile.districts,'{}'::text[])
      else '{}'::text[]
    end
  );

  v_state:=jsonb_build_object(
    'profile_slot',v_profile.profile_slot,
    'property_types',coalesce(to_jsonb(v_profile.property_types),'[]'::jsonb),
    'location_mode',v_profile.location_mode,
    'borough_ids',v_borough_ids,
    'neighborhood_ids',v_neighborhood_ids,
    'neighborhood_page',0,
    'max_warm_rent',v_profile.max_warm_rent,
    'min_rooms',v_profile.min_rooms,
    'min_area_sqm',v_profile.min_area_sqm,
    'min_room_area_sqm',v_profile.min_room_area_sqm,
    'wbs_only',coalesce(v_profile.wbs_only,false),
    'furnished_preference',coalesce(v_profile.furnished_preference,'any'),
    'require_known_warm_rent',coalesce(v_profile.require_known_warm_rent,false),
    'max_deposit',v_profile.max_deposit,
    '_flow',substr(encode(extensions.gen_random_bytes(6),'hex'),1,12),
    '_revision',v_revision,
    'profile_edit',true
  );
  v_view:=case when v_field='roomarea' then 'rooms' else v_field end;
  v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,v_view,v_state,v_revision);
  perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
  return jsonb_build_object('fast',true,'claim',v_claim,'view',v_view,'state',v_state,'data','{}'::jsonb,'user',v_user,'is_premium',v_premium,'critical',false);
end
$function$
;

CREATE OR REPLACE FUNCTION public.telegram_fast_save_v1(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_action text:=coalesce(p_payload#>>'{callback_query,data}','');
  v_tg bigint:=nullif(p_payload#>>'{callback_query,from,id}','')::bigint;
  v_listing uuid;
  v_lang text;
  v_base jsonb;
  v_claim integer;
  v_user jsonb;
  v_uid uuid;
  v_premium boolean;
  v_saved boolean;
begin
  if v_tg is null or v_action !~ '^save:[0-9a-fA-F-]{36}$' then return jsonb_build_object('fast',false); end if;
  begin v_listing:=split_part(v_action,':',2)::uuid; exception when others then return jsonb_build_object('fast',false); end;

  select ui_language into v_lang from public.bot_users where telegram_user_id=v_tg;
  if v_lang is distinct from 'de' then return jsonb_build_object('fast',false); end if;

  v_base:=public.prepare_telegram_update(p_payload);
  v_claim:=coalesce((v_base->>'claim')::integer,0);
  if v_claim<=0 then return v_base||jsonb_build_object('fast',true); end if;
  v_user:=v_base->'user';v_uid:=(v_user->>'id')::uuid;

  if coalesce((v_user->>'is_active')::boolean,false) is false then
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'blocked',true,'claim',v_claim);
  end if;

  v_premium:=app_private.user_is_premium(v_uid);
  if not v_premium then
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'claim',v_claim,'view','save_locked','user',v_user,'is_premium',false);
  end if;

  v_saved:=public.toggle_saved_once((p_payload->>'update_id')::bigint,v_uid,v_listing);
  perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
  return jsonb_build_object('fast',true,'claim',v_claim,'view','save_toggle','user',v_user,'is_premium',true,'data',jsonb_build_object('saved',v_saved,'action',v_action));
end
$function$
;

CREATE OR REPLACE FUNCTION public.telegram_fast_search_extra_v1(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_action text:=coalesce(p_payload#>>'{callback_query,data}','');
  v_tg bigint:=nullif(p_payload#>>'{callback_query,from,id}','')::bigint;
  v_lang text;v_base jsonb;v_claim integer;v_user jsonb;v_uid uuid;
  v_state jsonb;v_revision integer:=0;v_value text;v_step text;v_view text;
  v_category_edit boolean:=false;v_had_location boolean:=false;
begin
  if v_tg is null or not (
    v_action~'^type:(Wohnung|Haus|WG|Tauschwohnung)$'
    or v_action~'^edit:(types|location|rent|rooms|area)$'
  ) then return jsonb_build_object('fast',false);end if;
  select ui_language into v_lang from public.bot_users where telegram_user_id=v_tg;
  if v_lang is distinct from 'de' or p_payload#>'{callback_query,message,photo}' is not null then return jsonb_build_object('fast',false);end if;

  v_base:=public.prepare_telegram_update(p_payload);v_claim:=coalesce((v_base->>'claim')::integer,0);
  if v_claim<=0 then return v_base||jsonb_build_object('fast',true);end if;
  v_user:=v_base->'user';v_uid:=(v_user->>'id')::uuid;
  if coalesce((v_user->>'is_active')::boolean,false) is false then
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'blocked',true,'claim',v_claim);
  end if;

  v_state:=coalesce(v_user->'onboarding_state','{}'::jsonb);
  v_revision:=coalesce((v_state->>'_revision')::integer,0);

  if v_action~'^edit:' then
    v_step:=split_part(v_action,':',2);
    v_state:=jsonb_set(v_state,'{edit_return}','true'::jsonb,true);
    v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,v_step,v_state,v_revision);
    v_view:=v_step;
  else
    v_value:=split_part(v_action,':',2);
    v_category_edit:=coalesce((v_state->>'profile_edit')::boolean,false) or coalesce((v_state->>'edit_return')::boolean,false);
    v_had_location:=coalesce(v_state->>'location_mode','') in ('all_hamburg','boroughs','neighborhoods');
    v_state:=jsonb_set(v_state,'{property_types}',jsonb_build_array(v_value),true);
    v_state:=jsonb_set(v_state,'{min_rooms}','null'::jsonb,true);
    v_state:=jsonb_set(v_state,'{min_area_sqm}','null'::jsonb,true);
    v_state:=jsonb_set(v_state,'{min_room_area_sqm}','null'::jsonb,true);
    if v_category_edit then v_state:=(v_state-'profile_edit')-'edit_return';end if;
    v_step:=case when v_category_edit and v_had_location then 'rent' else 'location' end;
    v_state:=public.save_ui_state(v_uid,(p_payload->>'update_id')::bigint,v_claim,v_step,v_state,v_revision);
    v_view:=v_step;
  end if;

  perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
  return jsonb_build_object('fast',true,'claim',v_claim,'view',v_view,'state',v_state,'data','{}'::jsonb,'user',v_user,'is_premium',app_private.user_is_premium(v_uid),'critical',false);
end
$function$
;

revoke all on function public.telegram_fast_platform_action_v1(jsonb) from public, anon, authenticated;
grant execute on function public.telegram_fast_platform_action_v1(jsonb) to service_role;

revoke all on function public.telegram_fast_save_v1(jsonb) from public, anon, authenticated;
grant execute on function public.telegram_fast_save_v1(jsonb) to service_role;

revoke all on function public.telegram_fast_search_extra_v1(jsonb) from public, anon, authenticated;
grant execute on function public.telegram_fast_search_extra_v1(jsonb) to service_role;

revoke all on function public.telegram_fast_profile_edit_v1(jsonb) from public, anon, authenticated;
grant execute on function public.telegram_fast_profile_edit_v1(jsonb) to service_role;

revoke all on function public.telegram_fast_applicant_read_v1(jsonb) from public, anon, authenticated;
grant execute on function public.telegram_fast_applicant_read_v1(jsonb) to service_role;

revoke all on function public.telegram_fast_applicant_write_v1(jsonb) from public, anon, authenticated;
grant execute on function public.telegram_fast_applicant_write_v1(jsonb) to service_role;

revoke all on function public.telegram_fast_applicant_prompt_v1(jsonb) from public, anon, authenticated;
grant execute on function public.telegram_fast_applicant_prompt_v1(jsonb) to service_role;
