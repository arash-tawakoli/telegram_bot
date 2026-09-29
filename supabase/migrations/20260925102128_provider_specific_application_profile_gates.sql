create or replace function app_private.applicant_profile_identity_ready(p_user uuid)
returns boolean
language sql
stable
set search_path=''
as $function$
  select exists(
    select 1
    from public.applicant_profiles p
    where p.user_id=p_user
      and nullif(trim(coalesce(p.first_name,'')),'') is not null
      and nullif(trim(coalesce(p.last_name,'')),'') is not null
      and nullif(trim(coalesce(p.email,'')),'') is not null
      and p.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
$function$;

do $block$
declare
  r record;
  ddl text;
  rewritten text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where p.prokind='f'
      and (n.nspname,p.proname) in (
        ('app_private','disable_auto_apply_on_incomplete_profile'),
        ('app_private','enqueue_matched_application'),
        ('app_private','guard_application_opt_in'),
        ('public','application_auto_apply_active'),
        ('public','authorize_application_send'),
        ('public','begin_application_submission'),
        ('public','cooperative_auto_apply_readiness'),
        ('public','set_application_enabled_shared'),
        ('public','validate_immomio_application_send')
      )
  loop
    ddl:=pg_get_functiondef(r.oid);
    rewritten:=replace(
      ddl,
      'app_private.applicant_profile_complete(',
      'app_private.applicant_profile_identity_ready('
    );
    if rewritten<>ddl then execute rewritten; end if;
  end loop;
end
$block$;
