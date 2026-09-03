-- Grand City Property stays on the canonical source-worker, but no longer
-- advertises a verified full/enumerable pagination snapshot. The dedicated
-- source-worker adapter owns Hamburg discovery, detail parsing and freshness.

update public.source_connectors
set label='Grand City Property official HTML adapter',
    connector_kind='html_discovery',
    enumerable=false,
    enabled=true,
    shadow_only=false,
    config=jsonb_build_object(
      'url','https://www.grandcityproperty.de/wohnungssuche',
      'provider','Grand City Property',
      'adapter','source-worker/gcp'
    )
where source_id=8 and priority=1;

update public.source_connectors
set enabled=false,
    shadow_only=true
where source_id=8 and priority>1;

update public.sources
set coverage_status='partial',
    last_error_at=null,
    consecutive_failures=0,
    updated_at=now()
where id=8;

insert into public.source_coverage_state(
  source_id,strategy,status,cursor,expected_count,seen_count,request_count,
  cycle_started_at,cycle_finished_at,last_complete_at,consecutive_errors,last_error,updated_at
)
values(
  8,'gcp_official_html','idle','{}'::jsonb,null,0,0,
  null,null,null,0,null,now()
)
on conflict(source_id) do update set
  strategy='gcp_official_html',
  status='idle',
  cursor='{}'::jsonb,
  expected_count=null,
  seen_count=0,
  request_count=0,
  cycle_started_at=null,
  cycle_finished_at=null,
  last_complete_at=null,
  consecutive_errors=0,
  last_error=null,
  updated_at=now();
