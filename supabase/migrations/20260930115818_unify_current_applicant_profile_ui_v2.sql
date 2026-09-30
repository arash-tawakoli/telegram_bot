
alter table public.applicant_profiles
  drop constraint if exists applicant_profiles_first_name_check;
alter table public.applicant_profiles
  add constraint applicant_profiles_first_name_check
  check (length(trim(first_name)) <= 120);

alter table public.applicant_profiles
  drop constraint if exists applicant_profiles_last_name_check;
alter table public.applicant_profiles
  add constraint applicant_profiles_last_name_check
  check (length(trim(last_name)) <= 120);

create or replace function app_private.applicant_profile_missing_fields(p_user uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  p public.applicant_profiles%rowtype;
  v_missing text[] := array[]::text[];
begin
  select * into p
  from public.applicant_profiles
  where user_id=p_user;

  if not found then
    return array['Vorname','Nachname','E-Mail-Adresse'];
  end if;

  if nullif(trim(coalesce(p.first_name,'')),'') is null then
    v_missing := array_append(v_missing,'Vorname');
  end if;
  if nullif(trim(coalesce(p.last_name,'')),'') is null then
    v_missing := array_append(v_missing,'Nachname');
  end if;
  if p.email is null or lower(trim(p.email)) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    v_missing := array_append(v_missing,'E-Mail-Adresse');
  end if;
  return v_missing;
end
$function$;

create or replace function app_private.applicant_profile_identity_ready(p_user uuid)
returns boolean
language sql
stable
set search_path to ''
as $function$
  select exists(
    select 1
    from public.applicant_profiles p
    where p.user_id=p_user
      and nullif(trim(coalesce(p.first_name,'')),'') is not null
      and nullif(trim(coalesce(p.last_name,'')),'') is not null
      and p.email is not null
      and lower(trim(p.email)) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  )
$function$;

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

  insert into public.applicant_profiles(user_id,first_name,last_name)
  values(v_uid,'','')
  on conflict (user_id) do nothing;

  select to_jsonb(p) into v_profile from public.applicant_profiles p where p.user_id=v_uid;

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

  insert into public.applicant_profiles(user_id,first_name,last_name)
  values(v_uid,'','')
  on conflict (user_id) do nothing;

  select to_jsonb(p) into v_profile from public.applicant_profiles p where p.user_id=v_uid;

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

insert into public.applicant_profiles(user_id,first_name,last_name)
select b.id,'',''
from public.bot_users b
where b.is_active=true
  and b.telegram_user_id is not null
  and b.chat_id is not null
  and not exists(select 1 from public.applicant_profiles p where p.user_id=b.id)
on conflict (user_id) do nothing;

do $verify$
declare
  v_def text;
begin
  if exists (
    select 1
    from public.bot_users b
    where b.is_active=true
      and b.telegram_user_id is not null
      and b.chat_id is not null
      and not exists(select 1 from public.applicant_profiles p where p.user_id=b.id)
  ) then
    raise exception 'telegram_profile_backfill_failed';
  end if;

  if not ('E-Mail-Adresse'=any(app_private.applicant_profile_missing_fields('00000000-0000-0000-0000-000000000000'::uuid))) then
    raise exception 'email_requirement_missing';
  end if;

  if exists(
    select 1 from public.bot_users b
    where b.auto_apply_enabled=true
      and not app_private.applicant_profile_identity_ready(b.id)
  ) then
    raise exception 'existing_auto_apply_user_not_identity_ready';
  end if;

  select pg_get_functiondef('public.telegram_fast_applicant_prompt_v1(jsonb)'::regprocedure) into v_def;
  if position('applicant_setup_prompt' in v_def)>0 then
    raise exception 'legacy_setup_prompt_still_reachable';
  end if;

  select pg_get_functiondef('public.telegram_fast_applicant_read_v1(jsonb)'::regprocedure) into v_def;
  if position('schufa_status=''AVAILABLE''' in v_def)>0 then
    raise exception 'schufa_specific_ui_routing_still_present';
  end if;
end
$verify$;
