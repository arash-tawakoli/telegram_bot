-- A regional category stream is not baseline-complete merely because its HTTP request succeeded.
-- Require accepted listings plus a complete bounded crawl, or an explicitly verified empty result.
CREATE OR REPLACE FUNCTION public.finish_source_category_stream(
  p_source_id smallint,
  p_category text,
  p_token uuid,
  p_success boolean,
  p_cursor jsonb,
  p_requests integer,
  p_candidates integer,
  p_error text DEFAULT NULL::text
)
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
      AND COALESCE(p_candidates,0)>0
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
      failures=CASE WHEN p_success THEN 0 ELSE failures+1 END,
      last_error=CASE WHEN p_success THEN NULL ELSE left(p_error,600) END,
      request_count=request_count+greatest(0,COALESCE(p_requests,0)),
      candidate_count=candidate_count+greatest(0,COALESCE(p_candidates,0))
  WHERE source_id=p_source_id
    AND category=p_category
    AND lease_token=p_token
    AND lease_until>now();

  GET DIAGNOSTICS n=ROW_COUNT;

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
            OR c.failures>0
            OR c.last_error IS NOT NULL
          )
      );
  END IF;

  RETURN n=1;
END;
$function$;

-- Revoke the prior false-positive baselines. Their latest observations had parsed cards
-- but persisted zero listings, and the Immowelt house crawl was explicitly truncated.
UPDATE public.sources
SET delivery_mode='shadow',
    baseline_completed_at=NULL,
    coverage_status='partial',
    last_checked_at=NULL,
    updated_at=now()
WHERE id IN (71,72)
  AND coverage_strategy='category_streams_only'
  AND search_capabilities->>'region_state_code'='SH';

UPDATE app_private.source_category_streams
SET baseline_at=NULL,
    last_started_at=NULL,
    last_success_at=NULL,
    failures=0,
    last_error='Baseline invalidated: previous run accepted zero listings or was truncated',
    lease_token=NULL,
    lease_until=NULL
WHERE source_id IN (71,72)
  AND enabled
  AND verified_at IS NOT NULL;

DO $validation$
BEGIN
  IF (SELECT count(*) FROM public.sources
      WHERE id IN (71,72)
        AND delivery_mode='shadow'
        AND baseline_completed_at IS NULL
        AND coverage_strategy='category_streams_only'
        AND search_capabilities->>'region_state_code'='SH') <> 2 THEN
    RAISE EXCEPTION 'Invalid regional category baselines were not revoked';
  END IF;

  IF EXISTS (
    SELECT 1 FROM app_private.source_category_streams
    WHERE source_id IN (71,72)
      AND enabled AND verified_at IS NOT NULL
      AND baseline_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Invalid regional category stream baseline remained active';
  END IF;
END;
$validation$;
