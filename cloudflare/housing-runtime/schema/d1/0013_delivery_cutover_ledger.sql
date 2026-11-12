CREATE TABLE IF NOT EXISTS delivery_cutover_ledger (
  delivery_key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('reserved','sending','sent','unknown')),
  lease_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
