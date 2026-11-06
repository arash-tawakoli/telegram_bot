-- One-time additive import while the legacy Supabase PostgreSQL host is still available.
-- Run only after 0001 and 0002. Drop this function after a verified export/import.
CREATE OR REPLACE FUNCTION housing.import_legacy_housing_core()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, housing, auth, pg_temp
AS $function$
DECLARE
  participants_count integer := 0;
  profiles_count integer := 0;
  searches_count integer := 0;
  offers_count integer := 0;
  deliveries_count integer := 0;
  applications_count integer := 0;
BEGIN
  INSERT INTO housing.participants (id, email, first_name, last_name, status, created_at, updated_at)
  SELECT
    u.id,
    p.email,
    COALESCE(NULLIF(p.first_name, ''), NULLIF(u.first_name, ''), 'Teilnehmer'),
    COALESCE(NULLIF(p.last_name, ''), NULLIF(u.last_name, ''), 'Unbekannt'),
    CASE WHEN u.is_active THEN 'active' ELSE 'archived' END,
    COALESCE(u.created_at, now()),
    COALESCE(u.updated_at, now())
  FROM public.bot_users u
  LEFT JOIN public.applicant_profiles p ON p.user_id = u.id
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    status = EXCLUDED.status,
    updated_at = EXCLUDED.updated_at;
  GET DIAGNOSTICS participants_count = ROW_COUNT;

  INSERT INTO housing.portal_members (id, email, display_name, role, password_hash, active, created_at, updated_at)
  SELECT
    cm.id,
    COALESCE(au.email, 'migration+' || cm.id::text || '@invalid.local'),
    COALESCE(NULLIF(cm.display_name, ''), COALESCE(au.email, 'Coach')),
    CASE WHEN cm.is_super_admin THEN 'super_admin' WHEN cm.role = 'admin' THEN 'admin' ELSE 'coach' END,
    'migration_required$' || cm.id::text,
    COALESCE(cm.is_active, false),
    COALESCE(cm.created_at, now()),
    COALESCE(cm.updated_at, now())
  FROM public.coaching_members cm
  LEFT JOIN auth.users au ON au.id = cm.auth_user_id
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, role = EXCLUDED.role, active = EXCLUDED.active, updated_at = EXCLUDED.updated_at;

  INSERT INTO housing.participant_assignments (participant_id, member_id, updated_at)
  SELECT cp.user_id, cp.coach_member_id, COALESCE(cp.updated_at, now())
  FROM public.coaching_participants cp
  JOIN housing.participants p ON p.id = cp.user_id
  JOIN housing.portal_members m ON m.id = cp.coach_member_id
  ON CONFLICT (participant_id) DO UPDATE SET member_id = EXCLUDED.member_id, updated_at = EXCLUDED.updated_at;

  INSERT INTO housing.applicant_profiles (participant_id, profile, updated_at)
  SELECT p.user_id, to_jsonb(p) - 'user_id', COALESCE(p.updated_at, now())
  FROM public.applicant_profiles p
  ON CONFLICT (participant_id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = EXCLUDED.updated_at;
  GET DIAGNOSTICS profiles_count = ROW_COUNT;

  INSERT INTO housing.search_profiles (id, participant_id, criteria, active, created_at, updated_at)
  SELECT s.id, s.user_id, to_jsonb(s) - ARRAY['id','user_id']::text[], COALESCE(s.is_active, false), COALESCE(s.created_at, now()), COALESCE(s.updated_at, now())
  FROM public.search_profiles s
  JOIN housing.participants p ON p.id = s.user_id
  ON CONFLICT (id) DO UPDATE SET criteria = EXCLUDED.criteria, active = EXCLUDED.active, updated_at = EXCLUDED.updated_at;
  GET DIAGNOSTICS searches_count = ROW_COUNT;

  INSERT INTO housing.source_links (search_profile_id, source_id)
  SELECT DISTINCT sp.id, sr.id
  FROM public.search_profiles sp
  CROSS JOIN housing.source_registry sr
  WHERE sp.is_active = true AND sr.enabled = true
  ON CONFLICT DO NOTHING;

  INSERT INTO housing.application_preferences (participant_id, enabled, daily_limit, timezone, allowed_weekdays, send_window_start, send_window_end, immoscout_enabled, immowelt_enabled, immomio_enabled, updated_at)
  SELECT a.user_id, a.enabled, a.daily_limit, COALESCE(a.timezone, 'Europe/Berlin'), a.allowed_weekdays, a.send_window_start, a.send_window_end, COALESCE(a.immoscout_enabled, false), COALESCE(a.immowelt_enabled, false), COALESCE(a.immomio_enabled, false), COALESCE(a.updated_at, now())
  FROM public.application_preferences a
  JOIN housing.participants p ON p.id = a.user_id
  ON CONFLICT (participant_id) DO UPDATE SET
    enabled = EXCLUDED.enabled, daily_limit = EXCLUDED.daily_limit, timezone = EXCLUDED.timezone,
    allowed_weekdays = EXCLUDED.allowed_weekdays, send_window_start = EXCLUDED.send_window_start,
    send_window_end = EXCLUDED.send_window_end, immoscout_enabled = EXCLUDED.immoscout_enabled,
    immowelt_enabled = EXCLUDED.immowelt_enabled, immomio_enabled = EXCLUDED.immomio_enabled,
    updated_at = EXCLUDED.updated_at;

  INSERT INTO housing.provider_connections (id, participant_id, provider, status, ciphertext, iv, key_version, expires_at, updated_at)
  SELECT
    gen_random_uuid(), c.user_id,
    CASE c.provider WHEN 'immoscout' THEN 'immoscout24' ELSE c.provider END,
    CASE c.status WHEN 'connected' THEN 'connected' WHEN 'needs_login' THEN 'needs_login' WHEN 'error' THEN 'error' ELSE 'disconnected' END,
    c.credential_ciphertext, c.credential_iv, c.key_version, c.expires_at, COALESCE(c.updated_at, now())
  FROM public.platform_connections c
  JOIN housing.participants p ON p.id = c.user_id
  WHERE c.provider IN ('immoscout','immowelt','immomio')
  ON CONFLICT (participant_id, provider) DO UPDATE SET
    status = EXCLUDED.status, ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv,
    key_version = EXCLUDED.key_version, expires_at = EXCLUDED.expires_at, updated_at = EXCLUDED.updated_at;

  INSERT INTO housing.documents (id, participant_id, object_key, original_filename, document_type, content_type, size_bytes, send_with_auto_apply, created_at)
  SELECT d.id, d.user_id, d.storage_path, d.original_filename, d.document_type, COALESCE(d.mime_type, 'application/octet-stream'), COALESCE(d.size_bytes, 0), COALESCE(d.send_with_auto_apply, false), COALESCE(d.created_at, now())
  FROM public.applicant_documents d
  JOIN housing.participants p ON p.id = d.user_id
  ON CONFLICT (id) DO UPDATE SET send_with_auto_apply = EXCLUDED.send_with_auto_apply;

  INSERT INTO housing.offer_identities (id, source_id, identity_hash, external_id, canonical_url, facts, first_seen_at, last_seen_at, expires_at)
  SELECT
    l.id,
    l.source_id,
    CASE WHEN COALESCE(l.external_id, l.source_listing_key) IS NOT NULL AND COALESCE(l.external_id, l.source_listing_key) <> ''
      THEN l.source_id::text || ':external:' || COALESCE(l.external_id, l.source_listing_key)
      ELSE l.source_id::text || ':url:' || l.canonical_url END,
    COALESCE(l.external_id, l.source_listing_key),
    l.canonical_url,
    jsonb_build_object('title', l.title, 'address', l.address, 'district', l.district, 'postal_code', l.postal_code, 'city', l.city, 'warm_rent', l.warm_rent, 'cold_rent', l.cold_rent, 'rooms', l.rooms, 'area_sqm', l.area_sqm, 'available_from', l.available_from, 'property_type', l.property_type, 'wbs_required', l.wbs_required, 'image_url', l.image_url),
    COALESCE(l.first_seen_at, now()), COALESCE(l.last_seen_at, now()), COALESCE(l.first_seen_at, now()) + interval '24 hours'
  FROM public.listings l
  WHERE l.source_id IN (1,3,23,29,34,35,66,69,71)
  ON CONFLICT (id) DO UPDATE SET facts = EXCLUDED.facts, last_seen_at = EXCLUDED.last_seen_at, expires_at = EXCLUDED.expires_at;
  GET DIAGNOSTICS offers_count = ROW_COUNT;

  INSERT INTO housing.deliveries (id, participant_id, offer_identity_id, idempotency_key, status, telegram_message_id, created_at, sent_at, error_message)
  SELECT
    d.id, sp.user_id, d.listing_id, sp.user_id::text || ':' || oi.identity_hash,
    CASE d.status WHEN 'sent' THEN 'sent' WHEN 'failed' THEN 'failed' WHEN 'skipped' THEN 'skipped' ELSE 'pending' END,
    d.telegram_message_id, COALESCE(d.created_at, now()), d.sent_at, d.error_message
  FROM public.delivery_events d
  JOIN public.search_profiles sp ON sp.id = d.profile_id
  JOIN housing.offer_identities oi ON oi.id = d.listing_id
  JOIN housing.participants p ON p.id = sp.user_id
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS deliveries_count = ROW_COUNT;

  INSERT INTO housing.applications (id, participant_id, offer_identity_id, provider, idempotency_key, status, last_error, created_at, updated_at)
  SELECT
    a.id, a.user_id, a.listing_id,
    CASE COALESCE(a.provider_state->>'provider', '') WHEN 'immoscout' THEN 'immoscout24' WHEN 'immowelt' THEN 'immowelt' WHEN 'immomio' THEN 'immomio' ELSE CASE WHEN a.source_id = 1 THEN 'immoscout24' WHEN a.source_id = 3 THEN 'immowelt' ELSE 'immomio' END END,
    a.user_id::text || ':' || CASE COALESCE(a.provider_state->>'provider', '') WHEN 'immoscout' THEN 'immoscout24' WHEN 'immowelt' THEN 'immowelt' WHEN 'immomio' THEN 'immomio' ELSE CASE WHEN a.source_id = 1 THEN 'immoscout24' WHEN a.source_id = 3 THEN 'immowelt' ELSE 'immomio' END END || ':' || oi.identity_hash,
    CASE a.status WHEN 'sent' THEN 'sent' WHEN 'failed' THEN 'failed' WHEN 'manual_required' THEN 'manual_required' WHEN 'processing' THEN 'processing' ELSE 'pending' END,
    a.last_error, COALESCE(a.created_at, now()), COALESCE(a.sent_at, a.created_at, now())
  FROM public.applications a
  JOIN housing.offer_identities oi ON oi.id = a.listing_id
  JOIN housing.participants p ON p.id = a.user_id
  WHERE a.source_id IN (1,3,23,29,34,35,66,69,71)
  ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, last_error = EXCLUDED.last_error, updated_at = EXCLUDED.updated_at;
  GET DIAGNOSTICS applications_count = ROW_COUNT;

  RETURN jsonb_build_object('participants', participants_count, 'profiles', profiles_count, 'search_profiles', searches_count, 'offers', offers_count, 'deliveries', deliveries_count, 'applications', applications_count);
END;
$function$;

REVOKE ALL ON FUNCTION housing.import_legacy_housing_core() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION housing.import_legacy_housing_core() TO service_role;
