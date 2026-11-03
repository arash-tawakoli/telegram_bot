SET lock_timeout = '2s';
SET statement_timeout = '30s';

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS listing_expired_at timestamptz;

ALTER TABLE public.applications
  ALTER COLUMN listing_id DROP NOT NULL;

ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_listing_id_fkey;

ALTER TABLE public.applications
  ADD CONSTRAINT applications_listing_id_fkey
  FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE SET NULL;

ALTER TABLE public.delivery_events
  ADD COLUMN IF NOT EXISTS listing_expired_at timestamptz;

ALTER TABLE public.delivery_events
  ALTER COLUMN listing_id DROP NOT NULL;

ALTER TABLE public.delivery_events
  DROP CONSTRAINT IF EXISTS delivery_events_listing_id_fkey;

ALTER TABLE public.delivery_events
  ADD CONSTRAINT delivery_events_listing_id_fkey
  FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE SET NULL;

ALTER TABLE public.delivery_events
  DROP CONSTRAINT IF EXISTS delivery_events_change_id_fkey;

ALTER TABLE public.delivery_events
  ADD CONSTRAINT delivery_events_change_id_fkey
  FOREIGN KEY (change_id) REFERENCES public.listing_changes(id) ON DELETE SET NULL;

ALTER TABLE public.saved_listings
  ADD COLUMN IF NOT EXISTS listing_expired_at timestamptz;

ALTER TABLE public.saved_listings
  ALTER COLUMN listing_id DROP NOT NULL;

ALTER TABLE public.saved_listings
  DROP CONSTRAINT IF EXISTS saved_listings_listing_id_fkey;

ALTER TABLE public.saved_listings
  ADD CONSTRAINT saved_listings_listing_id_fkey
  FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS listings_first_seen_retention_idx
  ON public.listings (first_seen_at, id);

COMMENT ON COLUMN public.applications.listing_expired_at IS
  'Timestamp when the referenced listing was physically removed under the 24-hour retention policy. No listing snapshot is retained.';
COMMENT ON COLUMN public.delivery_events.listing_expired_at IS
  'Timestamp when the referenced listing was physically removed under the 24-hour retention policy.';
COMMENT ON COLUMN public.saved_listings.listing_expired_at IS
  'Timestamp when the saved listing expired and its listing reference was cleared.';

CREATE OR REPLACE FUNCTION app_private.delete_expired_listings(p_limit integer DEFAULT 5000)
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

  -- Cron runs every minute; deletion starts on the first run at or after 24 hours.
  SELECT array_agg(expired.id)
    INTO expired_ids
  FROM (
    SELECT l.id
    FROM public.listings AS l
    WHERE l.first_seen_at <= now() - interval '24 hours'
    ORDER BY l.first_seen_at, l.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ) AS expired;

  IF expired_ids IS NULL OR cardinality(expired_ids) = 0 THEN
    RETURN 0;
  END IF;

  -- Keep application status/history, but never retain listing content after expiry.
  UPDATE public.applications AS a
  SET listing_id = NULL,
      listing_expired_at = COALESCE(a.listing_expired_at, now()),
      status = CASE WHEN a.status IN ('pending', 'processing') THEN 'failed' ELSE a.status END,
      last_error = CASE WHEN a.status IN ('pending', 'processing') THEN 'listing_expired' ELSE a.last_error END,
      wait_reason = CASE WHEN a.status IN ('pending', 'processing') THEN 'listing_expired' ELSE a.wait_reason END,
      lease_token = NULL,
      lease_until = NULL,
      next_attempt_at = CASE WHEN a.status IN ('pending', 'processing') THEN now() ELSE a.next_attempt_at END
  WHERE a.listing_id = ANY(expired_ids);

  -- Preserve delivery history while preventing retries against expired listings.
  -- Detach change_id first because listing_changes are deleted with their listing.
  UPDATE public.delivery_events AS d
  SET listing_id = NULL,
      change_id = NULL,
      listing_expired_at = COALESCE(d.listing_expired_at, now()),
      status = CASE WHEN d.status IN ('pending', 'failed', 'available') THEN 'skipped' ELSE d.status END,
      error_message = CASE WHEN d.status IN ('pending', 'failed', 'available') THEN 'listing_expired' ELSE d.error_message END,
      next_retry_at = NULL,
      preview_progress = NULL
  WHERE d.listing_id = ANY(expired_ids);

  -- Keep the user's saved-item marker without retaining the listing itself.
  UPDATE public.saved_listings AS s
  SET listing_id = NULL,
      listing_expired_at = COALESCE(s.listing_expired_at, now()),
      updated_at = now()
  WHERE s.listing_id = ANY(expired_ids);

  DELETE FROM public.listings AS l
  WHERE l.id = ANY(expired_ids);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.delete_expired_listings(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.delete_expired_listings(integer) TO service_role;

COMMENT ON FUNCTION app_private.delete_expired_listings(integer) IS
  'Physically deletes listing records after 24 hours in bounded batches. Application, delivery and saved-item history retain no listing content. Invoke from Cloudflare Cron every minute.';

RESET lock_timeout;
RESET statement_timeout;
