-- Add a low-risk regional ImmoScout pilot. Delivery stays in shadow until listing geography is verified.
INSERT INTO public.sources(
  id,source_type,name,tier,homepage_url,search_url,poll_interval_minutes,enabled,notes,
  warmed_up,last_checked_at,last_success_at,last_error_at,consecutive_failures,button_label,
  delivery_mode,worker_slug,listing_priority,crawl_priority,coverage_strategy,runtime_mode,
  coverage_status,search_capabilities
)
VALUES(
  69,'Immobilienportal','ImmobilienScout24 Schleswig-Holstein','K1',
  'https://www.immobilienscout24.de',
  'https://www.immobilienscout24.de/Suche/de/schleswig-holstein/wohnung-mieten',
  60,true,
  'Regional pilot for Schleswig-Holstein. Listing writes are enabled, but delivery remains shadow until municipality mapping and search coverage are verified.',
  false,NULL,NULL,NULL,0,'ImmoScout24 Schleswig-Holstein',
  'shadow','source-worker',20,69,'adaptive_partition','live','unknown',
  '{"version":2,"evidence":"verified_category_stream","discovery":"public_search_or_inventory","offer_modes":["rent"],"category_streams":[],"configured_kinds":["apartment","house","room"],"additional_kinds_require_evidence":true,"region_state_code":"SH"}'::jsonb
)
ON CONFLICT(id) DO UPDATE SET
  source_type=EXCLUDED.source_type,
  name=EXCLUDED.name,
  tier=EXCLUDED.tier,
  homepage_url=EXCLUDED.homepage_url,
  search_url=EXCLUDED.search_url,
  poll_interval_minutes=EXCLUDED.poll_interval_minutes,
  enabled=true,
  notes=EXCLUDED.notes,
  button_label=EXCLUDED.button_label,
  delivery_mode='shadow',
  worker_slug=EXCLUDED.worker_slug,
  listing_priority=EXCLUDED.listing_priority,
  crawl_priority=EXCLUDED.crawl_priority,
  coverage_strategy=EXCLUDED.coverage_strategy,
  runtime_mode='live',
  search_capabilities=EXCLUDED.search_capabilities,
  updated_at=now();

INSERT INTO public.source_connectors(
  source_id,priority,label,connector_kind,config,enabled,evidence_tier,connector_role,enumerable,shadow_only
)
VALUES(
  69,1,
  'ImmoScout MCP Schleswig-Holstein adaptive coverage','mcp',
  '{"url":"https://app.chatgpt.immobilienscout24.de/v2/mcp","adapter":"source-worker/scout-schleswig-holstein"}'::jsonb,
  true,'K1','primary',false,false
)
ON CONFLICT(source_id,priority) DO UPDATE SET
  label=EXCLUDED.label,
  connector_kind=EXCLUDED.connector_kind,
  config=EXCLUDED.config,
  enabled=true,
  evidence_tier=EXCLUDED.evidence_tier,
  connector_role=EXCLUDED.connector_role,
  enumerable=EXCLUDED.enumerable,
  shadow_only=false,
  updated_at=now();
