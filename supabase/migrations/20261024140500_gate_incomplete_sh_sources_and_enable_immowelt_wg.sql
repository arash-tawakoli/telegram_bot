-- Keep Kleinanzeigen in shadow until every enabled regional category is complete.
UPDATE public.sources
SET delivery_mode='shadow',
    baseline_completed_at=NULL,
    coverage_status='partial',
    poll_interval_minutes=5,
    updated_at=now()
WHERE id=70
  AND search_capabilities->>'region_state_code'='SH'
  AND EXISTS (
    SELECT 1 FROM app_private.source_category_streams c
    WHERE c.source_id=70 AND c.enabled AND c.verified_at IS NOT NULL
      AND (
        c.baseline_at IS NULL
        OR COALESCE((c.cursor->>'complete')='true',false)=false
        OR c.failures>0
        OR c.last_error IS NOT NULL
      )
  );

UPDATE app_private.source_category_streams
SET baseline_at=NULL,
    poll_minutes=5,
    last_error=NULL,
    failures=0
WHERE source_id=70
  AND enabled
  AND COALESCE((cursor->>'complete')='true',false)=false;

-- Immowelt's Schleswig-Holstein WG search page is a verified, live provider route.
UPDATE public.sources
SET search_capabilities=jsonb_set(
      jsonb_set(coalesce(search_capabilities,'{}'::jsonb),
        '{category_streams}','["apartment","house","room","swap"]'::jsonb,true),
      '{configured_kinds}','["apartment","house","room","swap"]'::jsonb,true),
    enabled=true,
    runtime_mode='live',
    delivery_mode='shadow',
    baseline_completed_at=NULL,
    coverage_status='partial',
    poll_interval_minutes=5,
    updated_at=now()
WHERE id=71
  AND search_capabilities->>'region_state_code'='SH';

UPDATE app_private.source_category_streams
SET enabled=true,
    adapter='immowelt',
    url='https://www.immowelt.de/suche/mieten/wohnung/wohngemeinschaft/schleswig-holstein/ad04de1/',
    verified_at=coalesce(verified_at,now()),
    baseline_at=NULL,
    last_started_at=NULL,
    last_success_at=NULL,
    last_error=NULL,
    failures=0,
    cursor='{}'::jsonb,
    poll_minutes=5
WHERE source_id=71 AND category='room';

DO $validation$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.sources
    WHERE id=70 AND delivery_mode='live'
      AND EXISTS (
        SELECT 1 FROM app_private.source_category_streams c
        WHERE c.source_id=70 AND c.enabled AND c.verified_at IS NOT NULL
          AND (c.baseline_at IS NULL OR COALESCE((c.cursor->>'complete')='true',false)=false OR c.failures>0 OR c.last_error IS NOT NULL)
      )
  ) THEN
    RAISE EXCEPTION 'Kleinanzeigen Schleswig-Holstein must remain shadowed while category coverage is incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sources
    WHERE id=71 AND delivery_mode='shadow' AND baseline_completed_at IS NULL
      AND search_capabilities->'category_streams' ? 'room'
  ) THEN
    RAISE EXCEPTION 'Immowelt Schleswig-Holstein WG category was not staged safely';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app_private.source_category_streams
    WHERE source_id=71 AND category='room' AND enabled
      AND url='https://www.immowelt.de/suche/mieten/wohnung/wohngemeinschaft/schleswig-holstein/ad04de1/'
  ) THEN
    RAISE EXCEPTION 'Verified Immowelt WG stream is missing';
  END IF;
END;
$validation$;
