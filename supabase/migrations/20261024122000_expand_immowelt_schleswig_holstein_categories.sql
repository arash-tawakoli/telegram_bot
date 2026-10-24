-- Expand the dedicated Schleswig-Holstein Immowelt source to WG rooms and apartment swaps.
-- Keep the source in shadow until all four category baselines have been validated.
UPDATE public.sources
SET enabled=true,
    runtime_mode='live',
    delivery_mode='shadow',
    baseline_completed_at=NULL,
    coverage_status='partial',
    poll_interval_minutes=60,
    search_capabilities=jsonb_set(
      jsonb_set(
        coalesce(search_capabilities,'{}'::jsonb),
        '{configured_kinds}',
        '["apartment","house","room","swap"]'::jsonb,
        true
      ),
      '{offer_modes}',
      '["rent","swap"]'::jsonb,
      true
    ),
    updated_at=now()
WHERE id=71
  AND search_capabilities->>'region_state_code'='SH'

INSERT INTO app_private.source_category_streams(
  source_id,category,adapter,url,enabled,verified_at,baseline_at,
  last_started_at,last_success_at,last_error,failures,cursor,poll_minutes,
  request_count,candidate_count
)
VALUES
  (71,'room','immowelt',
   'https://www.immowelt.de/suche/mieten/wohnung/wohngemeinschaft/schleswig-holstein/ad04de1/',
   true,now(),NULL,NULL,NULL,NULL,0,'{}'::jsonb,60,0,0),
  (71,'swap','immowelt',
   'https://www.immowelt.de/suche/mieten/wohnung/tauschwohnung/schleswig-holstein/ad04de1/',
   true,now(),NULL,NULL,NULL,NULL,0,'{}'::jsonb,60,0,0)
ON CONFLICT (source_id,category) DO UPDATE
SET adapter=excluded.adapter,
    url=excluded.url,
    enabled=true,
    verified_at=coalesce(app_private.source_category_streams.verified_at,excluded.verified_at),
    baseline_at=NULL,
    last_error=NULL,
    failures=0,
    cursor='{}'::jsonb,
    poll_minutes=60

UPDATE app_private.source_category_streams
SET baseline_at=NULL,cursor='{}'::jsonb,last_error=NULL,failures=0
WHERE source_id=71 AND category IN ('apartment','house')

DO $validation$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sources
    WHERE id=71 AND delivery_mode='shadow'
      AND baseline_completed_at IS NULL
      AND search_capabilities->'configured_kinds' ? 'room'
      AND search_capabilities->'configured_kinds' ? 'swap'
  ) THEN
    RAISE EXCEPTION 'Immowelt Schleswig-Holstein source was not staged in shadow mode';
  END IF;
  IF (SELECT count(*) FROM app_private.source_category_streams
      WHERE source_id=71 AND enabled AND verified_at IS NOT NULL) <> 4 THEN
    RAISE EXCEPTION 'Immowelt Schleswig-Holstein must have four verified category streams';
  END IF;
END;
$validation$
