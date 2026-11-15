-- Retain each participant's own bookmarked offer independently of delivery retention.
CREATE TABLE IF NOT EXISTS saved_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  offer_identity_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  warm_rent REAL,
  saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(participant_id, offer_identity_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_offers_participant_recent
  ON saved_offers(participant_id, saved_at DESC, id DESC);

-- Reinstall the persistent reply keyboard only when its layout changes,
-- never on every /start.
ALTER TABLE participants ADD COLUMN reply_keyboard_version INTEGER NOT NULL DEFAULT 0;
