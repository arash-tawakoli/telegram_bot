CREATE OR REPLACE FUNCTION app_private.enqueue_cloudflare_housing_listings(
  p_after uuid DEFAULT NULL,
  p_batch_count integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '42501',
    MESSAGE = 'cloudflare_listing_export_disabled_by_policy';
END;
$function$;

REVOKE ALL ON FUNCTION app_private.enqueue_cloudflare_housing_listings(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION app_private.enqueue_cloudflare_housing_listings(uuid, integer) IS
  'Disabled by housing data-retention policy: listing records must never be exported to Cloudflare.';
