CREATE OR REPLACE FUNCTION public.coach_source_health_v1(p_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with params as (
  select greatest(1, least(coalesce(p_hours,24),168))::integer as hours
),
source_rollup as (
  select s.id,s.name,s.source_type,s.enabled,s.runtime_mode,s.coverage_status,s.coverage_strategy,s.delivery_mode,s.worker_slug,
    s.last_checked_at,s.last_success_at,s.last_error_at,s.consecutive_failures,
    count(cr.id) filter (where cr.started_at >= now() - make_interval(hours => (select hours from params)))::integer as crawls,
    count(cr.id) filter (where cr.started_at >= now() - make_interval(hours => (select hours from params)) and cr.success)::integer as successful_crawls,
    count(cr.id) filter (where cr.started_at >= now() - make_interval(hours => (select hours from params)) and not cr.success)::integer as failed_crawls,
    coalesce(sum(cr.inserted_count) filter (where cr.started_at >= now() - make_interval(hours => (select hours from params))),0)::integer as inserted_rows,
    coalesce(sum(cr.fetched_count) filter (where cr.started_at >= now() - make_interval(hours => (select hours from params))),0)::integer as fetched_rows
  from public.sources s left join public.crawl_runs cr on cr.source_id=s.id group by s.id
),
delivery_rollup as (
  select l.source_id,
    count(de.id) filter (where de.created_at >= now() - make_interval(hours => (select hours from params)))::integer as delivery_events,
    count(de.id) filter (where de.created_at >= now() - make_interval(hours => (select hours from params)) and de.status='sent')::integer as sent_events,
    count(de.id) filter (where de.created_at >= now() - make_interval(hours => (select hours from params)) and de.status='available')::integer as available_events,
    count(de.id) filter (where de.created_at >= now() - make_interval(hours => (select hours from params)) and de.status='skipped')::integer as skipped_events,
    count(de.id) filter (where de.created_at >= now() - make_interval(hours => (select hours from params)) and de.status='failed')::integer as failed_events,
    count(de.id) filter (where de.created_at >= now() - make_interval(hours => (select hours from params)) and de.status='pending')::integer as pending_events,
    count(de.id) filter (where de.created_at >= now() - make_interval(hours => (select hours from params)) and de.status='processing')::integer as processing_events,
    count(distinct de.listing_id) filter (where de.created_at >= now() - make_interval(hours => (select hours from params)))::integer as distinct_listings
  from public.listings l left join public.delivery_events de on de.listing_id=l.id group by l.source_id
),
connector_rollup as (
  select source_id,count(*)::integer as connectors,count(*) filter (where enabled)::integer as enabled_connectors,count(*) filter (where enabled and not shadow_only)::integer as enabled_non_shadow_connectors
  from public.source_connectors group by source_id
),
latest_errors as (
  select distinct on (cr.source_id) cr.source_id,cr.error_message
  from public.crawl_runs cr
  where cr.started_at >= now() - make_interval(hours => (select hours from params)) and not cr.success and cr.error_message is not null
  order by cr.source_id,cr.started_at desc
),
latest_successes as (
  select distinct on (cr.source_id) cr.source_id,cr.metadata->>'outcome' as outcome,cr.fetched_count,cr.inserted_count
  from public.crawl_runs cr
  where cr.started_at >= now() - make_interval(hours => (select hours from params)) and cr.success
  order by cr.source_id,cr.started_at desc
),
source_rows as (
  select jsonb_agg(jsonb_build_object(
    'id',r.id,'name',r.name,'sourceType',r.source_type,'enabled',r.enabled,'runtimeMode',r.runtime_mode,'coverageStatus',r.coverage_status,
    'coverageStrategy',r.coverage_strategy,'deliveryMode',r.delivery_mode,'workerSlug',r.worker_slug,'lastCheckedAt',r.last_checked_at,
    'lastSuccessAt',r.last_success_at,'lastSuccessOutcome',ls.outcome,'lastSuccessFetchedRows',ls.fetched_count,'lastSuccessInsertedRows',ls.inserted_count,
    'lastErrorAt',r.last_error_at,'lastError',left(e.error_message,1200),
    'consecutiveFailures',r.consecutive_failures,'crawls',r.crawls,'successfulCrawls',r.successful_crawls,'failedCrawls',r.failed_crawls,
    'crawlErrorRatePct',case when r.crawls>0 then round(100.0*r.failed_crawls/nullif(r.crawls,0),1) else null end,
    'successfulCrawlRatePct',case when r.crawls>0 then round(100.0*r.successful_crawls/nullif(r.crawls,0),1) else null end,
    'insertedRows',r.inserted_rows,'fetchedRows',r.fetched_rows,
    'deliveryEvents',coalesce(d.delivery_events,0),'sentEvents',coalesce(d.sent_events,0),
    'availableEvents',coalesce(d.available_events,0),'skippedEvents',coalesce(d.skipped_events,0),
    'failedEvents',coalesce(d.failed_events,0),'pendingEvents',coalesce(d.pending_events,0),
    'processingEvents',coalesce(d.processing_events,0),'distinctListings',coalesce(d.distinct_listings,0),
    'deliveryConfigured',r.enabled and r.runtime_mode='live' and r.delivery_mode='live' and coalesce(c.enabled_non_shadow_connectors,0)>0,
    'connectors',coalesce(c.connectors,0),'enabledConnectors',coalesce(c.enabled_connectors,0),'enabledNonShadowConnectors',coalesce(c.enabled_non_shadow_connectors,0)
  ) order by r.enabled desc,r.runtime_mode,r.name) as rows
  from source_rollup r
  left join delivery_rollup d on d.source_id=r.id
  left join connector_rollup c on c.source_id=r.id
  left join latest_errors e on e.source_id=r.id
  left join latest_successes ls on ls.source_id=r.id
),
failure_rows as (
  select jsonb_agg(jsonb_build_object('sourceId',x.source_id,'source',x.name,'failures',x.failures,'lastFailureAt',x.last_failure_at,'sampleError',x.sample_error)
    order by x.failures desc,x.last_failure_at desc) as rows
  from (
    select cr.source_id,s.name,count(*)::integer as failures,max(cr.started_at) as last_failure_at,max(cr.error_message) filter (where cr.error_message is not null) as sample_error
    from public.crawl_runs cr join public.sources s on s.id=cr.source_id
    where cr.started_at >= now() - make_interval(hours => (select hours from params)) and not cr.success
    group by cr.source_id,s.name order by failures desc,last_failure_at desc limit 25
  ) x
),
borough_rows as (select count(*)::integer as boroughs from public.hamburg_boroughs),
neighborhood_detail_rows as (
  select jsonb_agg(jsonb_build_object(
    'neighborhoodId',x.neighborhood_id,'name',x.name,'borough',x.borough,
    'activeListings',x.active_listings,'canonicalActiveListings',x.canonical_listings,
    'aliasNormalizedActiveListings',greatest(x.active_listings-x.canonical_listings,0),
    'listingStatus',case when x.canonical_listings>0 then 'canonical_hit' when x.active_listings>0 then 'alias_normalized_hit' else 'no_active_listing_evidence' end,
    'searchEvidenceStatus',case when x.coverage_records>0 then 'recorded' else 'not_recorded' end,
    'coverageEvidenceRecords',x.coverage_records,'lastCoverageEvidenceAt',x.last_coverage_at
  ) order by x.borough_sort_order,x.neighborhood_sort_order) as rows
  from (
    select n.id as neighborhood_id,n.name,b.name as borough,b.sort_order as borough_sort_order,n.sort_order as neighborhood_sort_order,
      count(l.id)::integer as active_listings,
      count(l.id) filter (where lower(trim(l.district))=lower(trim(n.name)))::integer as canonical_listings,
      count(distinct c.source_id)::integer as coverage_records,max(c.last_attempt_at) as last_coverage_at
    from public.hamburg_neighborhoods n
    join public.hamburg_boroughs b on b.id=n.borough_id
    left join public.listings l on l.is_active and l.neighborhood_id=n.id
    left join app_private.source_neighborhood_coverage c on c.neighborhood_id=n.id
    group by n.id,n.name,b.name,b.sort_order,n.sort_order
  ) x
),
source_neighborhood_coverage_rows as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceId',s.id,'source',s.name,'neighborhoodId',n.id,'neighborhood',n.name,'borough',b.name,
    'searchStatus',c.search_status,'resultCount',c.result_count,'lastAttemptAt',c.last_attempt_at,
    'lastSuccessAt',c.last_success_at,'strategy',c.strategy,'evidenceQuality',c.evidence_quality
  ) order by c.last_attempt_at desc,s.name,n.name),'[]'::jsonb) as rows
  from app_private.source_neighborhood_coverage c
  join public.sources s on s.id=c.source_id
  join public.hamburg_neighborhoods n on n.id=c.neighborhood_id
  join public.hamburg_boroughs b on b.id=n.borough_id
),
neighborhood_rows as (
  select count(*)::integer as neighborhoods,count(*) filter (where active_listings>0)::integer as with_active_listings,
    count(*) filter (where active_listings=0)::integer as without_active_listings,
    coalesce(jsonb_agg(name order by borough_sort_order,neighborhood_sort_order) filter (where active_listings=0),'[]'::jsonb) as zero_names
  from (
    select n.name,b.sort_order as borough_sort_order,n.sort_order as neighborhood_sort_order,count(l.id)::integer as active_listings
    from public.hamburg_neighborhoods n join public.hamburg_boroughs b on b.id=n.borough_id
    left join public.listings l on l.is_active and l.neighborhood_id=n.id
    group by n.id,n.name,b.sort_order,n.sort_order
  ) x
),
listing_quality as (
  select count(*) filter (where is_active and district is null)::integer as active_no_district,
    count(*) filter (where is_active and district is not null and public.normalize_hamburg_neighborhood(district) is null)::integer as active_noncanonical_district,
    count(*) filter (where is_active)::integer as active_listings,count(*) filter (where is_active and is_primary_listing)::integer as primary_active_listings
  from public.listings
),
source_job_counts as (
  select count(*)::integer as total,count(*) filter (where status='done')::integer as done,count(*) filter (where status='dead')::integer as dead,
    count(*) filter (where status='enqueued')::integer as enqueued,count(*) filter (where status='processing')::integer as processing
  from public.source_jobs
),
dead_letter_classified as (
  select j.id,j.source_id,s.name as source_name,s.enabled as source_enabled,s.runtime_mode,s.delivery_mode,
    j.attempts,j.updated_at,j.started_at,j.finished_at,
    left(coalesce(j.error_message,''),1200) as error_message,
    case
      when coalesce(j.error_message,'') ~* '(lock timeout|deadlock|canceling statement|query canceled|syntax error|permission denied)' then 'unknown'
      when coalesce(j.error_message,'') ~* '(signal timed out|timed out|timeout|http 429|http 5[0-9][0-9]|connection error|connect error|no route to host|network error|fetch failed|temporarily unavailable|rate limit|service unavailable|bad gateway|connection reset|econn)' then 'transient'
      when coalesce(j.error_message,'') ~* '(http 400|http 401|http 403|http 404|bad request|unauthorized|forbidden|not found|invalid|unsupported|schema error|parse error)' then 'permanent'
      else 'unknown'
    end as error_class
  from public.source_jobs j left join public.sources s on s.id=j.source_id
  where j.status='dead'
),
dead_letter_rows as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'sourceId',x.source_id,'source',x.source_name,'attempts',x.attempts,
    'updatedAt',x.updated_at,'startedAt',x.started_at,'finishedAt',x.finished_at,
    'error',x.error_message,'errorClass',x.error_class,
    'retryCandidate',x.error_class='transient' and x.attempts<3
      and x.updated_at<=now()-make_interval(mins=>5*power(2,greatest(x.attempts-1,0))::integer)
      and x.source_enabled and x.runtime_mode='live' and x.delivery_mode='live'
      and not exists(select 1 from public.source_jobs active_job where active_job.source_id=x.source_id and active_job.id<>x.id and active_job.status in ('enqueued','processing','retry'))
  ) order by x.updated_at desc),'[]'::jsonb) as rows
  from (select * from dead_letter_classified order by updated_at desc limit 50) x
),
crawl_counts as (
  select count(*)::integer as crawls,count(*) filter (where success)::integer as successful,count(*) filter (where not success)::integer as failed,
    coalesce(sum(inserted_count),0)::integer as inserted_rows,coalesce(sum(fetched_count),0)::integer as fetched_rows
  from public.crawl_runs where started_at >= now() - make_interval(hours => (select hours from params))
),
delivery_counts as (
  select count(*)::integer as events,count(*) filter (where status='sent')::integer as sent,count(*) filter (where status='failed')::integer as failed,
    count(*) filter (where status='skipped')::integer as skipped,count(*) filter (where status='available')::integer as available,
    count(*) filter (where status='pending')::integer as pending,count(*) filter (where status='processing')::integer as processing,
    count(distinct listing_id)::integer as distinct_listings
  from public.delivery_events where created_at >= now() - make_interval(hours => (select hours from params))
),
source_summary as (
  select count(*)::integer as registered,count(*) filter (where enabled and runtime_mode='live')::integer as enabled_live,
    count(*) filter (where enabled and runtime_mode='shadow')::integer as enabled_shadow,count(*) filter (where not enabled)::integer as disabled,
    count(*) filter (where enabled and runtime_mode='live' and coverage_status='complete')::integer as complete_live,
    count(*) filter (where enabled and runtime_mode='live' and coverage_status='partial')::integer as partial_live
  from public.sources
),
cron_summary as (
  select count(*)::integer as total,count(*) filter (where active)::integer as active,count(*) filter (where not active)::integer as inactive from cron.job
)
select jsonb_build_object(
  'generatedAt',now(),'hours',(select hours from params),
  'summary',jsonb_build_object('sources',(select to_jsonb(x) from source_summary x),'crawls',(select to_jsonb(x) from crawl_counts x),
    'delivery',(select to_jsonb(x) from delivery_counts x),'listings',(select to_jsonb(x) from listing_quality x),
    'queue',(select to_jsonb(x) from source_job_counts x),'cron',(select to_jsonb(x) from cron_summary x)),
  'sources',coalesce((select rows from source_rows),'[]'::jsonb),
  'recentFailures',coalesce((select rows from failure_rows),'[]'::jsonb),
  'deadLetterRows',coalesce((select rows from dead_letter_rows),'[]'::jsonb),
  'sourceNeighborhoodCoverage',coalesce((select rows from source_neighborhood_coverage_rows),'[]'::jsonb),
  'neighborhoodCoverage',coalesce((select rows from neighborhood_detail_rows),'[]'::jsonb),
  'geography',jsonb_build_object('boroughs',(select boroughs from borough_rows),'neighborhoods',(select neighborhoods from neighborhood_rows),
    'neighborhoodsWithActiveListings',(select with_active_listings from neighborhood_rows),'neighborhoodsWithoutActiveListings',(select without_active_listings from neighborhood_rows),
    'zeroNeighborhoods',(select zero_names from neighborhood_rows),'activeListingsWithoutDistrict',(select active_no_district from listing_quality),
    'activeListingsWithNonCanonicalDistrict',(select active_noncanonical_district from listing_quality),
    'neighborhoodsWithRecordedSearchEvidence',(select count(*) from app_private.source_neighborhood_coverage),
    'activeListings',(select active_listings from listing_quality),'primaryActiveListings',(select primary_active_listings from listing_quality))
);
$function$
;
revoke all on function public.coach_source_health_v1(integer) from public, anon, authenticated;
grant execute on function public.coach_source_health_v1(integer) to service_role;
