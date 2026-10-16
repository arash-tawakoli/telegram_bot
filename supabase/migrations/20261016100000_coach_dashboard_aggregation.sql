set local lock_timeout='3s';
set local statement_timeout='30s';

-- Aggregate coach-facing application reads in Postgres. The API only receives
-- counters and the eight recent rows needed by the dashboard.
create or replace function public.coach_application_summary_v1(p_user_ids uuid[])
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',x.user_id,
    'total',x.total,
    'sent',x.sent,
    'failed',x.failed,
    'pending',x.pending
  ) order by x.user_id),'[]'::jsonb)
  from (
    select a.user_id,
      count(*)::integer as total,
      count(*) filter (where a.status='sent')::integer as sent,
      count(*) filter (where a.status in ('failed','manual_required'))::integer as failed,
      count(*) filter (where a.status not in ('sent','failed','manual_required'))::integer as pending
    from public.applications a
    where a.user_id=any(coalesce(p_user_ids,'{}'::uuid[]))
    group by a.user_id
  ) x;
$function$;

revoke all on function public.coach_application_summary_v1(uuid[]) from public,anon,authenticated;
grant execute on function public.coach_application_summary_v1(uuid[]) to service_role;

create or replace function public.coach_dashboard_application_summary_v1(
  p_user_ids uuid[],
  p_days integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $function$
with params as (
  select now()-make_interval(days=>greatest(1,least(coalesce(p_days,30),90))) as started_at
), base as materialized (
  select a.id,a.user_id,a.status,a.wait_reason,a.created_at,a.sent_at,
    l.title,l.canonical_url,l.district,l.postal_code,l.city,s.name as source_name
  from public.applications a
  left join public.listings l on l.id=a.listing_id
  left join public.sources s on s.id=a.source_id
  where a.user_id=any(coalesce(p_user_ids,'{}'::uuid[]))
    and a.created_at >= (select started_at from params)
), latest as materialized (
  select distinct on (e.application_id)
    e.application_id,e.provider,e.document_result,e.status as event_status,e.reason,e.created_at as event_created_at
  from public.application_events e
  join base b on b.id=e.application_id
  order by e.application_id,e.created_at desc,e.id desc
), joined as (
  select b.*,l.provider,l.document_result,l.event_status,l.reason,l.event_created_at
  from base b left join latest l on l.application_id=b.id
), metrics as (
  select count(*)::integer as total,
    count(*) filter (where status='sent')::integer as sent,
    count(*) filter (where status='failed' or status='manual_required')::integer as failed,
    count(*) filter (where status='manual_required')::integer as manual_required,
    count(*) filter (where status not in ('sent','failed','manual_required'))::integer as pending
  from joined
), provider_counts as (
  select coalesce(provider,'unknown') as key,count(*)::integer as value from joined group by 1
), document_counts as (
  select coalesce(document_result,'unknown') as key,count(*)::integer as value from joined group by 1
), wait_counts as (
  select wait_reason as key,count(*)::integer as value from joined where wait_reason is not null group by 1
), recent as (
  select * from joined order by created_at desc,id desc limit 8
)
select jsonb_build_object(
  'applications',(select jsonb_build_object('total',total,'sent',sent,'failed',failed,'pending',pending,'manualRequired',manual_required) from metrics),
  'providers',coalesce((select jsonb_object_agg(key,value) from provider_counts),'{}'::jsonb),
  'documents',coalesce((select jsonb_object_agg(key,value) from document_counts),'{}'::jsonb),
  'waitReasons',coalesce((select jsonb_object_agg(key,value) from wait_counts),'{}'::jsonb),
  'recentApplications',coalesce((select jsonb_agg(jsonb_build_object(
    'id',r.id,'user_id',r.user_id,'status',r.status,'wait_reason',r.wait_reason,
    'created_at',r.created_at,'sent_at',r.sent_at,
    'listings',jsonb_build_object('title',r.title,'canonical_url',r.canonical_url,'district',r.district,'postal_code',r.postal_code,'city',r.city,'sources',jsonb_build_object('name',r.source_name)),
    'latestEvent',case when r.provider is null and r.document_result is null and r.event_status is null and r.reason is null then null else jsonb_build_object('provider',r.provider,'document_result',r.document_result,'status',r.event_status,'reason',r.reason,'created_at',r.event_created_at) end
  ) order by r.created_at desc,r.id desc) from recent),'[]'::jsonb)
);
$function$;

revoke all on function public.coach_dashboard_application_summary_v1(uuid[],integer) from public,anon,authenticated;
grant execute on function public.coach_dashboard_application_summary_v1(uuid[],integer) to service_role;
