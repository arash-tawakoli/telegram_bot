update public.applicant_profiles
set salutation = case
  when salutation='Herr' then 'MR'
  when salutation='Frau' then 'MS'
  when lower(salutation)='divers' then 'DIVERSE'
  when lower(salutation)='neutral' then 'NEUTRAL'
  when salutation in ('Keine Angabe','Keine Angaben') then 'NOT_SPECIFIED'
  when salutation='Firma' then 'COMPANY'
  else salutation
end
where salutation is not null;

update public.applicant_profiles
set employment_status = case employment_status
  when 'Keine Angaben' then 'NOT_SPECIFIED'
  when 'Keine Angabe' then 'NOT_SPECIFIED'
  when 'Angestellte(r)' then 'EMPLOYEE'
  when 'Arbeiter(in)' then 'WORKER'
  when 'Selbstständige(r)' then 'SELF_EMPLOYED'
  when 'Beamte(r)' then 'CIVIL_SERVANT'
  when 'Auszubildene(r)' then 'APPRENTICE'
  when 'Auszubildende(r)' then 'APPRENTICE'
  when 'Studierende(r)' then 'STUDENT'
  when 'Doktorand(in)' then 'DOCTORAL'
  when 'Hausfrau/mann' then 'HOMEMAKER'
  when 'Hausfrau/-mann' then 'HOMEMAKER'
  when 'Arbeitssuchende(r)' then 'JOBSEEKER'
  when 'Rentner(in)' then 'RETIRED'
  when 'Sonstiges' then 'OTHER'
  else employment_status
end
where employment_status is not null;

alter table public.applicant_profiles drop constraint if exists applicant_profiles_household_type_check;
alter table public.applicant_profiles drop constraint if exists applicant_profiles_income_range_check;
alter table public.applicant_profiles drop constraint if exists applicant_profiles_move_in_preference_check;
alter table public.applicant_profiles drop constraint if exists applicant_profiles_salutation_check;
alter table public.applicant_profiles drop constraint if exists applicant_profiles_employment_status_check;

alter table public.applicant_profiles
 add constraint applicant_profiles_salutation_check
 check (salutation is null or salutation = any(array['MR','MS','DIVERSE','NEUTRAL','NOT_SPECIFIED','COMPANY']::text[])),
 add constraint applicant_profiles_household_type_check
 check (household_type is null or household_type = any(array['SINGLE','TWO_ADULTS','FAMILY','SHARED_FLAT','NOT_SPECIFIED']::text[])),
 add constraint applicant_profiles_employment_status_check
 check (employment_status is null or employment_status = any(array[
   'EMPLOYEE','WORKER','SELF_EMPLOYED','CIVIL_SERVANT','APPRENTICE','STUDENT',
   'DOCTORAL','HOMEMAKER','JOBSEEKER','RETIRED','OTHER','NOT_SPECIFIED'
 ]::text[])),
 add constraint applicant_profiles_income_range_check
 check (income_range is null or income_range = any(array[
   'UNDER_500','500_1000','1000_1500','1500_2000','2000_3000','3000_4000',
   '4000_5000','OVER_5000','5000_6000','6000_7000','OVER_7000','HOUSING_BENEFIT','NOT_SPECIFIED'
 ]::text[])),
 add constraint applicant_profiles_move_in_preference_check
 check (move_in_preference is null or move_in_preference = any(array[
   'NOT_SPECIFIED','FLEXIBLE','IMMEDIATE','EXACT_DATE','WITHIN_1_MONTH','WITHIN_3_MONTHS','AFTER_3_MONTHS'
 ]::text[]));

create or replace function app_private.applicant_profile_missing_fields(p_user uuid)
returns text[]
language plpgsql
stable security definer
set search_path=''
as $function$
declare
  p public.applicant_profiles%rowtype;
  v_missing text[] := array[]::text[];
