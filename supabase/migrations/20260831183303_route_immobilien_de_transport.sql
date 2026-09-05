update public.source_connectors
set label='immobilien.de Pagination Transport',
    connector_kind='json_endpoint',
    enumerable=false,
    enabled=true,
    shadow_only=false,
    config=jsonb_build_object(
      'url','https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/immobilien-de-transport',
      'provider','immobilien.de',
      'transport','supabase_immobilien_de_transport'
    )
where source_id=15 and priority=1;

update public.source_connectors
set enabled=false,shadow_only=true
where source_id=15 and priority in (2,3);

update public.sources
set coverage_strategy='provider_mirror',
    baseline_completed_at=null,
    coverage_status='partial',
    last_error_at=null,
    consecutive_failures=0,
    updated_at=now()
where id=15;
