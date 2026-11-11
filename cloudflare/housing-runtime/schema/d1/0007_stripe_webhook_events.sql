-- Native Cloudflare Stripe event ledger. Additive only; legacy application
-- and application_events tables are intentionally not touched.
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_created INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing','processed','failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS stripe_webhook_events_status_idx
  ON stripe_webhook_events(status, updated_at);
