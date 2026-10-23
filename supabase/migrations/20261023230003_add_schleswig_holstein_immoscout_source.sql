-- Register the dedicated ImmoScout24 source for Schleswig-Holstein.
-- A following staging migration disables it until the SH-aware worker is deployed.
INSERT INTO public.sources (
  id,source_type,name,tier,homepage_url,search_url,poll_interval_minutes,
  enabled,notes,warmed_up,button_label,delivery_mode,worker_slug,
  listing_priority,crawl_priority,coverage_strategy,runtime_mode,coverage_status,search_capabilities
) VALUES (
  69,'Immobilienportal','ImmobilienScout24 Schleswig-Holstein','K1',
  'https://www.immobilienscout24.de','https://www.immobilienscout24.de',60,
  true,
  'Separate Schleswig-Holstein coverage via the verified ImmoScout24 MCP adapter. Only listings resolved to an active Schleswig-Holstein municipality or independent-city code are ingested.',
  false,'ImmoScout24.de · Schleswig-Holstein','live','source-worker',
  1,69,'adaptive_partition','live','partial',
  jsonb_build_object(
    'version',2,'evidence','verified_category_stream','discovery','public_search_or_inventory',
    'region_state_code','SH','offer_modes',jsonb_build_array('rent'),
    'configured_kinds',jsonb_build_array('apartment','house','room'),
    'additional_kinds_require_evidence',true
  )
)
ON CONFLICT (id) DO UPDATE SET
  source_type=EXCLUDED.source_type,name=EXCLUDED.name,tier=EXCLUDED.tier,
  homepage_url=EXCLUDED.homepage_url,search_url=EXCLUDED.search_url,
  poll_interval_minutes=EXCLUDED.poll_interval_minutes,enabled=true,
  notes=EXCLUDED.notes,button_label=EXCLUDED.button_label,delivery_mode='live',
  worker_slug='source-worker',listing_priority=EXCLUDED.listing_priority,
  crawl_priority=EXCLUDED.crawl_priority,coverage_strategy=EXCLUDED.coverage_strategy,
  runtime_mode='live',coverage_status='partial',search_capabilities=EXCLUDED.search_capabilities,
  updated_at=now();

INSERT INTO public.source_connectors (
  source_id,priority,label,connector_kind,config,enabled,evidence_tier,
  connector_role,enumerable,shadow_only,warmed_at
) VALUES (
  69,1,'ImmoScout24 MCP — Schleswig-Holstein','mcp',
  jsonb_build_object('url','https://app.chatgpt.immobilienscout24.de/v2/mcp','adapter','source-worker/scout-schleswig-holstein'),
  true,'K1','primary',false,false,null
)
ON CONFLICT (source_id,priority) DO UPDATE SET
  label=EXCLUDED.label,connector_kind=EXCLUDED.connector_kind,config=EXCLUDED.config,
  enabled=true,evidence_tier=EXCLUDED.evidence_tier,connector_role=EXCLUDED.connector_role,
  enumerable=EXCLUDED.enumerable,shadow_only=EXCLUDED.shadow_only,warmed_at=null,updated_at=now();
