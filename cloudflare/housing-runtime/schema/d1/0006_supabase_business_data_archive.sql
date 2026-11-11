-- Expand Cloudflare D1 to cover the remaining live Supabase business tables.
-- Raw source snapshots are preserved separately in supabase_archive_rows.
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'stripe',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'inactive',
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  last_event_created INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(participant_id, provider)
);
CREATE INDEX IF NOT EXISTS user_subscriptions_status_idx ON user_subscriptions(status, current_period_end);
CREATE INDEX IF NOT EXISTS user_subscriptions_customer_idx ON user_subscriptions(stripe_customer_id);

CREATE TABLE IF NOT EXISTS saved_listings (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  offer_identity_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  listing_expired_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS saved_listings_participant_offer_idx
  ON saved_listings(participant_id, offer_identity_id) WHERE offer_identity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS saved_listings_participant_created_idx
  ON saved_listings(participant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS referral_codes (
  participant_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  referrer_participant_id TEXT NOT NULL,
  referred_participant_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'registered',
  qualified_at TEXT,
  rewarded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stripe_customer_id TEXT,
  stripe_credit_transaction_id TEXT,
  reward_amount_cents INTEGER NOT NULL DEFAULT 499,
  premium_granted_until TEXT
);
CREATE INDEX IF NOT EXISTS referrals_referrer_created_idx ON referrals(referrer_participant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_reauth_notifications (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'needs_login',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reminder_stage INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS platform_reauth_due_idx
  ON platform_reauth_notifications(status, available_at, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS platform_reauth_open_idx
  ON platform_reauth_notifications(participant_id, provider)
  WHERE status IN ('pending','sending');

CREATE TABLE IF NOT EXISTS user_engagement_notifications (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  campaign_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  sent_at TEXT,
  clicked_at TEXT,
  feedback_value TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS user_engagement_due_idx
  ON user_engagement_notifications(status, available_at, scheduled_at, created_at);
CREATE INDEX IF NOT EXISTS user_engagement_user_idx
  ON user_engagement_notifications(participant_id, campaign_key, status);

CREATE TABLE IF NOT EXISTS telegram_announcements (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);

-- A lossless JSON archive allows every Supabase row to be retained while
-- functional tables are migrated into the canonical D1 schema.
CREATE TABLE IF NOT EXISTS supabase_archive_schema (
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(schema_name, table_name)
);
CREATE TABLE IF NOT EXISTS supabase_archive_rows (
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_key TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(schema_name, table_name, row_key)
);
CREATE INDEX IF NOT EXISTS supabase_archive_table_idx
  ON supabase_archive_rows(schema_name, table_name, row_index);
CREATE TABLE IF NOT EXISTS supabase_archive_exports (
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  expected_rows INTEGER NOT NULL DEFAULT 0,
  exported_rows INTEGER NOT NULL DEFAULT 0,
  next_offset INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(schema_name, table_name)
);
