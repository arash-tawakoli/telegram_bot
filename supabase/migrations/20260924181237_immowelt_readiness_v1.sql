create or replace function public.coach_readiness_core(p_users uuid[])
returns table(
  user_id uuid,is_premium boolean,profile_complete boolean,active_search_count integer,
  connected_providers text[],enabled_providers text[],ready_providers text[],
  document_count integer,document_auto_count integer,automation_enabled boolean
)
language sql stable security definer set search_path to ''
as $function$
  with users as (
    select b.id from public.bot_users b where b.id=any(coalesce(p_users,array[]::uuid[]))
  ),
  searches as (
    select s.user_id,count(*) filter(where s.is_active)::integer as active_count
    from public.search_profiles s
    where s.user_id=any(coalesce(p_users,array[]::uuid[]))
    group by s.user_id
  ),
  connections as (
    select c.user_id,
           coalesce(array_agg(c.provider order by c.provider) filter(where c.status='connected'),array[]::text[]) as providers
    from public.platform_connections c
    where c.user_id=any(coalesce(p_users,array[]::uuid[]))
      and c.provider in ('immoscout','kleinanzeigen','immomio','immowelt')
    group by c.user_id
  ),
  documents as (
    select d.user_id,count(*)::integer as total,
           count(*) filter(where d.send_with_auto_apply)::integer as auto_total
    from public.applicant_documents d
    where d.user_id=any(coalesce(p_users,array[]::uuid[]))
    group by d.user_id
  ),
  verified as (
    select
      exists(select 1 from app_private.application_platforms where source_id=1 and verified_at is not null) as scout,
      exists(select 1 from app_private.application_platforms where source_id=2 and verified_at is not null) as klein,
      exists(select 1 from app_private.application_platforms where source_id=3 and verified_at is not null) as welt
  )
  select u.id,app_private.user_is_premium(u.id),app_private.applicant_profile_complete(u.id),
    coalesce(s.active_count,0),coalesce(c.providers,array[]::text[]),
    array_remove(array[
      case when coalesce(p.immoscout_enabled,false) then 'immoscout' end,
      case when coalesce(p.kleinanzeigen_enabled,false) then 'kleinanzeigen' end,
      case when coalesce(p.immomio_enabled,false) then 'immomio' end,
      case when coalesce(p.immowelt_enabled,false) then 'immowelt' end
    ],null),
    array_remove(array[
      case when coalesce(p.immoscout_enabled,false) and 'immoscout'=any(coalesce(c.providers,array[]::text[])) and v.scout then 'immoscout' end,
      case when coalesce(p.kleinanzeigen_enabled,false) and 'kleinanzeigen'=any(coalesce(c.providers,array[]::text[])) and v.klein then 'kleinanzeigen' end,
      case when coalesce(p.immomio_enabled,false) and 'immomio'=any(coalesce(c.providers,array[]::text[])) then 'immomio' end,
      case when coalesce(p.immowelt_enabled,false) and 'immowelt'=any(coalesce(c.providers,array[]::text[])) and v.welt then 'immowelt' end
    ],null),
    coalesce(d.total,0),coalesce(d.auto_total,0),coalesce(p.enabled,false)
  from users u cross join verified v
  left join searches s on s.user_id=u.id
  left join connections c on c.user_id=u.id
  left join documents d on d.user_id=u.id
  left join public.application_preferences p on p.user_id=u.id
$function$;
