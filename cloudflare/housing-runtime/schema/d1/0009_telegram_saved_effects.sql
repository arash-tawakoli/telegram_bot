CREATE TABLE IF NOT EXISTS telegram_saved_effects (
  update_id INTEGER PRIMARY KEY,
  participant_id TEXT NOT NULL,
  offer_identity_id TEXT NOT NULL,
  saved INTEGER NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
