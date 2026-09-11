begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

update public.bot_users
set onboarding_state = coalesce(onboarding_state, '{}'::jsonb) - 'dossier_input',
    onboarding_step = case
      when coalesce(onboarding_step, '') ilike '%dossier%'
        or coalesce(onboarding_step, '') ilike '%mappe%'
      then null else onboarding_step end,
    updated_at = now()
where onboarding_state ? 'dossier_input'
   or coalesce(onboarding_step, '') ilike '%dossier%'
   or coalesce(onboarding_step, '') ilike '%mappe%';

drop trigger if exists guard_applicant_profile on public.bot_users;
drop trigger if exists guard_applicant_document on public.application_documents;

alter table public.bot_users drop constraint if exists applicant_profile_object;
drop table if exists public.application_documents;
alter table public.bot_users drop column if exists applicant_profile;
drop function if exists app_private.guard_applicant_write();

commit;
