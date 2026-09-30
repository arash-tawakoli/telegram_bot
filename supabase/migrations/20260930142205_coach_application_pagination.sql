-- coach-api supplies only participant UUIDs authorized for the current actor.
create or replace function public.coach_application_page_v1(
  p_user_ids uuid[], p_days integer default 30, p_status text default null,
  p_provider text default null, p_document_result text default null,
  p_page integer default 1, p_page_size integer default 50
)
returns jsonb
language sql stable security invoker set search_path to ''
as $function$
with params as (
  select greatest(1,least(coalesce(p_page,1),10000)) as page,
         greatest(10,least(coalesce(p_page_size,50),100)) as page_size
), base as materialized (
  select a.id,a.user_id,a.listing_id,a.status,a.attempts,a.last_error,a.wait_reason,
         a.created_at,a.sent_at,a.next_attempt_at
  from public.applications a
  where a.user_id=any(coalesce(p_user_ids,'{}'::uuid[]))
    and a.created_at>=now()-make_interval(days=>greatest(1,least(coalesce(p_days,30),90)))
    and (p_status is null or a.status=p_status)
), matching as materialized (
  select b.* from base b
  where (p_provider is null and p_document_result is null) or exists (
    select 1 from (
      select e.provider,e.document_result from public.application_events e
      where e.application_id=b.id order by e.created_at desc,e.id desc limit 1
    ) latest
    where (p_provider is null or latest.provider=p_provider)
      and (p_document_result is null or latest.document_result=p_document_result)
  )
), page_rows as (
  select m.* from matching m order by m.created_at desc,m.id desc
  limit (select page_size from params)
  offset (select (page-1)*page_size from params)
), payload as (
  select p.created_at,p.id,
    (to_jsonb(p)-'listing_id')||jsonb_build_object(
      'listings',case when l.id is null then null else jsonb_build_object(
        'title',l.title,'canonical_url',l.canonical_url,'district',l.district,
        'postal_code',l.postal_code,'city',l.city,
        'sources',case when s.id is null then null else jsonb_build_object('name',s.name) end
      ) end,
      'latestEvent',latest.event
    ) as row
  from page_rows p
  left join public.listings l on l.id=p.listing_id
  left join public.sources s on s.id=l.source_id
  left join lateral (
    select jsonb_build_object('provider',e.provider,'document_result',e.document_result,
      'status',e.status,'reason',e.reason,'created_at',e.created_at) as event
    from public.application_events e where e.application_id=p.id
    order by e.created_at desc,e.id desc limit 1
  ) latest on true
)
select jsonb_build_object(
  'applications',coalesce((select jsonb_agg(row order by created_at desc,id desc) from payload),'[]'::jsonb),
  'total',(select count(*) from matching),
  'page',(select page from params),'pageSize',(select page_size from params)
);
$function$;
revoke all on function public.coach_application_page_v1(uuid[],integer,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.coach_application_page_v1(uuid[],integer,text,text,text,integer,integer) to service_role;
