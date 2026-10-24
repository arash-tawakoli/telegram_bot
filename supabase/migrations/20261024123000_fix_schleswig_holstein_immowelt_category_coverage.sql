-- Do not treat Immowelt's generic WG landing page as a verified room inventory.
-- Keep the source shadow-gated while the apartment, house, and swap crawls finish their full pagination.
UPDATE app_private.source_category_streams
SET enabled = false,
    last_error = NULL,
    failures = 0,
    lease_token = NULL,
    lease_until = NULL
WHERE source_id = 71
  AND category = 'room';

UPDATE public.sources
SET search_capabilities = jsonb_set(
      jsonb_set(
        search_capabilities,
        '{category_streams}',
        '["apartment","house","swap"]'::jsonb,
        true
      ),
      '{configured_kinds}',
      '["apartment","house","swap"]'::jsonb,
      true
    ),
    poll_interval_minutes = 5,
    delivery_mode = CASE WHEN baseline_completed_at IS NULL THEN 'shadow' ELSE delivery_mode END,
    coverage_status = CASE WHEN baseline_completed_at IS NULL THEN 'partial' ELSE coverage_status END,
    updated_at = now()
WHERE id = 71;

DO $validation$
BEGIN
  IF EXISTS (
    SELECT 1 FROM app_private.source_category_streams
    WHERE source_id = 71 AND category = 'room' AND enabled
  ) THEN
    RAISE EXCEPTION 'Unvalidated Immowelt room stream must remain disabled';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sources
    WHERE id = 71
      AND search_capabilities->'category_streams' @> '["apartment","house","swap"]'::jsonb
  ) THEN
    RAISE EXCEPTION 'Immowelt Schleswig-Holstein categories were not updated';
  END IF;
END;
$validation$;
