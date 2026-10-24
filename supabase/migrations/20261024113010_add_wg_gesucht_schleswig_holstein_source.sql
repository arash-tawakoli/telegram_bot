-- Add statewide WG-Gesucht coverage. City pages are discovered from the provider's
-- official Schleswig-Holstein city directory; streams walk every city and follow pagination.
ALTER TABLE app_private.source_category_streams
  DROP CONSTRAINT IF EXISTS source_category_streams_category_check;

ALTER TABLE app_private.source_category_streams
  ADD CONSTRAINT source_category_streams_category_check
  CHECK (category = ANY (ARRAY['apartment'::text,'house'::text,'room'::text,'swap'::text,'one_room'::text]));

ALTER TABLE app_private.source_category_streams
  DROP CONSTRAINT IF EXISTS source_category_streams_adapter_check;

ALTER TABLE app_private.source_category_streams
  ADD CONSTRAINT source_category_streams_adapter_check
  CHECK (adapter = ANY (ARRAY['scout'::text,'kleinanzeigen'::text,'ohne-makler'::text,'wg-gesucht'::text,'wg-gesucht-sh'::text,'immowelt'::text,'immobilien-de'::text,'immobilie1'::text]));

INSERT INTO public.sources (
  id,source_type,name,tier,homepage_url,search_url,poll_interval_minutes,
  enabled,notes,warmed_up,button_label,delivery_mode,worker_slug,
  listing_priority,crawl_priority,coverage_strategy,runtime_mode,coverage_status,
  baseline_completed_at,search_capabilities,updated_at
) VALUES (
  73,'Marketplace','WG-Gesucht Schleswig-Holstein','K1',
  'https://www.wg-gesucht.de',
  'https://www.wg-gesucht.de/staedte-in-schleswig-holstein.13.html',
  5,true,
  'Statewide rolling coverage through WG-Gesucht city/category pages. Initial delivery remains shadow until all four category crawls complete their validated city and pagination queues.',
  false,'WG-Gesucht Schleswig-Holstein','shadow','source-worker',
  24,73,'category_streams_only','live','partial',NULL,
  jsonb_build_object(
    'version',2,
    'evidence','verified_category_stream',
    'discovery','official_state_city_directory',
    'offer_modes',jsonb_build_array('rent'),
    'category_streams',jsonb_build_array('room','one_room','apartment','house'),
    'configured_kinds',jsonb_build_array('room','apartment','house'),
    'region_state_code','SH',
    'additional_kinds_require_evidence',true
  ),
  now()
)
ON CONFLICT (id) DO UPDATE SET
  source_type=EXCLUDED.source_type,
  name=EXCLUDED.name,
  tier=EXCLUDED.tier,
  homepage_url=EXCLUDED.homepage_url,
  search_url=EXCLUDED.search_url,
  poll_interval_minutes=CASE WHEN public.sources.baseline_completed_at IS NULL THEN 5 ELSE public.sources.poll_interval_minutes END,
  enabled=true,
  notes=EXCLUDED.notes,
  button_label=EXCLUDED.button_label,
  worker_slug=EXCLUDED.worker_slug,
  listing_priority=EXCLUDED.listing_priority,
  crawl_priority=EXCLUDED.crawl_priority,
  coverage_strategy=EXCLUDED.coverage_strategy,
  runtime_mode='live',
  coverage_status=CASE WHEN public.sources.baseline_completed_at IS NULL THEN 'partial' ELSE public.sources.coverage_status END,
  delivery_mode=CASE WHEN public.sources.baseline_completed_at IS NULL THEN 'shadow' ELSE public.sources.delivery_mode END,
  search_capabilities=EXCLUDED.search_capabilities,
  updated_at=now();

INSERT INTO app_private.source_category_streams AS current_streams
  (source_id,category,adapter,url,enabled,verified_at,poll_minutes)
VALUES
  (73,'room','wg-gesucht-sh','https://www.wg-gesucht.de/staedte-in-schleswig-holstein.13.html',true,now(),5),
  (73,'one_room','wg-gesucht-sh','https://www.wg-gesucht.de/staedte-in-schleswig-holstein.13.html',true,now(),5),
  (73,'apartment','wg-gesucht-sh','https://www.wg-gesucht.de/staedte-in-schleswig-holstein.13.html',true,now(),5),
  (73,'house','wg-gesucht-sh','https://www.wg-gesucht.de/staedte-in-schleswig-holstein.13.html',true,now(),5)
