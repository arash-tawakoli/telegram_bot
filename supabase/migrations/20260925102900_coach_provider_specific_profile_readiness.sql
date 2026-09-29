do $block$
declare ddl text;
begin
 select pg_get_functiondef(p.oid) into ddl
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='coach_readiness_core' and p.prokind='f'
 limit 1;
 if ddl is null then raise exception 'coach_readiness_core_missing'; end if;
 ddl:=replace(ddl,'app_private.applicant_profile_complete(u.id)','app_private.applicant_profile_identity_ready(u.id)');
 execute ddl;
end
$block$;
