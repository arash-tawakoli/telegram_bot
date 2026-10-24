-- Only report complete after every enabled, verified category stream has a validated baseline.
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
          AND (
            c.baseline_at IS NULL
            OR COALESCE((c.cursor->>'complete')='true',false)=false
            OR c.failures>0
            OR c.last_error IS NOT NULL
          )
      ) THEN 5 ELSE 60 END,
      updated_at=now()
    WHERE s.id=p_source_id
      AND s.coverage_strategy='category_streams_only';
  END IF;

  IF n=1 AND p_success THEN
    UPDATE public.sources s
    SET delivery_mode='live',
        baseline_completed_at=COALESCE(s.baseline_completed_at,now()),
        coverage_status='complete',
        poll_interval_minutes=60,
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

  -- Repair the status of sources whose validated baseline was already promoted.
  UPDATE public.sources s
  SET coverage_status='complete',
      poll_interval_minutes=60,
      updated_at=now()
  WHERE s.id=p_source_id
    AND s.coverage_strategy='category_streams_only'
    AND s.baseline_completed_at IS NOT NULL
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

  RETURN n=1;
END;
$function$;
