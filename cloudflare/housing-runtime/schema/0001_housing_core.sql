CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS housing;

CREATE TABLE IF NOT EXISTS housing.source_registry (
  id smallint PRIMARY KEY,
  name text NOT NULL,
  family text NOT NULL CHECK (family IN ('immoscout24', 'immowelt', 'immomio')),
  connector text NOT NULL,
  connector_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  last_success_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0)
);

INSERT INTO housing.source_registry (id, name, family, connector) VALUES
  (1, 'ImmobilienScout24 Hamburg', 'immoscout24', 'mcp'),
  (3, 'Immowelt Hamburg', 'immowelt', 'html_discovery'),
  (23, 'Hamburger Wohnen', 'immomio', 'immomio_tenant'),
  (29, 'VHW', 'immomio', 'immomio_tenant'),
  (34, 'Bauverein Reiherstieg', 'immomio', 'immomio_tenant'),
  (35, 'Walddörfer', 'immomio', 'immomio_tenant'),
  (66, 'GEWOBA Nord', 'immomio', 'immomio_tenant'),
  (69, 'ImmobilienScout24 Schleswig-Holstein', 'immoscout24', 'mcp'),
  (71, 'Immowelt Schleswig-Holstein', 'immowelt', 'html_discovery')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  family = EXCLUDED.family,
  connector = EXCLUDED.connector,
  enabled = true;

CREATE TABLE IF NOT EXISTS housing.participants (
  id uuid PRIMARY KEY,
  email text,
  first_name text NOT NULL,
  last_name text NOT NULL,
  telegram_user_id bigint,
  telegram_chat_id bigint,
  telegram_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ui_language text NOT NULL DEFAULT 'de',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'pending_deletion')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.portal_members (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'coach' CHECK (role IN ('coach', 'admin', 'super_admin')),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.participant_assignments (
  participant_id uuid PRIMARY KEY REFERENCES housing.participants(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES housing.portal_members(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.portal_sessions (
  id uuid PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES housing.portal_members(id) ON DELETE CASCADE,
  access_token_hash text NOT NULL UNIQUE,
  refresh_token_hash text NOT NULL UNIQUE,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.bootstrap_tokens (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.search_profiles (
  id uuid PRIMARY KEY,
  participant_id uuid NOT NULL REFERENCES housing.participants(id) ON DELETE CASCADE,
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.source_links (
  search_profile_id uuid NOT NULL REFERENCES housing.search_profiles(id) ON DELETE CASCADE,
  source_id smallint NOT NULL REFERENCES housing.source_registry(id),
  PRIMARY KEY (search_profile_id, source_id)
);

CREATE TABLE IF NOT EXISTS housing.applicant_profiles (
  participant_id uuid PRIMARY KEY REFERENCES housing.participants(id) ON DELETE CASCADE,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.documents (
  id uuid PRIMARY KEY,
  participant_id uuid NOT NULL REFERENCES housing.participants(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  document_type text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  send_with_auto_apply boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.upload_tokens (
  id uuid PRIMARY KEY,
  participant_id uuid NOT NULL REFERENCES housing.participants(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  object_key text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  document_type text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  expires_at timestamptz NOT NULL,
  uploaded_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.provider_connections (
  id uuid PRIMARY KEY,
  participant_id uuid NOT NULL REFERENCES housing.participants(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('immoscout24', 'immowelt', 'immomio')),
  status text NOT NULL CHECK (status IN ('pending', 'connected', 'needs_login', 'error', 'disconnected')),
  ciphertext text,
  iv text,
  key_version integer,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id, provider)
);

CREATE TABLE IF NOT EXISTS housing.application_preferences (
  participant_id uuid PRIMARY KEY REFERENCES housing.participants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  daily_limit integer CHECK (daily_limit IS NULL OR daily_limit BETWEEN 1 AND 1000),
  timezone text NOT NULL DEFAULT 'Europe/Berlin',
  allowed_weekdays smallint[],
  send_window_start time,
  send_window_end time,
  immoscout_enabled boolean NOT NULL DEFAULT false,
  immowelt_enabled boolean NOT NULL DEFAULT false,
  immomio_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.offer_identities (
  id uuid PRIMARY KEY,
  source_id smallint NOT NULL REFERENCES housing.source_registry(id),
  identity_hash text NOT NULL UNIQUE,
  external_id text,
  canonical_url text NOT NULL,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE TABLE IF NOT EXISTS housing.deliveries (
  id uuid PRIMARY KEY,
  participant_id uuid NOT NULL REFERENCES housing.participants(id) ON DELETE CASCADE,
  offer_identity_id uuid NOT NULL REFERENCES housing.offer_identities(id),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error_message text,
  telegram_message_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS housing.applications (
  id uuid PRIMARY KEY,
  participant_id uuid NOT NULL REFERENCES housing.participants(id) ON DELETE CASCADE,
  offer_identity_id uuid NOT NULL REFERENCES housing.offer_identities(id),
  provider text NOT NULL CHECK (provider IN ('immoscout24', 'immowelt', 'immomio')),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'manual_required')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.application_events (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES housing.applications(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('immoscout24', 'immowelt', 'immomio')),
  event_type text NOT NULL,
  status text,
  attempt integer,
  reason text,
  document_result text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.jobs (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('source', 'delivery', 'application')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  participant_id uuid REFERENCES housing.participants(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.telegram_updates (
  update_id bigint PRIMARY KEY,
  payload_hash text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  received_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error text
);

CREATE INDEX IF NOT EXISTS housing_search_profiles_participant_idx ON housing.search_profiles (participant_id);
CREATE INDEX IF NOT EXISTS housing_participant_assignments_member_idx ON housing.participant_assignments (member_id);
CREATE INDEX IF NOT EXISTS housing_portal_sessions_access_idx ON housing.portal_sessions (access_token_hash);
CREATE INDEX IF NOT EXISTS housing_portal_sessions_refresh_idx ON housing.portal_sessions (refresh_token_hash);
CREATE INDEX IF NOT EXISTS housing_offer_identities_source_idx ON housing.offer_identities (source_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS housing_upload_tokens_participant_idx ON housing.upload_tokens (participant_id, expires_at);
CREATE INDEX IF NOT EXISTS housing_deliveries_participant_idx ON housing.deliveries (participant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS housing_applications_participant_idx ON housing.applications (participant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS housing_application_events_application_idx ON housing.application_events (application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS housing_jobs_ready_idx ON housing.jobs (kind, status, lease_until, created_at);
CREATE INDEX IF NOT EXISTS housing_telegram_updates_status_idx ON housing.telegram_updates (status, received_at);
CREATE UNIQUE INDEX IF NOT EXISTS housing_participants_telegram_user_idx
  ON housing.participants (telegram_user_id) WHERE telegram_user_id IS NOT NULL;
