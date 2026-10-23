-- Keep Schleswig-Holstein delivery in shadow until the initial coverage baseline completes.
-- This migration must also run on a clean preview branch where no runtime coverage row exists yet.
DO $precheck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sources
    WHERE id=69
      AND search_capabilities->>'region_state_code'='SH'
  ) THEN
    RAISE EXCEPTION 'Dedicated Schleswig-Holstein source 69 is missing or misconfigured';
  END IF;
  IF position('s.id = 69' in pg_get_functiondef('app_private.enqueue_due_source_jobs(integer)'::regprocedure))=0 THEN
    RAISE EXCEPTION 'Hourly shadow-mode enqueue support for source 69 is not installed';
  END IF;
END;
$precheck$;

UPDATE public.sources
SET enabled=true,
    runtime_mode='live',
    delivery_mode='shadow',
    poll_interval_minutes=60,
    baseline_completed_at=NULL,
    coverage_status='partial',
    updated_at=now()
WHERE id=69
  AND search_capabilities->>'region_state_code'='SH';

DO $validation$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sources
    WHERE id=69 AND enabled
      AND runtime_mode='live' AND delivery_mode='shadow'
      AND baseline_completed_at IS NULL
      AND poll_interval_minutes=60
  ) THEN
    RAISE EXCEPTION 'Schleswig-Holstein shadow baseline guard was not restored';
  END IF;
END;
$validation$;
