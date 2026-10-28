-- Recover expired category-stream leases immediately and limit each source-worker
-- invocation to one stream so regional crawls cannot exhaust worker resources.
CREATE OR REPLACE FUNCTION public.claim_source_category_streams(p_source_id smallint)
RETURNS SETOF app_private.source_category_streams
LANGUAGE sql
SET search_path TO ''
AS $function$
WITH picked AS (
  SELECT c.source_id,c.category
  FROM app_private.source_category_streams c
  JOIN public.sources s ON s.id=c.source_id
  WHERE c.source_id=p_source_id
    AND c.enabled
    AND c.verified_at IS NOT NULL
    AND s.enabled
    AND s.runtime_mode='live'
    AND (s.delivery_mode='live' OR (s.delivery_mode='shadow' AND s.coverage_strategy='category_streams_only'))
    AND (c.lease_until IS NULL OR c.lease_until<now())
    AND (
      c.lease_until<now()
      OR c.last_started_at IS NULL
      OR c.last_started_at < now()-make_interval(mins=>least(60,c.poll_minutes*(1+least(c.failures,5))))
    )
  ORDER BY
    CASE WHEN c.baseline_at IS NULL OR coalesce((c.cursor->>'complete')='true',false)=false OR c.last_error IS NOT NULL THEN 0 ELSE 1 END,
    c.last_started_at NULLS FIRST,
    c.category
  LIMIT 1
  FOR UPDATE OF c SKIP LOCKED
)
UPDATE app_private.source_category_streams c
SET lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',last_started_at=now()
FROM picked p
WHERE c.source_id=p.source_id AND c.category=p.category
RETURNING c.*;
$function$;
