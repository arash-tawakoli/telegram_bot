alter table public.applicant_profiles
  add column if not exists schufa_status text not null default 'NOT_SPECIFIED',
  add column if not exists phone_call_desired boolean not null default false;

alter table public.applicant_profiles
  drop constraint if exists applicant_profiles_schufa_status_check;

alter table public.applicant_profiles
  add constraint applicant_profiles_schufa_status_check
  check (schufa_status in ('NOT_SPECIFIED','AVAILABLE','NOT_AVAILABLE'));
