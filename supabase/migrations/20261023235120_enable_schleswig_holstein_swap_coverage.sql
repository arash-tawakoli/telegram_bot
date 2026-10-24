-- Extend the Schleswig-Holstein ImmoScout baseline to include Tauschwohnungen.
-- Keep delivery in shadow until all categories are completely and unambiguously mapped.
UPDATE public.sources
SET search_capabilities = jsonb_set(
      jsonb_set(
        coalesce(search_capabilities, '{}'::jsonb),
        '{configured_kinds}',
        '["apartment","house","room","swap"]'::jsonb,
        true
      ),
      '{offer_modes}',
      '["rent","swap"]'::jsonb,
      true
    ),
    enabled=true,
    runtime_mode='live',
    delivery_mode='shadow',
    baseline_completed_at=NULL,
    coverage_status='partial',
    poll_interval_minutes=60,
    updated_at=now()
WHERE id=69
  AND search_capabilities->>'region_state_code'='SH';

UPDATE public.source_coverage_state
SET cursor = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            coalesce(cursor, '{}'::jsonb),
            '{queue}',
            coalesce(cursor->'queue','[]'::jsonb) ||
              jsonb_build_array(jsonb_build_object('kind','swap','min',NULL,'max',NULL,'depth',0)),
            true
          ),
          '{blocked_saturated_keys}','[]'::jsonb,true
        ),
        '{blocked_unmapped_keys}','[]'::jsonb,true
      ),
      '{unmapped_retry_counts}','{}'::jsonb,true
    ),
    status='running',
    cycle_finished_at=NULL,
    last_error=NULL,
    updated_at=now()
WHERE source_id=69
  AND status IN ('running','complete')
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(coalesce(cursor->'queue','[]'::jsonb)) AS queued(partition)
    WHERE queued.partition->>'kind'='swap'
  );

DO $validation$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sources
    WHERE id=69
      AND search_capabilities->>'region_state_code'='SH'
      AND search_capabilities->'configured_kinds' ? 'swap'
      AND search_capabilities->'offer_modes' ? 'swap'
      AND delivery_mode='shadow'
      AND baseline_completed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Schleswig-Holstein swap coverage is not staged safely';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='geo_area_postal_codes'
  ) THEN
    RAISE EXCEPTION 'Schleswig-Holstein postal-code cache table is missing';
  END IF;
END;
$validation$;
