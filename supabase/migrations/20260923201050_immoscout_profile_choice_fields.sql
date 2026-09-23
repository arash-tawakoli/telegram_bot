alter table public.applicant_profiles
  add column if not exists household_type text,
  add column if not exists income_range text,
  add column if not exists move_in_preference text;

alter table public.applicant_profiles
  drop constraint if exists applicant_profiles_household_type_check,
  drop constraint if exists applicant_profiles_income_range_check,
  drop constraint if exists applicant_profiles_move_in_preference_check;

alter table public.applicant_profiles
  add constraint applicant_profiles_household_type_check
    check (household_type is null or household_type in ('SINGLE','TWO_ADULTS','FAMILY','SHARED_FLAT')),
  add constraint applicant_profiles_income_range_check
    check (income_range is null or income_range in (
      'UNDER_500','500_1000','1000_1500','1500_2000',
      '2000_3000','3000_4000','4000_5000','OVER_5000'
    )),
  add constraint applicant_profiles_move_in_preference_check
    check (move_in_preference is null or move_in_preference in (
      'NOT_SPECIFIED','FLEXIBLE','IMMEDIATE','EXACT_DATE'
    ));

update public.applicant_profiles
set household_type = case
  when household_size = 1 then 'SINGLE'
  when household_size = 2 then 'TWO_ADULTS'
  else household_type
end
where household_type is null;

update public.applicant_profiles
set income_range = case
  when monthly_net_income < 500 then 'UNDER_500'
  when monthly_net_income < 1000 then '500_1000'
  when monthly_net_income < 1500 then '1000_1500'
  when monthly_net_income < 2000 then '1500_2000'
  when monthly_net_income < 3000 then '2000_3000'
  when monthly_net_income < 4000 then '3000_4000'
  when monthly_net_income <= 5000 then '4000_5000'
  else 'OVER_5000'
end
where income_range is null
  and monthly_net_income is not null;

update public.applicant_profiles
set move_in_preference = 'EXACT_DATE'
where move_in_preference is null
  and move_in_date is not null;

update public.applicant_profiles
set pets = case
  when lower(trim(pets)) in ('keine','keine haustiere','nein','no') then 'Nein'
  when lower(trim(pets)) in ('ja','yes') then 'Ja'
  when lower(trim(pets)) in ('keine angabe','keine angaben') then 'Keine Angaben'
  else pets
end
where pets is not null;

update public.applicant_profiles
set employment_status = 'Sonstiges'
where nullif(trim(coalesce(employment_status,'')),'') is not null
  and employment_status not in (
    'Keine Angaben','Angestellte(r)','Arbeiter(in)','Selbstständige(r)','Beamte(r)',
    'Auszubildene(r)','Studierende(r)','Doktorand(in)','Hausfrau/mann',
    'Arbeitssuchende(r)','Rentner(in)','Sonstiges'
  );

comment on column public.applicant_profiles.household_type is
  'ImmoScout-aligned household choice: SINGLE, TWO_ADULTS, FAMILY, SHARED_FLAT.';
comment on column public.applicant_profiles.income_range is
  'ImmoScout-aligned net household income range.';
comment on column public.applicant_profiles.move_in_preference is
  'ImmoScout-aligned move-in choice; EXACT_DATE uses move_in_date.';

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
      'Beschäftigungsart','Netto Haushaltseinkommen','Haustiere',
      'Einzugstermin','SCHUFA-Status',
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
  if p.household_type not in ('SINGLE','TWO_ADULTS','FAMILY','SHARED_FLAT') then
    v_missing := array_append(v_missing,'Haushaltsgröße');
  end if;
  if nullif(trim(coalesce(p.employment_status,'')),'') is null then
    v_missing := array_append(v_missing,'Beschäftigungsart');
  end if;
  if p.income_range not in (
    'UNDER_500','500_1000','1000_1500','1500_2000',
    '2000_3000','3000_4000','4000_5000','OVER_5000'
  ) then
    v_missing := array_append(v_missing,'Netto Haushaltseinkommen');
  end if;
  if nullif(trim(coalesce(p.pets,'')),'') is null then
    v_missing := array_append(v_missing,'Haustiere');
  end if;
  if p.move_in_preference not in ('NOT_SPECIFIED','FLEXIBLE','IMMEDIATE','EXACT_DATE')
     or (p.move_in_preference='EXACT_DATE' and p.move_in_date is null) then
    v_missing := array_append(v_missing,'Einzugstermin');
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

drop trigger if exists applicant_profile_auto_apply_guard on public.applicant_profiles;
create trigger applicant_profile_auto_apply_guard
after insert or update of
  salutation,first_name,last_name,email,phone,street,house_number,postcode,city,
  household_type,employment_status,income_range,pets,move_in_preference,move_in_date,schufa_status,
  message_apartment,message_house,message_temporary_wg,message_swap
on public.applicant_profiles
for each row
execute function app_private.disable_auto_apply_on_incomplete_profile();

update public.bot_users u
set auto_apply_enabled=false,updated_at=now()
where u.auto_apply_enabled=true
  and not app_private.applicant_profile_complete(u.id);
