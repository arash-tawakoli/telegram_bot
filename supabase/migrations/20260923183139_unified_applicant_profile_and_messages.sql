alter table public.applicant_profiles
  add column if not exists message_apartment text,
  add column if not exists message_house text,
  add column if not exists message_temporary_wg text,
  add column if not exists message_swap text;

alter table public.applicant_profiles
  drop constraint if exists applicant_profiles_message_apartment_check,
  drop constraint if exists applicant_profiles_message_house_check,
  drop constraint if exists applicant_profiles_message_temporary_wg_check,
  drop constraint if exists applicant_profiles_message_swap_check;

alter table public.applicant_profiles
  add constraint applicant_profiles_message_apartment_check
    check (message_apartment is null or length(message_apartment) <= 4000),
  add constraint applicant_profiles_message_house_check
    check (message_house is null or length(message_house) <= 4000),
  add constraint applicant_profiles_message_temporary_wg_check
    check (message_temporary_wg is null or length(message_temporary_wg) <= 4000),
  add constraint applicant_profiles_message_swap_check
    check (message_swap is null or length(message_swap) <= 4000);

update public.applicant_profiles
set message_apartment = coalesce(nullif(trim(message_apartment),''), nullif(trim(default_message),'')),
    message_house = coalesce(nullif(trim(message_house),''), nullif(trim(default_message),'')),
    message_temporary_wg = coalesce(nullif(trim(message_temporary_wg),''), nullif(trim(default_message),'')),
    message_swap = coalesce(nullif(trim(message_swap),''), nullif(trim(default_message),''))
where nullif(trim(default_message),'') is not null
  and (
    nullif(trim(message_apartment),'') is null
    or nullif(trim(message_house),'') is null
    or nullif(trim(message_temporary_wg),'') is null
    or nullif(trim(message_swap),'') is null
  );

comment on column public.applicant_profiles.default_message is
  'Legacy fallback only. Auto-application uses the four property-specific message fields.';
comment on column public.applicant_profiles.message_apartment is
  'Required auto-application message for Wohnung listings.';
comment on column public.applicant_profiles.message_house is
  'Required auto-application message for Haus listings.';
comment on column public.applicant_profiles.message_temporary_wg is
  'Required auto-application message for WG and explicit temporary-rental listings.';
comment on column public.applicant_profiles.message_swap is
  'Required auto-application message for Tauschwohnung listings.';

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
    return array[
      'Anrede','Vorname','Nachname','E-Mail-Adresse','Telefonnummer',
      'Straße','Hausnummer','PLZ','Ort','Haushaltsgröße',
      'Beschäftigungsverhältnis','Monatliches Nettoeinkommen','Haustiere',
      'Gewünschtes Einzugsdatum','SCHUFA-Status',
      'Bewerbungstext Wohnung','Bewerbungstext Haus',
      'Bewerbungstext Auf Zeit & WG','Bewerbungstext Tauschwohnung'
    ];
  end if;

  if nullif(trim(coalesce(p.salutation,'')),'') is null then
    v_missing := array_append(v_missing,'Anrede');
  end if;
  if nullif(trim(coalesce(p.first_name,'')),'') is null then
    v_missing := array_append(v_missing,'Vorname');
  end if;
  if nullif(trim(coalesce(p.last_name,'')),'') is null then
    v_missing := array_append(v_missing,'Nachname');
  end if;
  if nullif(trim(coalesce(p.email,'')),'') is null
     or position('@' in p.email) <= 1 then
    v_missing := array_append(v_missing,'E-Mail-Adresse');
  end if;
  if nullif(trim(coalesce(p.phone,'')),'') is null
     or length(regexp_replace(p.phone,'[^0-9]','','g')) < 7 then
    v_missing := array_append(v_missing,'Telefonnummer');
  end if;
  if nullif(trim(coalesce(p.street,'')),'') is null then
    v_missing := array_append(v_missing,'Straße');
  end if;
  if nullif(trim(coalesce(p.house_number,'')),'') is null then
    v_missing := array_append(v_missing,'Hausnummer');
  end if;
  if coalesce(p.postcode,'') !~ '^[0-9]{5}$' then
    v_missing := array_append(v_missing,'PLZ');
  end if;
  if nullif(trim(coalesce(p.city,'')),'') is null then
    v_missing := array_append(v_missing,'Ort');
  end if;
  if p.household_size is null then
    v_missing := array_append(v_missing,'Haushaltsgröße');
  end if;
  if nullif(trim(coalesce(p.employment_status,'')),'') is null then
    v_missing := array_append(v_missing,'Beschäftigungsverhältnis');
  end if;
  if p.monthly_net_income is null then
    v_missing := array_append(v_missing,'Monatliches Nettoeinkommen');
  end if;
  if nullif(trim(coalesce(p.pets,'')),'') is null then
    v_missing := array_append(v_missing,'Haustiere');
  end if;
  if p.move_in_date is null then
    v_missing := array_append(v_missing,'Gewünschtes Einzugsdatum');
  end if;
  if p.schufa_status not in ('NOT_SPECIFIED','AVAILABLE','NOT_AVAILABLE') then
    v_missing := array_append(v_missing,'SCHUFA-Status');
  end if;
  if nullif(trim(coalesce(p.message_apartment,'')),'') is null then
    v_missing := array_append(v_missing,'Bewerbungstext Wohnung');
  end if;
  if nullif(trim(coalesce(p.message_house,'')),'') is null then
    v_missing := array_append(v_missing,'Bewerbungstext Haus');
  end if;
  if nullif(trim(coalesce(p.message_temporary_wg,'')),'') is null then
    v_missing := array_append(v_missing,'Bewerbungstext Auf Zeit & WG');
  end if;
  if nullif(trim(coalesce(p.message_swap,'')),'') is null then
    v_missing := array_append(v_missing,'Bewerbungstext Tauschwohnung');
  end if;

  return v_missing;
