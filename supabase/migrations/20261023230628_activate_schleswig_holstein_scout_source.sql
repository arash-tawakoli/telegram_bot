-- Enable the dedicated Schleswig-Holstein source only after the SH-aware worker is deployed.
DO $enable$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.source_connectors c
    WHERE c.source_id=69
      AND c.enabled
      AND c.config->>'adapter'='source-worker/scout-schleswig-holstein'
  ) THEN
    RAISE EXCEPTION 'Schleswig-Holstein source-worker adapter is not configured';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.search_profiles
    WHERE location_mode IN ('all_schleswig_holstein','schleswig_holstein_areas')
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.geo_areas
    WHERE state_code='SH' AND area_type='municipality' AND is_active
  ) THEN
    RAISE EXCEPTION 'Schleswig-Holstein geography is not ready';
  END IF;
END;
$enable$;

UPDATE public.sources
SET enabled=true,
    runtime_mode='live',
    delivery_mode='live',
    coverage_status='partial',
    last_checked_at=now(),
    updated_at=now()
WHERE id=69
  AND search_capabilities->>'region_state_code'='SH'
  AND coverage_strategy='schleswig_holstein_adaptive_price_mcp';

DO $validation$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sources
    WHERE id=69 AND enabled
      AND runtime_mode='live' AND delivery_mode='live'
      AND search_capabilities->>'region_state_code'='SH'
  ) THEN
    RAISE EXCEPTION 'Schleswig-Holstein source activation validation failed';
  END IF;
END;
$validation$;
