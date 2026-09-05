update public.source_connectors
set label = 'Spacest Hamburg public API feed (Primary)',
    connector_kind = 'json_endpoint',
    enumerable = true,
    enabled = true,
    shadow_only = false,
    config = jsonb_build_object(
      'url','https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/spacest-feed',
      'role','primary',
      'adapter','source-worker/spacest-feed',
      'snapshot','complete_hamburg_public_api',
      'sort','PUBLISHED_DATE_DESC'
    )
where source_id = 13 and priority = 1;

update public.source_connectors
set enabled = false,
    shadow_only = true,
    config = coalesce(config,'{}'::jsonb) || jsonb_build_object('role','legacy_disabled')
where source_id = 13 and priority > 1;

update public.sources
set coverage_strategy = 'generic',
    coverage_status = 'partial',
    baseline_completed_at = null,
    warmed_up = false,
    consecutive_failures = 0,
    updated_at = now()
where id = 13;
