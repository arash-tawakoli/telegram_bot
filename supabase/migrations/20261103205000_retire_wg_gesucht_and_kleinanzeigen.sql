SET lock_timeout = '2s';
SET statement_timeout = '30s';

-- Staged retirement migration. Do not apply until the complete Cloudflare
-- replacement has passed data reconciliation and end-to-end smoke tests.
-- Historical listings and applications are deliberately retained.

DO $retire_sources$
BEGIN
  IF to_regclass('public.sources') IS NOT NULL THEN
    EXECUTE 'UPDATE public.sources SET enabled = false WHERE id IN (2, 6)';
  END IF;
  IF to_regclass('public.source_connectors') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.source_connectors WHERE source_id IN (2, 6)';
  END IF;
  IF to_regclass('public.application_preferences') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE public.application_preferences
      SET kleinanzeigen_enabled = false, updated_at = now()
      WHERE kleinanzeigen_enabled IS DISTINCT FROM false
    $sql$;
  END IF;
  IF to_regclass('public.platform_auth_flows') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE public.platform_auth_flows
      SET consumed_at = COALESCE(consumed_at, clock_timestamp()),
          expires_at = LEAST(expires_at, clock_timestamp())
      WHERE provider IN ('kleinanzeigen', 'wg_gesucht', 'indeed')
        AND consumed_at IS NULL
    $sql$;
  END IF;
END
$retire_sources$;

-- Restrict coach-issued platform authentication to the retained housing providers.
CREATE OR REPLACE FUNCTION public.coach_issue_platform_connect_flow(
  p_actor uuid,
  p_user uuid,
  p_provider text,
  p_state text,
  p_verifier text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  actor public.coaching_members%rowtype;
  assignment public.coaching_participants%rowtype;
  flow public.platform_auth_flows%rowtype;
BEGIN
  SELECT * INTO actor
  FROM public.coaching_members
  WHERE id = p_actor AND is_active
  FOR SHARE;

  IF NOT FOUND THEN RAISE EXCEPTION 'coach_forbidden'; END IF;

  IF p_provider NOT IN ('immoscout', 'immomio', 'immowelt')
     OR p_state !~ '^[A-Za-z0-9_-]{30,100}$'
     OR p_verifier !~ '^[A-Za-z0-9_-]{43,128}$'
  THEN RAISE EXCEPTION 'provider_unsupported'; END IF;

  SELECT * INTO assignment
  FROM public.coaching_participants
  WHERE user_id = p_user
    AND workspace_id = actor.workspace_id
    AND status = 'active'
    AND (actor.role = 'admin' OR coach_member_id = p_actor)
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'participant_forbidden'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.coaching_workspaces
    WHERE id = actor.workspace_id AND is_active AND NOT operations_paused
  ) THEN RAISE EXCEPTION 'workspace_unavailable'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.coach_effective_premium_status(ARRAY[p_user])
    WHERE is_premium
  ) THEN RAISE EXCEPTION 'premium_required'; END IF;

  UPDATE public.platform_auth_flows
  SET consumed_at = clock_timestamp()
  WHERE user_id = p_user
    AND provider = p_provider
    AND consumed_at IS NULL;

  INSERT INTO public.platform_auth_flows (
    user_id, provider, state, code_verifier, origin, issued_by,
    return_target, context, expires_at
  )
  VALUES (
    p_user, p_provider, p_state, p_verifier, 'coach', actor.auth_user_id,
    'coach', jsonb_build_object('assignment_version', assignment.assignment_version),
    clock_timestamp() + interval '30 minutes'
  )
  RETURNING * INTO flow;

  RETURN jsonb_build_object('expiresAt', flow.expires_at);
END
$fn$;

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
  IF target->>'status' = 'conflict' THEN RETURN NULL; END IF;
  IF target->>'status' = 'resolved' THEN RETURN 'immomio'; END IF;

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

  SELECT u.auto_apply_enabled INTO global_enabled
  FROM public.bot_users u
  WHERE u.id = p_user AND u.is_active;

  IF NOT FOUND THEN RAISE EXCEPTION 'participant_unavailable'; END IF;
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
    SET status = 'failed', last_error = 'provider_paused',
        wait_reason = NULL, lease_until = NULL
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
