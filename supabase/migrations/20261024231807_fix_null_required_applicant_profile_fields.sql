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
      'Einzugstermin','SCHUFA-Status','WBS-Status',
      'Bewerbungstext Wohnung','Bewerbungstext Haus',
      'Bewerbungstext Auf Zeit & WG','Bewerbungstext Tauschwohnung'
    ];
  end if;
  if p.salutation is null or p.salutation not in ('MR','MS','DIVERSE','NEUTRAL','NOT_SPECIFIED','COMPANY') then
    v_missing:=array_append(v_missing,'Anrede');
  end if;
  if nullif(trim(coalesce(p.first_name,'')),'') is null then
    v_missing:=array_append(v_missing,'Vorname');
  end if;
  if nullif(trim(coalesce(p.last_name,'')),'') is null then
    v_missing:=array_append(v_missing,'Nachname');
  end if;
  if nullif(trim(coalesce(p.email,'')),'') is null
     or lower(trim(p.email)) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    v_missing:=array_append(v_missing,'E-Mail-Adresse');
  end if;
  if nullif(trim(coalesce(p.phone,'')),'') is null
     or length(regexp_replace(p.phone,'[^0-9]','','g'))<7 then
    v_missing:=array_append(v_missing,'Telefonnummer');
  end if;
  if nullif(trim(coalesce(p.street,'')),'') is null then
    v_missing:=array_append(v_missing,'Straße');
  end if;
  if nullif(trim(coalesce(p.house_number,'')),'') is null then
    v_missing:=array_append(v_missing,'Hausnummer');
  end if;
  if coalesce(trim(p.postcode),'') !~ '^[0-9]{5}$' then
    v_missing:=array_append(v_missing,'PLZ');
  end if;
  if nullif(trim(coalesce(p.city,'')),'') is null then
    v_missing:=array_append(v_missing,'Ort');
  end if;
  if p.household_type is null or p.household_type not in ('SINGLE','TWO_ADULTS','FAMILY','SHARED_FLAT','NOT_SPECIFIED') then
    v_missing:=array_append(v_missing,'Haushaltstyp');
  end if;
  if p.employment_status is null or p.employment_status not in ('EMPLOYEE','WORKER','SELF_EMPLOYED','CIVIL_SERVANT','APPRENTICE','STUDENT','DOCTORAL','HOMEMAKER','JOBSEEKER','RETIRED','OTHER','NOT_SPECIFIED') then
    v_missing:=array_append(v_missing,'Beschäftigungsstatus');
  end if;
  if p.income_range is null or p.income_range not in ('UNDER_500','500_1000','1000_1500','1500_2000','2000_3000','3000_4000','4000_5000','OVER_5000','5000_6000','6000_7000','OVER_7000','HOUSING_BENEFIT','NOT_SPECIFIED') then
    v_missing:=array_append(v_missing,'Haushalts-Nettoeinkommen');
  end if;
  if nullif(trim(coalesce(p.pets,'')),'') is null then
    v_missing:=array_append(v_missing,'Haustiere');
  end if;
  if p.move_in_preference is null
     or p.move_in_preference not in ('NOT_SPECIFIED','FLEXIBLE','IMMEDIATE','EXACT_DATE','WITHIN_1_MONTH','WITHIN_3_MONTHS','AFTER_3_MONTHS')
     or (p.move_in_preference='EXACT_DATE' and p.move_in_date is null) then
    v_missing:=array_append(v_missing,'Einzugstermin');
  end if;
  if p.schufa_status is null or p.schufa_status not in ('NOT_SPECIFIED','AVAILABLE','NOT_AVAILABLE') then
    v_missing:=array_append(v_missing,'SCHUFA-Status');
  end if;
  if nullif(trim(coalesce(p.wbs_status,'')),'') is null then
    v_missing:=array_append(v_missing,'WBS-Status');
  end if;
  if nullif(trim(coalesce(p.message_apartment,'')),'') is null then
    v_missing:=array_append(v_missing,'Bewerbungstext Wohnung');
  end if;
  if nullif(trim(coalesce(p.message_house,'')),'') is null then
    v_missing:=array_append(v_missing,'Bewerbungstext Haus');
  end if;
  if nullif(trim(coalesce(p.message_temporary_wg,'')),'') is null then
    v_missing:=array_append(v_missing,'Bewerbungstext Auf Zeit & WG');
  end if;
  if nullif(trim(coalesce(p.message_swap,'')),'') is null then
    v_missing:=array_append(v_missing,'Bewerbungstext Tauschwohnung');
  end if;
  return v_missing;
end
$function$;