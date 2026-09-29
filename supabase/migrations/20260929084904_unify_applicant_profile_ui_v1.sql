-- Keep the current Bewerberprofil button-grid UI identical for every premium Telegram user.
-- Users without an applicant_profiles row get a lazy empty shell instead of the legacy bulk setup prompt.

create or replace function public.telegram_fast_applicant_prompt_v1(p_payload jsonb)
returns jsonb
language plpgsql
set search_path to ''
as $function$
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
  if v_profile is null then
    insert into public.applicant_profiles(user_id,first_name,last_name)
    values(v_uid,'','')
    on conflict (user_id) do nothing;
    select to_jsonb(p) into v_profile from public.applicant_profiles p where p.user_id=v_uid;
  end if;

  if v_action='platforms:profile-new' then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'document_type',document_type,'original_filename',original_filename,'send_with_auto_apply',send_with_auto_apply) order by created_at),'[]'::jsonb)
      into v_docs from public.applicant_documents where user_id=v_uid;
    v_missing:=public.application_profile_missing_fields(v_uid);
    perform public.finish_ui_update((p_payload->>'update_id')::bigint,v_claim,true,null,'{}');
    return jsonb_build_object('fast',true,'claim',v_claim,'view','applicant_profile','user',v_user,'is_premium',true,'data',jsonb_build_object('profile',v_profile,'docs',v_docs,'missing',to_jsonb(v_missing)));
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
$function$;

create or replace function public.telegram_fast_applicant_read_v1(p_payload jsonb)
returns jsonb
language plpgsql
set search_path to ''
as $function$
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
    insert into public.applicant_profiles(user_id,first_name,last_name)
    values(v_uid,'','')
    on conflict (user_id) do nothing;
    select to_jsonb(p) into v_profile from public.applicant_profiles p where p.user_id=v_uid;
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
$function$;

create or replace function public.telegram_fast_applicant_write_v1(p_payload jsonb)
returns jsonb
language plpgsql
set search_path to ''
as $function$
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

  insert into public.applicant_profiles(user_id,first_name,last_name)
  values(v_uid,'','')
  on conflict (user_id) do nothing;

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
$function$;
