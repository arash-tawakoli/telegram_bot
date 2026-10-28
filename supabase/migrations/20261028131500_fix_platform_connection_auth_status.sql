-- Authentication failures must not leave a platform connection marked pending/connected.
CREATE OR REPLACE FUNCTION public.record_platform_connection_refresh(
  p_user uuid,
  p_provider text,
  p_success boolean,
  p_error text DEFAULT NULL::text,
  p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.platform_connections
  SET
    refresh_attempts = refresh_attempts + 1,
    last_refresh_at = CASE WHEN p_success THEN now() ELSE last_refresh_at END,
    last_refresh_error = CASE
      WHEN p_success THEN NULL
      ELSE left(coalesce(nullif(btrim(p_error),''),'refresh_failed'),120)
    END,
    last_verified_at = CASE WHEN p_success THEN now() ELSE last_verified_at END,
    expires_at = CASE WHEN p_success AND p_expires_at IS NOT NULL THEN p_expires_at ELSE expires_at END,
    status = CASE
      WHEN NOT p_success
        AND coalesce(p_error,'') ~* '(refresh_http_(400|401|403)|invalid_grant|session_token_missing|token_expired|unauthorized|forbidden)'
      THEN 'needs_login'
      ELSE status
    END,
    last_error = CASE
      WHEN NOT p_success
        AND coalesce(p_error,'') ~* '(refresh_http_(400|401|403)|invalid_grant|session_token_missing|token_expired|unauthorized|forbidden)'
      THEN 'needs_login'
      ELSE last_error
    END,
    updated_at = now()
  WHERE user_id=p_user AND provider=p_provider;
END
$function$;

-- Repair already-recorded authentication failures without touching credentials.
UPDATE public.platform_connections
SET status='needs_login',
    last_error='needs_login',
    updated_at=now()
WHERE provider IN ('immoscout','immowelt','kleinanzeigen','immomio')
  AND status IN ('pending','connected')
  AND (
    lower(coalesce(last_error,'')) IN ('login_failed','refresh_failed','needs_login','session_token_missing')
    OR lower(coalesce(last_refresh_error,'')) ~* '(refresh_http_(400|401|403)|invalid_grant|session_token_missing|token_expired|unauthorized|forbidden)'
  );

DO $validation$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.platform_connections
    WHERE provider IN ('immoscout','immowelt','kleinanzeigen','immomio')
      AND status IN ('pending','connected')
      AND (
        lower(coalesce(last_error,'')) IN ('login_failed','refresh_failed','needs_login','session_token_missing')
        OR lower(coalesce(last_refresh_error,'')) ~* '(refresh_http_(400|401|403)|invalid_grant|session_token_missing|token_expired|unauthorized|forbidden)'
      )
  ) THEN
    RAISE EXCEPTION 'Platform connection auth failures still have a misleading status';
  END IF;
END
$validation$;
