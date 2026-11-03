SET lock_timeout = '2s';
SET statement_timeout = '30s';

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS listing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.applications
  ALTER COLUMN listing_id DROP NOT NULL;

ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_listing_id_fkey;

ALTER TABLE public.applications
  ADD CONSTRAINT applications_listing_id_fkey
  FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS listings_first_seen_retention_idx
  ON public.listings (first_seen_at, id);

COMMENT ON COLUMN public.applications.listing_snapshot IS
  'Small immutable listing summary retained when the source listing expires after 24 hours.';

CREATE OR REPLACE FUNCTION app_private.delete_expired_listings(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  expired_ids uuid[];
  deleted_count integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 5000';
  END IF;

  -- The Worker runs this every minute. The one-minute safety margin keeps
  -- physical deletion inside the 24-hour retention window.
  SELECT array_agg(expired.id)
    INTO expired_ids
  FROM (
    SELECT l.id
    FROM public.listings AS l
    WHERE l.first_seen_at <= now() - interval '23 hours 59 minutes'
    ORDER BY l.first_seen_at, l.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ) AS expired;

  IF expired_ids IS NULL OR cardinality(expired_ids) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.applications AS a
  SET listing_snapshot = CASE
        WHEN a.listing_snapshot = '{}'::jsonb THEN jsonb_strip_nulls(jsonb_build_object(
          'id', l.id,
          'title', l.title,
          'canonical_url', l.canonical_url,
          'district', l.district,
          'postal_code', l.postal_code,
          'city', l.city,
          'source_id', l.source_id,
          'source_name', s.name,
          'first_seen_at', l.first_seen_at,
          'warm_rent', l.warm_rent,
          'rooms', l.rooms,
          'area_sqm', l.area_sqm,
          'address', l.address,
          'property_type', l.property_type
        ))
        ELSE a.listing_snapshot
      END,
      listing_id = NULL,
      status = CASE WHEN a.status IN ('pending', 'processing') THEN 'failed' ELSE a.status END,
      last_error = CASE WHEN a.status IN ('pending', 'processing') THEN 'listing_expired' ELSE a.last_error END,
      wait_reason = CASE WHEN a.status IN ('pending', 'processing') THEN 'listing_expired' ELSE a.wait_reason END,
      lease_token = NULL,
      lease_until = NULL,
      next_attempt_at = CASE WHEN a.status IN ('pending', 'processing') THEN now() ELSE a.next_attempt_at END
  FROM public.listings AS l
  LEFT JOIN public.sources AS s ON s.id = l.source_id
  WHERE a.listing_id = l.id
    AND l.id = ANY(expired_ids);

  DELETE FROM public.listings AS l
  WHERE l.id = ANY(expired_ids);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.delete_expired_listings(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.delete_expired_listings(integer) TO service_role;

COMMENT ON FUNCTION app_private.delete_expired_listings(integer) IS
  'Deletes listings before their 24-hour maximum age in bounded batches. Invoke from the Cloudflare Cron Worker every minute.';

RESET lock_timeout;
RESET statement_timeout;
