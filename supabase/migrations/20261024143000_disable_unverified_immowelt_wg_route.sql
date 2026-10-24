-- Immowelt redirects the configured Schleswig-Holstein WG route to general apartments.
-- Do not classify generic apartments as WG rooms or block valid apartment/house coverage forever.
-- WG rooms remain covered by the dedicated WG-Gesucht and ImmoScout24 sources.
UPDATE app_private.source_category_streams
SET enabled=false,
    baseline_at=NULL,
    last_started_at=NULL,
    last_error='WG route redirects to general apartment results; not a verified WG category',
    poll_minutes=60
WHERE source_id=71 AND category='room';

UPDATE public.sources
SET search_capabilities=jsonb_set(
      jsonb_set(coalesce(search_capabilities,'{}'::jsonb),
        '{category_streams}','["apartment","house","swap"]'::jsonb,true),
      '{configured_kinds}','["apartment","house"]'::jsonb,true),
    delivery_mode='shadow',
    baseline_completed_at=NULL,
    coverage_status='partial',
    poll_interval_minutes=5,
    updated_at=now()
WHERE id=71
  AND search_capabilities->>'region_state_code'='SH';

DO $validation$
BEGIN
  IF EXISTS (
    SELECT 1 FROM app_private.source_category_streams
    WHERE source_id=71 AND category='room' AND enabled
  ) THEN
    RAISE EXCEPTION 'Unverified Immowelt WG route must not remain enabled';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sources
    WHERE id=71 AND delivery_mode='shadow'
      AND search_capabilities->'category_streams' ? 'apartment'
      AND NOT (search_capabilities->'category_streams' ? 'room')
  ) THEN
    RAISE EXCEPTION 'Immowelt Schleswig-Holstein source capabilities were not narrowed safely';
  END IF;
END;
$validation$;
