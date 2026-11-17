-- Saved, one-time usage resets. Never delete application or profile history.
ALTER TABLE participants ADD COLUMN auto_apply_quota_reset_at TEXT;

CREATE TABLE IF NOT EXISTS usage_reset_credits (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  grant_key TEXT NOT NULL,
  granted_by_telegram_user_id INTEGER NOT NULL,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  redeemed_at TEXT,
  UNIQUE(participant_id, grant_key)
);
CREATE INDEX IF NOT EXISTS usage_reset_credits_available_idx
  ON usage_reset_credits(participant_id, redeemed_at, granted_at);
