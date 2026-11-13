CREATE TABLE IF NOT EXISTS application_dedupe_keys (
  key_hash TEXT PRIMARY KEY CHECK (length(key_hash) = 64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
