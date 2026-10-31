CREATE TABLE IF NOT EXISTS central_credentials (
  singleton TEXT PRIMARY KEY CHECK (singleton = 'central'),
  account_hint TEXT NOT NULL CHECK (lower(account_hint) = 'arash@nexalabs.de'),
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

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  account_hint TEXT,
  admin_telegram_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