begin
  select * into p from public.applicant_profiles where user_id=p_user;
  if not found then
    return array[
      'Anrede','Vorname','Nachname','E-Mail-Adresse','Telefonnummer',
      'Straße','Hausnummer','PLZ','Ort','Haushaltstyp',
      'Beschäftigungsstatus','Haushalts-Nettoeinkommen','Haustiere',
      'Einzugstermin','SCHUFA-Status',
      'Bewerbungstext Wohnung','Bewerbungstext Haus',
      'Bewerbungstext Auf Zeit & WG','Bewerbungstext Tauschwohnung'
    ];
  end if;
  if p.salutation not in ('MR','MS','DIVERSE','NEUTRAL','NOT_SPECIFIED','COMPANY') then v_missing:=array_append(v_missing,'Anrede'); end if;
  if nullif(trim(coalesce(p.first_name,'')),'') is null then v_missing:=array_append(v_missing,'Vorname'); end if;
  if nullif(trim(coalesce(p.last_name,'')),'') is null then v_missing:=array_append(v_missing,'Nachname'); end if;
  if nullif(trim(coalesce(p.email,'')),'') is null or position('@' in p.email)<=1 then v_missing:=array_append(v_missing,'E-Mail-Adresse'); end if;
  if nullif(trim(coalesce(p.phone,'')),'') is null or length(regexp_replace(p.phone,'[^0-9]','','g'))<7 then v_missing:=array_append(v_missing,'Telefonnummer'); end if;
  if nullif(trim(coalesce(p.street,'')),'') is null then v_missing:=array_append(v_missing,'Straße'); end if;
  if nullif(trim(coalesce(p.house_number,'')),'') is null then v_missing:=array_append(v_missing,'Hausnummer'); end if;
  if coalesce(p.postcode,'') !~ '^[0-9]{5}$' then v_missing:=array_append(v_missing,'PLZ'); end if;
  if nullif(trim(coalesce(p.city,'')),'') is null then v_missing:=array_append(v_missing,'Ort'); end if;
  if p.household_type not in ('SINGLE','TWO_ADULTS','FAMILY','SHARED_FLAT','NOT_SPECIFIED') then v_missing:=array_append(v_missing,'Haushaltstyp'); end if;
  if p.employment_status not in ('EMPLOYEE','WORKER','SELF_EMPLOYED','CIVIL_SERVANT','APPRENTICE','STUDENT','DOCTORAL','HOMEMAKER','JOBSEEKER','RETIRED','OTHER','NOT_SPECIFIED') then v_missing:=array_append(v_missing,'Beschäftigungsstatus'); end if;
  if p.income_range not in ('UNDER_500','500_1000','1000_1500','1500_2000','2000_3000','3000_4000','4000_5000','OVER_5000','5000_6000','6000_7000','OVER_7000','HOUSING_BENEFIT','NOT_SPECIFIED') then v_missing:=array_append(v_missing,'Haushalts-Nettoeinkommen'); end if;
  if nullif(trim(coalesce(p.pets,'')),'') is null then v_missing:=array_append(v_missing,'Haustiere'); end if;
  if p.move_in_preference not in ('NOT_SPECIFIED','FLEXIBLE','IMMEDIATE','EXACT_DATE','WITHIN_1_MONTH','WITHIN_3_MONTHS','AFTER_3_MONTHS')
     or (p.move_in_preference='EXACT_DATE' and p.move_in_date is null) then v_missing:=array_append(v_missing,'Einzugstermin'); end if;
  if p.schufa_status not in ('NOT_SPECIFIED','AVAILABLE','NOT_AVAILABLE') then v_missing:=array_append(v_missing,'SCHUFA-Status'); end if;
  if nullif(trim(coalesce(p.message_apartment,'')),'') is null then v_missing:=array_append(v_missing,'Bewerbungstext Wohnung'); end if;
  if nullif(trim(coalesce(p.message_house,'')),'') is null then v_missing:=array_append(v_missing,'Bewerbungstext Haus'); end if;
  if nullif(trim(coalesce(p.message_temporary_wg,'')),'') is null then v_missing:=array_append(v_missing,'Bewerbungstext Auf Zeit & WG'); end if;
  if nullif(trim(coalesce(p.message_swap,'')),'') is null then v_missing:=array_append(v_missing,'Bewerbungstext Tauschwohnung'); end if;
  return v_missing;
end
$function$;
