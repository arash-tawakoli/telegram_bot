update public.sources
set enabled=false,
    search_capabilities=coalesce(search_capabilities,'{}'::jsonb) || jsonb_build_object(
      'coverage_mode','mirror_source',
      'mirror_source_id',3,
      'mirror_source_name','Immowelt Hamburg',
      'mirror_reason','SAGA inventory is published on Immowelt; direct provider index is redundant and persistently failing',
      'direct_crawler_disabled_at','2026-09-21T18:52:00Z'
    ),
    updated_at=clock_timestamp()
where id=4;
