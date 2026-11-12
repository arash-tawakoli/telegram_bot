CREATE TABLE IF NOT EXISTS scout_shadow_scans (
  source_id INTEGER PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  queue_json TEXT NOT NULL,
  root_total INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  unresolved INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  lease_token TEXT,
  lease_until TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS scout_shadow_offers (
  source_id INTEGER NOT NULL,
  external_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  facts TEXT NOT NULL,
  seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(source_id, external_id)
);
CREATE INDEX IF NOT EXISTS scout_shadow_offers_cycle_idx ON scout_shadow_offers(source_id, cycle_id);
