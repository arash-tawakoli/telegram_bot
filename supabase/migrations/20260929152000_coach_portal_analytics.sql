create index if not exists applications_user_created_idx
  on public.applications(user_id, created_at desc);

create or replace function public.coach_analytics_v1(
  p_user_ids uuid[],
  p_days integer default 30,
  p_provider text default null,
  p_source_id smallint default null
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
with
params as (
  select
    greatest(1, least(coalesce(p_days,30), 365))::integer as days,
    now() as now_ts,
    now() - make_interval(days => greatest(1, least(coalesce(p_days,30),365))) as current_start,
    now() - make_interval(days => greatest(1, least(coalesce(p_days,30),365)) * 2) as previous_start
),
base_apps as (
  select
    a.id,
    a.user_id,
    a.source_id,
    a.status,
    a.attempts,
    a.wait_reason,
    a.last_error,
    a.created_at,
    a.sent_at,
    coalesce(le.provider,'unknown') as provider,
    le.document_result,
    le.reason as event_reason
  from public.applications a
  cross join params p
  left join lateral (
    select e.provider,e.document_result,e.reason
    from public.application_events e
    where e.application_id=a.id
    order by e.created_at desc
    limit 1
  ) le on true
  where a.user_id = any(coalesce(p_user_ids,'{}'::uuid[]))
    and a.created_at >= p.previous_start
    and (p_provider is null or le.provider=p_provider)
    and (p_source_id is null or a.source_id=p_source_id)
),
current_apps as (
  select b.*
  from base_apps b
  cross join params p
  where b.created_at >= p.current_start
),
previous_apps as (
  select b.*
  from base_apps b
  cross join params p
  where b.created_at >= p.previous_start
    and b.created_at < p.current_start
),
summary as (
  select
    count(*)::integer as total,
    count(*) filter (where status='sent')::integer as sent,
    count(*) filter (where status='failed')::integer as failed,
    count(*) filter (where status='manual_required')::integer as manual_required,
    count(*) filter (where status='pending')::integer as pending,
    count(*) filter (where status='processing')::integer as processing,
    coalesce(avg(attempts),0)::numeric as avg_attempts
  from current_apps
),
previous_summary as (
  select
    count(*)::integer as total,
    count(*) filter (where status='sent')::integer as sent,
    count(*) filter (where status='failed')::integer as failed,
    count(*) filter (where status='manual_required')::integer as manual_required,
    count(*) filter (where status='pending')::integer as pending,
    count(*) filter (where status='processing')::integer as processing
  from previous_apps
),
day_series as (
  select generate_series(
    (select (current_start at time zone 'Europe/Berlin')::date from params),
    (select (now_ts at time zone 'Europe/Berlin')::date from params),
    interval '1 day'
  )::date as day
),
timeline_rows as (
  select
    d.day,
    count(c.id)::integer as total,
    count(c.id) filter (where c.status='sent')::integer as sent,
    count(c.id) filter (where c.status='failed')::integer as failed,
    count(c.id) filter (where c.status='manual_required')::integer as manual_required,
    count(c.id) filter (where c.status in ('pending','processing'))::integer as pending
  from day_series d
  left join current_apps c
    on (c.created_at at time zone 'Europe/Berlin')::date=d.day
  group by d.day
  order by d.day
),
provider_rows as (
  select
    provider,
    count(*)::integer as total,
    count(*) filter (where status='sent')::integer as sent,
    count(*) filter (where status='failed')::integer as failed,
    count(*) filter (where status='manual_required')::integer as manual_required,
    count(*) filter (where status in ('pending','processing'))::integer as pending,
    coalesce(round(avg(attempts)::numeric,2),0)::numeric as avg_attempts
  from current_apps
  group by provider
  order by count(*) desc,provider
),
source_rows as (
  select
    c.source_id,
    coalesce(s.name,'Unbekannt') as source_name,
    count(*)::integer as total,
    count(*) filter (where c.status='sent')::integer as sent,
    count(*) filter (where c.status='failed')::integer as failed,
    count(*) filter (where c.status='manual_required')::integer as manual_required
  from current_apps c
  left join public.sources s on s.id=c.source_id
  group by c.source_id,s.name
  order by count(*) desc,coalesce(s.name,'Unbekannt')
  limit 20
),
document_rows as (
  select
    coalesce(nullif(document_result,''),'unknown') as document_result,
    count(*)::integer as total
  from current_apps
  group by 1
  order by count(*) desc,1
),
error_base as (
  select
    case
      when lower(coalesce(wait_reason,event_reason,last_error,'')) ~ '(captcha|challenge|turnstile|cloudflare)' then 'captcha_challenge'
      when lower(coalesce(wait_reason,event_reason,last_error,'')) ~ '(expired|reconnect|erneut.*verbind|session.*abgel)' then 'connection_expired'
      when lower(coalesce(wait_reason,event_reason,last_error,'')) ~ '(login|auth|credential|anmeld)' then 'auth_required'
      when lower(coalesce(wait_reason,event_reason,last_error,'')) ~ '(document|upload|attachment|unterlag)' then 'document_error'
      when lower(coalesce(wait_reason,event_reason,last_error,'')) ~ '(profile|missing.*field|pflicht|basisang)' then 'profile_missing'
      when lower(coalesce(wait_reason,event_reason,last_error,'')) ~ '(429|rate.?limit|throttl)' then 'rate_limit'
      when lower(coalesce(wait_reason,event_reason,last_error,'')) ~ '(queue|wait|retry|wart|pending)' then 'queue_wait'
      when coalesce(wait_reason,event_reason,last_error,'')<>'' then 'provider_error'
      else 'unknown'
    end as category
  from current_apps
  where status in ('failed','manual_required')
     or wait_reason is not null
     or last_error is not null
),
error_rows as (
  select category,count(*)::integer as total
  from error_base
  group by category
  order by count(*) desc,category
),
participant_rows as (
  select
    u.id as user_id,
    coalesce(nullif(btrim(u.first_name||' '||coalesce(u.last_name,'')),''),'Teilnehmer') as participant_name,
    count(c.id)::integer as applications,
    count(c.id) filter (where c.status='sent')::integer as sent,
    count(c.id) filter (where c.status='failed')::integer as failed,
    count(c.id) filter (where c.status='manual_required')::integer as manual_required,
    count(c.id) filter (where c.status in ('pending','processing'))::integer as pending,
    max(coalesce(c.sent_at,c.created_at)) as last_application_at
  from public.bot_users u
  left join current_apps c on c.user_id=u.id
  where u.id = any(coalesce(p_user_ids,'{}'::uuid[]))
  group by u.id,u.first_name,u.last_name
  order by count(c.id) desc,participant_name
),
search_base as (
  select sp.*
  from public.search_profiles sp
  where sp.user_id = any(coalesce(p_user_ids,'{}'::uuid[]))
    and sp.is_active=true
),
search_summary as (
  select
    count(*)::integer as active_profiles,
    round(avg(max_warm_rent)::numeric,2) as avg_max_warm_rent,
    percentile_cont(0.5) within group (order by max_warm_rent) filter (where max_warm_rent is not null) as median_max_warm_rent,
    round(avg(min_rooms)::numeric,2) as avg_min_rooms,
    round(avg(min_area_sqm)::numeric,2) as avg_min_area_sqm
  from search_base
),
search_property_rows as (
  select t.value as label,count(*)::integer as total
  from search_base s
  cross join lateral unnest(coalesce(s.property_types,'{}'::text[])) as t(value)
  group by t.value
  order by count(*) desc,t.value
  limit 12
),
search_borough_rows as (
  select t.value as label,count(*)::integer as total
  from search_base s
  cross join lateral unnest(coalesce(s.boroughs,'{}'::text[])) as t(value)
  group by t.value
  order by count(*) desc,t.value
  limit 12
),
search_neighborhood_rows as (
  select t.value as label,count(*)::integer as total
  from search_base s
  cross join lateral unnest(coalesce(s.neighborhoods,'{}'::text[])) as t(value)
  group by t.value
  order by count(*) desc,t.value
  limit 15
)
select jsonb_build_object(
  'summary',(
    select jsonb_build_object(
      'applications',s.total,
      'sent',s.sent,
      'failed',s.failed,
      'manualRequired',s.manual_required,
      'pending',s.pending+s.processing,
      'successRate',case when (s.sent+s.failed+s.manual_required)>0 then round((100.0*s.sent/(s.sent+s.failed+s.manual_required))::numeric,1) else 0 end,
      'avgAttempts',round(s.avg_attempts,2),
      'activeSearchProfiles',(select active_profiles from search_summary),
      'participants',coalesce(cardinality(p_user_ids),0)
    ) from summary s
  ),
  'previous',(
    select jsonb_build_object(
      'applications',s.total,
      'sent',s.sent,
      'failed',s.failed,
      'manualRequired',s.manual_required,
      'pending',s.pending+s.processing,
      'successRate',case when (s.sent+s.failed+s.manual_required)>0 then round((100.0*s.sent/(s.sent+s.failed+s.manual_required))::numeric,1) else 0 end
    ) from previous_summary s
  ),
  'timeline',coalesce((
    select jsonb_agg(jsonb_build_object(
      'date',to_char(day,'YYYY-MM-DD'),
      'total',total,
      'sent',sent,
      'failed',failed,
      'manualRequired',manual_required,
      'pending',pending
    ) order by day)
    from timeline_rows
  ),'[]'::jsonb),
  'providers',coalesce((
    select jsonb_agg(jsonb_build_object(
      'provider',provider,
      'total',total,
      'sent',sent,
      'failed',failed,
      'manualRequired',manual_required,
      'pending',pending,
      'successRate',case when (sent+failed+manual_required)>0 then round((100.0*sent/(sent+failed+manual_required))::numeric,1) else 0 end,
      'avgAttempts',avg_attempts
    ) order by total desc,provider)
    from provider_rows
  ),'[]'::jsonb),
  'sources',coalesce((
    select jsonb_agg(jsonb_build_object(
      'sourceId',source_id,
      'name',source_name,
      'total',total,
      'sent',sent,
      'failed',failed,
      'manualRequired',manual_required
    ) order by total desc,source_name)
    from source_rows
  ),'[]'::jsonb),
  'documents',coalesce((
    select jsonb_agg(jsonb_build_object('result',document_result,'total',total) order by total desc,document_result)
    from document_rows
  ),'[]'::jsonb),
  'errors',coalesce((
    select jsonb_agg(jsonb_build_object('category',category,'total',total) order by total desc,category)
    from error_rows
  ),'[]'::jsonb),
  'participants',coalesce((
    select jsonb_agg(jsonb_build_object(
      'userId',user_id,
      'name',participant_name,
      'applications',applications,
      'sent',sent,
      'failed',failed,
      'manualRequired',manual_required,
      'pending',pending,
      'successRate',case when (sent+failed+manual_required)>0 then round((100.0*sent/(sent+failed+manual_required))::numeric,1) else 0 end,
      'lastApplicationAt',last_application_at
    ) order by applications desc,participant_name)
    from participant_rows
  ),'[]'::jsonb),
  'searchDemand',jsonb_build_object(
    'summary',(select jsonb_build_object(
      'activeProfiles',active_profiles,
      'avgMaxWarmRent',avg_max_warm_rent,
      'medianMaxWarmRent',median_max_warm_rent,
      'avgMinRooms',avg_min_rooms,
      'avgMinAreaSqm',avg_min_area_sqm
    ) from search_summary),
    'propertyTypes',coalesce((select jsonb_agg(jsonb_build_object('label',label,'total',total) order by total desc,label) from search_property_rows),'[]'::jsonb),
    'boroughs',coalesce((select jsonb_agg(jsonb_build_object('label',label,'total',total) order by total desc,label) from search_borough_rows),'[]'::jsonb),
    'neighborhoods',coalesce((select jsonb_agg(jsonb_build_object('label',label,'total',total) order by total desc,label) from search_neighborhood_rows),'[]'::jsonb)
  )
)
$function$;

revoke all on function public.coach_analytics_v1(uuid[],integer,text,smallint)
  from public,anon,authenticated;
grant execute on function public.coach_analytics_v1(uuid[],integer,text,smallint)
  to service_role;

create or replace function public.coach_market_analytics_v1(
  p_days integer default 30,
  p_source_id smallint default null,
  p_property_kind text default null
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
with
params as (
  select
    greatest(1, least(coalesce(p_days,30),365))::integer as days,
    now() as now_ts,
    now() - make_interval(days => greatest(1, least(coalesce(p_days,30),365))) as current_start,
    now() - make_interval(days => greatest(1, least(coalesce(p_days,30),365))*2) as previous_start
),
normalized as (
  select
    l.id,
    l.source_id,
    l.first_seen_at,
    l.is_active,
    l.warm_rent,
    l.area_sqm,
    l.district,
    case
      when lower(coalesce(l.property_kind,l.property_type,'')) in ('wohnung','apartment') then 'Wohnung'
      when lower(coalesce(l.property_kind,l.property_type,'')) in ('haus','house') then 'Haus'
      when lower(coalesce(l.property_kind,l.property_type,'')) in ('wg','room') then 'WG'
      when lower(coalesce(l.property_kind,l.property_type,''))='tauschwohnung' then 'Tauschwohnung'
      else 'Sonstiges'
    end as property_kind
  from public.listings l
  cross join params p
  where l.first_seen_at >= p.previous_start
    and coalesce(l.is_primary_listing,true)=true
    and coalesce(l.quality_status,'')<>'rejected'
    and (p_source_id is null or l.source_id=p_source_id)
),
filtered as (
  select n.*
  from normalized n
  where p_property_kind is null or n.property_kind=p_property_kind
),
current_rows as (
  select f.*
  from filtered f
  cross join params p
  where f.first_seen_at>=p.current_start
),
previous_rows as (
  select f.*
  from filtered f
  cross join params p
  where f.first_seen_at>=p.previous_start
    and f.first_seen_at<p.current_start
),
summary as (
  select
    count(*)::integer as new_listings,
    count(*) filter (where is_active)::integer as active_listings,
    percentile_cont(0.5) within group (order by warm_rent) filter (where warm_rent>0) as median_warm_rent,
    percentile_cont(0.5) within group (order by area_sqm) filter (where area_sqm>0) as median_area_sqm,
    percentile_cont(0.5) within group (order by warm_rent/area_sqm) filter (where warm_rent>0 and area_sqm>0) as median_rent_sqm,
    count(distinct source_id)::integer as sources
  from current_rows
),
previous_summary as (
  select
    count(*)::integer as new_listings,
    count(*) filter (where is_active)::integer as active_listings,
    percentile_cont(0.5) within group (order by warm_rent) filter (where warm_rent>0) as median_warm_rent,
    percentile_cont(0.5) within group (order by area_sqm) filter (where area_sqm>0) as median_area_sqm,
    percentile_cont(0.5) within group (order by warm_rent/area_sqm) filter (where warm_rent>0 and area_sqm>0) as median_rent_sqm
  from previous_rows
),
day_series as (
  select generate_series(
    (select (current_start at time zone 'Europe/Berlin')::date from params),
    (select (now_ts at time zone 'Europe/Berlin')::date from params),
    interval '1 day'
  )::date as day
),
timeline_rows as (
  select d.day,count(c.id)::integer as total
  from day_series d
  left join current_rows c on (c.first_seen_at at time zone 'Europe/Berlin')::date=d.day
  group by d.day
  order by d.day
),
source_rows as (
  select
    c.source_id,
    coalesce(s.name,'Unbekannt') as source_name,
    count(*)::integer as total,
    count(*) filter (where c.is_active)::integer as active
  from current_rows c
  left join public.sources s on s.id=c.source_id
  group by c.source_id,s.name
  order by count(*) desc,source_name
  limit 20
),
district_rows as (
  select coalesce(nullif(btrim(district),''),'Unbekannt') as label,count(*)::integer as total
  from current_rows
  group by 1
  order by count(*) desc,1
  limit 15
),
kind_rows as (
  select property_kind as label,count(*)::integer as total
  from current_rows
  group by property_kind
  order by count(*) desc,property_kind
),
rent_rows as (
  select bucket,count(*)::integer as total
  from (
    select case
      when warm_rent is null or warm_rent<=0 then 'Unbekannt'
      when warm_rent<800 then '< 800 €'
      when warm_rent<1000 then '800–999 €'
      when warm_rent<1250 then '1.000–1.249 €'
      when warm_rent<1500 then '1.250–1.499 €'
      else '≥ 1.500 €'
    end as bucket
    from current_rows
  ) x
  group by bucket
),
source_options as (
  select s.id,s.name
  from public.sources s
  where s.enabled=true
  order by s.name
)
select jsonb_build_object(
  'summary',(select jsonb_build_object(
    'newListings',new_listings,
    'activeListings',active_listings,
    'medianWarmRent',round(coalesce(median_warm_rent,0)::numeric,0),
    'medianAreaSqm',round(coalesce(median_area_sqm,0)::numeric,1),
    'medianRentSqm',round(coalesce(median_rent_sqm,0)::numeric,2),
    'sources',sources
  ) from summary),
  'previous',(select jsonb_build_object(
    'newListings',new_listings,
    'activeListings',active_listings,
    'medianWarmRent',round(coalesce(median_warm_rent,0)::numeric,0),
    'medianAreaSqm',round(coalesce(median_area_sqm,0)::numeric,1),
    'medianRentSqm',round(coalesce(median_rent_sqm,0)::numeric,2)
  ) from previous_summary),
  'timeline',coalesce((
    select jsonb_agg(jsonb_build_object('date',to_char(day,'YYYY-MM-DD'),'total',total) order by day)
    from timeline_rows
  ),'[]'::jsonb),
  'sources',coalesce((
    select jsonb_agg(jsonb_build_object('sourceId',source_id,'name',source_name,'total',total,'active',active) order by total desc,source_name)
    from source_rows
  ),'[]'::jsonb),
  'districts',coalesce((
    select jsonb_agg(jsonb_build_object('label',label,'total',total) order by total desc,label)
    from district_rows
  ),'[]'::jsonb),
  'propertyKinds',coalesce((
    select jsonb_agg(jsonb_build_object('label',label,'total',total) order by total desc,label)
    from kind_rows
  ),'[]'::jsonb),
  'rentBuckets',coalesce((
    select jsonb_agg(jsonb_build_object('label',bucket,'total',total) order by
      case bucket when '< 800 €' then 1 when '800–999 €' then 2 when '1.000–1.249 €' then 3 when '1.250–1.499 €' then 4 when '≥ 1.500 €' then 5 else 6 end)
    from rent_rows
  ),'[]'::jsonb),
  'sourceOptions',coalesce((
    select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name)
    from source_options
  ),'[]'::jsonb)
)
$function$;

revoke all on function public.coach_market_analytics_v1(integer,smallint,text)
  from public,anon,authenticated;
grant execute on function public.coach_market_analytics_v1(integer,smallint,text)
  to service_role;
