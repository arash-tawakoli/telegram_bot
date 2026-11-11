PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS source_registry (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  family TEXT NOT NULL CHECK (family IN ('immoscout24','immowelt','immomio')),
  connector TEXT NOT NULL,
  connector_config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_success_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  email TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  telegram_user_id INTEGER UNIQUE,
  telegram_chat_id INTEGER,
  ui_language TEXT NOT NULL DEFAULT 'de',
  telegram_state TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','pending_deletion')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS portal_members (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'coach' CHECK (role IN ('coach','admin','super_admin')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS participant_assignments (
  participant_id TEXT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES portal_members(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS portal_sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES portal_members(id) ON DELETE CASCADE,
  access_token_hash TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  access_expires_at TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bootstrap_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS search_profiles (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  criteria TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS source_links (
  search_profile_id TEXT NOT NULL REFERENCES search_profiles(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES source_registry(id),
  PRIMARY KEY (search_profile_id, source_id)
);

CREATE TABLE IF NOT EXISTS applicant_profiles (
  participant_id TEXT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  profile TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  document_type TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  send_with_auto_apply INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS upload_tokens (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  document_type TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  uploaded_at TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS provider_connections (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('immoscout24','immowelt','immomio')),
  status TEXT NOT NULL CHECK (status IN ('pending','connected','needs_login','error','disconnected')),
  ciphertext TEXT,
  iv TEXT,
  key_version INTEGER,
  account_hint TEXT,
  expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (participant_id, provider)
);

CREATE TABLE IF NOT EXISTS application_preferences (
  participant_id TEXT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  daily_limit INTEGER,
  timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
  allowed_weekdays TEXT,
  send_window_start TEXT,
  send_window_end TEXT,
  immoscout_enabled INTEGER NOT NULL DEFAULT 0,
  immowelt_enabled INTEGER NOT NULL DEFAULT 0,
  immomio_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS offer_identities (
  id TEXT PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES source_registry(id),
  identity_hash TEXT NOT NULL UNIQUE,
  external_id TEXT,
  canonical_url TEXT NOT NULL,
  facts TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  offer_identity_id TEXT REFERENCES offer_identities(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','processing','sent','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  telegram_message_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  listing_expired_at TEXT
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  offer_identity_id TEXT REFERENCES offer_identities(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('immoscout24','immowelt','immomio')),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','processing','sent','failed','manual_required')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  listing_expired_at TEXT
);

CREATE TABLE IF NOT EXISTS application_events (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT,
  attempt INTEGER,
  reason TEXT,
  document_result TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('source','delivery','application')),
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('queued','processing','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id INTEGER PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS provider_auth_flows (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  state TEXT NOT NULL UNIQUE,
  code_verifier TEXT,
  origin TEXT,
  return_target TEXT,
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS participants_telegram_idx ON participants(telegram_user_id);
CREATE INDEX IF NOT EXISTS search_profiles_participant_idx ON search_profiles(participant_id);
CREATE INDEX IF NOT EXISTS source_links_source_idx ON source_links(source_id);
CREATE INDEX IF NOT EXISTS offer_identities_source_idx ON offer_identities(source_id,last_seen_at);
CREATE INDEX IF NOT EXISTS deliveries_participant_idx ON deliveries(participant_id,created_at);
CREATE INDEX IF NOT EXISTS applications_participant_idx ON applications(participant_id,created_at);
CREATE INDEX IF NOT EXISTS application_events_application_idx ON application_events(application_id,created_at);
CREATE INDEX IF NOT EXISTS jobs_ready_idx ON jobs(kind,status,lease_until,created_at);
CREATE INDEX IF NOT EXISTS telegram_updates_status_idx ON telegram_updates(status,received_at);
CREATE INDEX IF NOT EXISTS provider_auth_flows_lookup_idx ON provider_auth_flows(participant_id,provider,state,expires_at);

-- The central ImmoScout24 credential is housing automation state, so it lives in
-- the same D1 database instead of a second legacy database.
CREATE TABLE IF NOT EXISTS central_credentials (
  singleton TEXT PRIMARY KEY CHECK (singleton = 'central'),
  account_hint TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('connected','needs_login','error')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  expires_at TEXT,
  last_verified_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS central_oauth_flows (
  state_hash TEXT PRIMARY KEY,
  verifier_ciphertext TEXT NOT NULL,
  verifier_iv TEXT NOT NULL,
  admin_telegram_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS central_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  account_hint TEXT,
  admin_telegram_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