ON CONFLICT (source_id,category) DO UPDATE SET
  adapter=EXCLUDED.adapter,
  url=EXCLUDED.url,
  enabled=true,
  verified_at=coalesce(current_streams.verified_at,EXCLUDED.verified_at),
  poll_minutes=CASE
    WHEN current_streams.baseline_at IS NULL
      AND COALESCE((current_streams.cursor->>'complete')='true',false)=false
    THEN 5 ELSE 60 END;

CREATE OR REPLACE FUNCTION public.finish_source_category_stream(p_source_id smallint, p_category text, p_token uuid, p_success boolean, p_cursor jsonb, p_requests integer, p_candidates integer, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  n integer;
  v_category_only boolean;
  v_baseline_proven boolean;
BEGIN
  SELECT s.coverage_strategy='category_streams_only'
  INTO v_category_only
  FROM public.sources s
  WHERE s.id=p_source_id;

  v_baseline_proven :=
    COALESCE((p_cursor->>'verified_empty')='true',false)
    OR (
      COALESCE((p_cursor->>'complete')='true',false)
      AND COALESCE(NULLIF(p_cursor->>'accepted_total','')::bigint,COALESCE(p_candidates,0))>0
    );

  UPDATE app_private.source_category_streams
  SET lease_token=NULL,
      lease_until=NULL,
      baseline_at=CASE
        WHEN p_success
          AND (NOT COALESCE(v_category_only,false) OR v_baseline_proven)
        THEN COALESCE(baseline_at,now())
        ELSE baseline_at
      END,
      last_success_at=CASE WHEN p_success THEN now() ELSE last_success_at END,
      cursor=CASE WHEN p_success THEN COALESCE(p_cursor,'{}'::jsonb) ELSE cursor END,
      poll_minutes=CASE WHEN p_success AND COALESCE((p_cursor->>'complete')='true',false) THEN 60 ELSE 5 END,
      failures=CASE WHEN p_success THEN 0 ELSE failures+1 END,
      last_error=CASE WHEN p_success THEN NULL ELSE left(p_error,600) END,
      request_count=request_count+greatest(0,COALESCE(p_requests,0)),
      candidate_count=candidate_count+greatest(0,COALESCE(p_candidates,0))
  WHERE source_id=p_source_id
    AND category=p_category
    AND lease_token=p_token
    AND lease_until>now();

  GET DIAGNOSTICS n=ROW_COUNT;

  IF n=1 THEN
    UPDATE public.sources s
    SET poll_interval_minutes=CASE
      WHEN EXISTS (
        SELECT 1 FROM app_private.source_category_streams c
        WHERE c.source_id=s.id AND c.enabled AND c.verified_at IS NOT NULL
          AND (c.baseline_at IS NULL OR COALESCE((c.cursor->>'complete')='true',false)=false OR c.failures>0 OR c.last_error IS NOT NULL)
      ) THEN 5 ELSE 60 END,
      updated_at=now()
    WHERE s.id=p_source_id AND s.coverage_strategy='category_streams_only';
  END IF;

  IF n=1 AND p_success THEN
    UPDATE public.sources s
    SET delivery_mode='live',
        baseline_completed_at=COALESCE(s.baseline_completed_at,now()),
        coverage_status='partial',
        updated_at=now()
    WHERE s.id=p_source_id
      AND s.coverage_strategy='category_streams_only'
      AND s.delivery_mode='shadow'
      AND s.baseline_completed_at IS NULL
      AND EXISTS (
        SELECT 1 FROM app_private.source_category_streams c
        WHERE c.source_id=s.id AND c.enabled AND c.verified_at IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM app_private.source_category_streams c
        WHERE c.source_id=s.id
          AND c.enabled
          AND c.verified_at IS NOT NULL
          AND (
            c.baseline_at IS NULL
            OR c.last_success_at IS NULL
            OR COALESCE((c.cursor->>'complete')='true',false)=false
            OR c.failures>0
            OR c.last_error IS NOT NULL
          )
      );
  END IF;

  RETURN n=1;
END;
$function$;

DO $validation$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sources
    WHERE id=73 AND enabled AND runtime_mode='live'
      AND delivery_mode='shadow' AND baseline_completed_at IS NULL
      AND search_capabilities->>'region_state_code'='SH'
  ) THEN
    RAISE EXCEPTION 'WG-Gesucht Schleswig-Holstein source was not staged safely';
  END IF;
  IF (SELECT count(*) FROM app_private.source_category_streams
      WHERE source_id=73 AND enabled AND verified_at IS NOT NULL
        AND adapter='wg-gesucht-sh') <> 4 THEN
    RAISE EXCEPTION 'WG-Gesucht Schleswig-Holstein must have four verified category streams';
  END IF;
END;
$validation$;
