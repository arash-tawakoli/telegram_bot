alter table public.applicant_profiles
  alter column email drop not null;

alter table public.applicant_profiles
  drop constraint if exists applicant_profiles_email_check;

alter table public.applicant_profiles
  add constraint applicant_profiles_email_check
  check (
    email is null
    or (length(trim(email)) >= 3 and length(trim(email)) <= 320)
  );

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
  )
$function$;

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
    return array['Vorname','Nachname'];
  end if;

  if nullif(trim(coalesce(p.first_name,'')),'') is null then
    v_missing := array_append(v_missing,'Vorname');
  end if;
  if nullif(trim(coalesce(p.last_name,'')),'') is null then
    v_missing := array_append(v_missing,'Nachname');
  end if;
  return v_missing;
end
$function$;

create or replace function public.application_profile_missing_fields(p_user uuid)
returns text[]
language sql
stable
set search_path to ''
as $function$
  select app_private.applicant_profile_missing_fields(p_user)
$function$;

revoke execute on function public.application_profile_missing_fields(uuid)
  from public, anon, authenticated;
grant execute on function public.application_profile_missing_fields(uuid)
  to service_role;

create or replace function public.set_application_enabled_shared(p_user uuid, p_enabled boolean)
returns boolean
language plpgsql
set search_path to ''
as $function$
begin
  if not exists(select 1 from public.bot_users where id=p_user and is_active) then
    raise exception 'participant_unavailable';
  end if;
  if p_enabled and not app_private.user_is_premium(p_user) then
    raise exception 'premium_required';
  end if;
  if p_enabled and not app_private.applicant_profile_identity_ready(p_user) then
    raise exception 'profile_incomplete';
  end if;
  if p_enabled and not app_private.user_has_application_provider(p_user) then
    raise exception 'provider_required';
  end if;

  insert into public.application_preferences(
    user_id,enabled,immoscout_enabled,kleinanzeigen_enabled,immomio_enabled,immowelt_enabled
  )
  values(p_user,p_enabled,p_enabled,p_enabled,p_enabled,p_enabled)
  on conflict(user_id) do update
  set enabled=excluded.enabled,
      updated_at=now();

  update public.bot_users
  set auto_apply_enabled=p_enabled,updated_at=now()
  where id=p_user;

  if not p_enabled then
    update public.applications
    set status='failed',
        last_error='auto_apply_disabled',
        wait_reason=null,
        lease_until=null,
        next_attempt_at=null
    where user_id=p_user
      and status='pending'
      and submission_started_at is null;
  end if;

  return true;
end
$function$;
