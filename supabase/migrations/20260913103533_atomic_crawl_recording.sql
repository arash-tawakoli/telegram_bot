-- One transaction and one Data API request for source state plus its crawl record.
CREATE FUNCTION public.record_crawl_result(
  p_source_id smallint, p_started_at timestamptz, p_finished_at timestamptz,
  p_success boolean, p_connector_priority smallint, p_connector_label text,
  p_fetched_count integer, p_inserted_count integer, p_metadata jsonb, p_error text
) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF p_success IS NULL OR p_started_at IS NULL OR p_finished_at IS NULL
    OR p_fetched_count IS NULL OR p_fetched_count < 0
    OR p_inserted_count IS NULL OR p_inserted_count < 0
    OR p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION 'invalid crawl result' USING ERRCODE = '22023';
  END IF;
  IF p_success THEN
    UPDATE public.sources SET
      last_success_at = p_finished_at, last_error_at = NULL, consecutive_failures = 0,
      baseline_completed_at = coalesce(baseline_completed_at,
        CASE WHEN p_metadata->'complete' IS DISTINCT FROM 'false'::jsonb THEN p_finished_at END),
      coverage_status = CASE WHEN p_source_id = 1 OR p_metadata->'complete' = 'false'::jsonb
        THEN 'partial' ELSE 'complete' END,
      updated_at = p_finished_at
    WHERE id = p_source_id;
  ELSE
    UPDATE public.sources SET last_error_at = p_finished_at,
      consecutive_failures = coalesce(consecutive_failures,0) + 1, updated_at = p_finished_at
    WHERE id = p_source_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'source unavailable' USING ERRCODE = '23503'; END IF;
  INSERT INTO public.crawl_runs(source_id, started_at, finished_at, success,
    connector_priority, connector_label, fetched_count, inserted_count, metadata, error_message)
  VALUES(p_source_id, p_started_at, p_finished_at, p_success, p_connector_priority,
    p_connector_label, p_fetched_count, p_inserted_count, p_metadata, left(p_error,1500));
END;
$$;
REVOKE ALL ON FUNCTION public.record_crawl_result(smallint,timestamptz,timestamptz,boolean,smallint,text,integer,integer,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_crawl_result(smallint,timestamptz,timestamptz,boolean,smallint,text,integer,integer,jsonb,text) TO service_role;
