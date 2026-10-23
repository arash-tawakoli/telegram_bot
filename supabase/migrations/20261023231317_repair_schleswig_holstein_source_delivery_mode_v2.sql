DO $precheck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sources s
    JOIN public.source_connectors c ON c.source_id=s.id
    WHERE s.id=69
      AND s.search_capabilities->>'region_state_code'='SH'
      AND c.enabled
      AND c.config->>'adapter'='source-worker/scout-schleswig-holstein'
  ) THEN
    RAISE EXCEPTION 'Dedicated Schleswig-Holstein source 69 is missing or misconfigured';
  END IF;
END;
$precheck$;

UPDATE public.sources
SET enabled=true,
    runtime_mode='live',
    delivery_mode='live',
    coverage_status='partial',
    poll_interval_minutes=60,
    updated_at=now()
WHERE id=69
  AND search_capabilities->>'region_state_code'='SH';

DO $validation$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sources
    WHERE id=69 AND enabled
      AND runtime_mode='live' AND delivery_mode='live'
      AND search_capabilities->>'region_state_code'='SH'
  ) THEN
    RAISE EXCEPTION 'Schleswig-Holstein source is not live after repair';
  END IF;
END;
$validation$;
