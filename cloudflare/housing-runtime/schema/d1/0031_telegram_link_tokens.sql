-- One-time links a coach creates so a portal participant can connect a Telegram account.
CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  token_hash TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_by_member_id TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS telegram_link_tokens_participant_idx ON telegram_link_tokens(participant_id);
