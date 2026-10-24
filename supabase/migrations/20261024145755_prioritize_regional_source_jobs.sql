-- Prevent the large, high-priority Hamburg portal crawls from starving the
-- four requested Schleswig-Holstein baselines in the limited source-job queue.
-- Once a regional baseline is complete, it naturally returns to normal crawl priority.
CREATE OR REPLACE FUNCTION app_private.enqueue_due_source_jobs(p_limit integer DEFAULT 65)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  r record;
  v_msg_id bigint;
  v_job_id uuid;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT s.id
    FROM public.sources s
    WHERE s.enabled = true
      AND s.runtime_mode = 'live'
      AND (
        s.delivery_mode = 'live'
        OR (
          s.delivery_mode = 'shadow'
          AND (
            (
              s.id = 69
              AND EXISTS (
                SELECT 1 FROM public.source_coverage_state coverage
                WHERE coverage.source_id = s.id
              )
            )
            OR (
              s.coverage_strategy = 'category_streams_only'
              AND EXISTS (
                SELECT 1 FROM app_private.source_category_streams streams
                WHERE streams.source_id = s.id
                  AND streams.enabled = true
                  AND streams.verified_at IS NOT NULL
              )
            )
          )
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.source_jobs j
        WHERE j.source_id = s.id
          AND j.status IN ('enqueued','processing','retry')
          AND j.queue_msg_id IS NOT NULL
      )
      AND (
        s.last_checked_at IS NULL
        OR s.last_checked_at <= now() - make_interval(
          mins => least(
            60,
            greatest(1, s.poll_interval_minutes) *
            CASE
              WHEN coalesce(s.consecutive_failures,0) <= 1 THEN 1
              WHEN s.consecutive_failures = 2 THEN 2
              WHEN s.consecutive_failures = 3 THEN 4
              WHEN s.consecutive_failures = 4 THEN 8
              ELSE 12
            END
          )
        )
      )
    ORDER BY
      CASE
        WHEN s.id IN (70,71,73) AND s.coverage_status <> 'complete' THEN 0
        WHEN s.id = 69 AND s.coverage_status <> 'complete' THEN 1
        ELSE 2
      END,
      coalesce(s.crawl_priority,2147483647),
      coalesce(s.last_checked_at,'-infinity'::timestamptz),
      s.id
    LIMIT greatest(1,least(coalesce(p_limit,65),65))
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    v_job_id := gen_random_uuid();

    SELECT x INTO v_msg_id
    FROM pgmq.send(
      'source_jobs',
      jsonb_build_object(
        'job_id',v_job_id,
        'source_id',r.id,
        'worker','source-worker'
      )
    ) AS x
    LIMIT 1;

    INSERT INTO public.source_jobs(
      id,queue_msg_id,source_id,status,worker,enqueued_at,updated_at
    )
    VALUES(
      v_job_id,v_msg_id,r.id,'enqueued','source-worker',now(),now()
    );

    UPDATE public.sources
    SET last_checked_at=now(),updated_at=now()
    WHERE id=r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

DO $validation$
BEGIN
  IF position('WHEN s.id IN (70,71,73)' IN (
    SELECT p.prosrc
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='app_private'
      AND p.proname='enqueue_due_source_jobs'
  )) = 0 THEN
    RAISE EXCEPTION 'Regional source queue priority was not installed';
  END IF;
END;
$validation$;
