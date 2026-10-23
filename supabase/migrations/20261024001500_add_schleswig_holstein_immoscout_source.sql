-- Preserve the SH source in shadow delivery mode while its baseline coverage cycle is running.
-- The hourly scheduler includes this one source while source_coverage_state exists.
UPDATE public.sources
SET enabled=true,
    runtime_mode='live',
    delivery_mode='shadow',
    poll_interval_minutes=60,
    baseline_completed_at=NULL,
    notes='Separate Schleswig-Holstein coverage via the verified ImmoScout24 MCP adapter. Only listings resolved to an active Schleswig-Holstein municipality or independent-city code are ingested.',
    updated_at=now()
WHERE id=69
  AND search_capabilities->>'region_state_code'='SH';
DO $validation$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sources
    WHERE id=69 AND enabled=true AND runtime_mode='live'
      AND delivery_mode='shadow' AND poll_interval_minutes=60
      AND baseline_completed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Schleswig-Holstein shadow coverage state validation failed';
  END IF;
END;
$validation$;
