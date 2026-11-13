ALTER TABLE telegram_updates ADD COLUMN payload_json TEXT;
ALTER TABLE telegram_updates ADD COLUMN processing_at TEXT;

CREATE INDEX telegram_updates_recovery_idx
  ON telegram_updates(status,processing_at,attempts);