end
$function$;

create or replace function app_private.applicant_profile_complete(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(cardinality(app_private.applicant_profile_missing_fields(p_user)),0)=0
$function$;

create or replace function public.application_profile_missing_fields(p_user uuid)
returns text[]
language sql
stable
security definer
set search_path to ''
as $function$
  select app_private.applicant_profile_missing_fields(p_user)
$function$;

create or replace function public.set_application_enabled_shared(
  p_user uuid,
  p_enabled boolean
)
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
  if p_enabled and not app_private.applicant_profile_complete(p_user) then
    raise exception 'profile_incomplete';
  end if;
  if p_enabled and not app_private.user_has_application_provider(p_user) then
    raise exception 'provider_required';
  end if;

  insert into public.application_preferences(
    user_id,enabled,immoscout_enabled,kleinanzeigen_enabled,immomio_enabled
  )
  values(p_user,p_enabled,p_enabled,p_enabled,p_enabled)
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

create or replace function public.authorize_application_send(p_id uuid,p_token uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  a public.applications%rowtype;
begin
  select * into a
  from public.applications
  where id=p_id
  for update;

  if not found
     or p_token is null
     or a.lease_token is distinct from p_token
     or a.lease_until is null
     or a.lease_until<=now()
     or not app_private.applicant_profile_complete(a.user_id)
  then
    return false;
  end if;

  return public.begin_application_submission(p_id);
end
$function$;

create or replace function app_private.disable_auto_apply_on_incomplete_profile()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if not app_private.applicant_profile_complete(new.user_id) then
    update public.bot_users
    set auto_apply_enabled=false,updated_at=now()
    where id=new.user_id
      and auto_apply_enabled=true;
  end if;
  return new;
end
$function$;

drop trigger if exists applicant_profile_auto_apply_guard on public.applicant_profiles;
create trigger applicant_profile_auto_apply_guard
after insert or update of
  salutation,first_name,last_name,email,phone,street,house_number,postcode,city,
  household_size,employment_status,monthly_net_income,pets,move_in_date,schufa_status,
  message_apartment,message_house,message_temporary_wg,message_swap
on public.applicant_profiles
for each row
execute function app_private.disable_auto_apply_on_incomplete_profile();

update public.bot_users u
set auto_apply_enabled=false,updated_at=now()
where u.auto_apply_enabled=true
  and not app_private.applicant_profile_complete(u.id);
