update public.source_connectors
set label = 'meravis official Hamburg card feed (Primary)',
    connector_kind = 'json_endpoint',
    enumerable = true,
    enabled = true,
    shadow_only = false,
    config = jsonb_build_object(
      'url','https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/meravis-feed',
      'role','primary',
      'adapter','source-worker/meravis-feed',
      'snapshot','complete_hamburg_apartment_cards'
    )
where source_id = 48 and priority = 1;

update public.source_connectors
set label = 'Legacy meravis HTML parser (disabled: cross-card contamination)',
    enabled = false,
    shadow_only = true,
    config = coalesce(config,'{}'::jsonb) || jsonb_build_object(
      'role','legacy_disabled',
      'reason','cross_card_contamination'
    )
where source_id = 48 and priority = 2;

update public.source_connectors
set shadow_only = true
where source_id = 48 and priority > 2;

update public.sources
set coverage_strategy = 'generic',
    coverage_status = 'partial',
    baseline_completed_at = null,
    warmed_up = false,
    consecutive_failures = 0,
    updated_at = now()
where id = 48;
