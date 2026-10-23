-- Process the omitted Tauschwohnung category before continuing the remaining price partitions.
-- Re-running the migration is safe and keeps delivery disabled until the expanded baseline completes.
UPDATE public.sources
SET enabled=true,
    runtime_mode='live',
    delivery_mode='shadow',
    baseline_completed_at=NULL,
    coverage_status='partial',
    updated_at=now()
WHERE id=69
  AND search_capabilities->>'region_state_code'='SH';

UPDATE public.source_coverage_state
SET cursor = jsonb_set(
      coalesce(cursor,'{}'::jsonb),
      '{queue}',
      jsonb_build_array(jsonb_build_object('kind','swap','min',NULL,'max',NULL,'depth',0)) ||
      coalesce((
        SELECT jsonb_agg(q.value ORDER BY q.ordinality)
        FROM jsonb_array_elements(coalesce(source_coverage_state.cursor->'queue','[]'::jsonb))
          WITH ORDINALITY AS q(value,ordinality)
        WHERE q.value->>'kind' <> 'swap'
      ),'[]'::jsonb),
      true
    ),
    status='running',
    cycle_finished_at=NULL,
    last_error=NULL,
    updated_at=now()
WHERE source_id=69
  AND status IN ('running','complete')
  AND coalesce(cursor->'queue'->0->>'kind','') <> 'swap';

DO $validation$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.source_coverage_state
    WHERE source_id=69 AND status='running'
      AND coalesce(cursor->'queue'->0->>'kind','') <> 'swap'
  ) THEN
    RAISE EXCEPTION 'Schleswig-Holstein swap partition was not prioritized';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sources
    WHERE id=69 AND delivery_mode='shadow' AND baseline_completed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Schleswig-Holstein delivery was not kept in shadow';
  END IF;
END;
$validation$;
