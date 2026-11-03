SET lock_timeout = '2s';
SET statement_timeout = '30s';

-- Staged retirement migration. Do not apply until the complete Cloudflare
-- replacement has passed data reconciliation and end-to-end smoke tests.
UPDATE public.sources
SET enabled = false
WHERE id IN (2, 6);

UPDATE public.application_preferences
SET kleinanzeigen_enabled = false,
    updated_at = now()
WHERE kleinanzeigen_enabled IS DISTINCT FROM false;

CREATE OR REPLACE FUNCTION app_private.application_provider_target(
  p_source_id smallint,
  p_raw jsonb,
  p_canonical_url text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $fn$
DECLARE
  target jsonb;
BEGIN
  target := app_private.immomio_application_target(p_raw, p_canonical_url);
  IF target->>'status' = 'conflict' THEN
    RETURN NULL;
  END IF;
  IF target->>'status' = 'resolved' THEN
    RETURN 'immomio';
  END IF;

  RETURN CASE
    WHEN p_source_id = 1 THEN 'immoscout'
    WHEN p_source_id = 3 THEN 'immowelt'
    ELSE NULL
  END;
END
$fn$;

CREATE OR REPLACE FUNCTION public.set_application_provider_enabled_shared(
  p_user uuid,
  p_provider text,
  p_enabled boolean
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  global_enabled boolean;
BEGIN
  IF p_provider NOT IN ('immoscout', 'immomio', 'immowelt') THEN
    RAISE EXCEPTION 'invalid_provider';
  END IF;

  SELECT u.auto_apply_enabled
  INTO global_enabled
  FROM public.bot_users u
  WHERE u.id = p_user AND u.is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'participant_unavailable';
  END IF;

  IF p_enabled AND NOT app_private.user_is_premium(p_user) THEN
    RAISE EXCEPTION 'premium_required';
  END IF;

  INSERT INTO public.application_preferences (
    user_id, enabled, immoscout_enabled, kleinanzeigen_enabled,
    immomio_enabled, immowelt_enabled
  )
  VALUES (
    p_user, COALESCE(global_enabled, false),
    CASE WHEN p_provider = 'immoscout' THEN p_enabled ELSE COALESCE(global_enabled, false) END,
    false,
    CASE WHEN p_provider = 'immomio' THEN p_enabled ELSE COALESCE(global_enabled, false) END,
    CASE WHEN p_provider = 'immowelt' THEN p_enabled ELSE false END
  )
  ON CONFLICT (user_id) DO UPDATE SET
    immoscout_enabled = CASE WHEN p_provider = 'immoscout' THEN p_enabled ELSE public.application_preferences.immoscout_enabled END,
    kleinanzeigen_enabled = false,
    immomio_enabled = CASE WHEN p_provider = 'immomio' THEN p_enabled ELSE public.application_preferences.immomio_enabled END,
    immowelt_enabled = CASE WHEN p_provider = 'immowelt' THEN p_enabled ELSE public.application_preferences.immowelt_enabled END,
    updated_at = now();

  IF NOT p_enabled THEN
    UPDATE public.applications a
    SET status = 'failed',
        last_error = 'provider_paused',
        wait_reason = NULL,
        lease_until = NULL
    FROM public.listings l
    WHERE a.user_id = p_user
      AND a.listing_id = l.id
      AND a.status = 'pending'
      AND a.submission_started_at IS NULL
      AND app_private.application_provider_target(l.source_id, l.raw, l.canonical_url) = p_provider;
  ELSE
    PERFORM app_private.reconcile_recent_user_applications(
      p_user, p_provider, interval '48 hours', NULL
    );
  END IF;

  RETURN true;
END
$fn$;

RESET lock_timeout;
RESET statement_timeout;
