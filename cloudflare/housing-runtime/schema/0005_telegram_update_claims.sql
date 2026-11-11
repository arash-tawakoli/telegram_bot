CREATE TABLE IF NOT EXISTS housing.telegram_updates (
  update_id bigint PRIMARY KEY,
  payload_hash text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  received_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error text
);

CREATE INDEX IF NOT EXISTS housing_telegram_updates_status_idx ON housing.telegram_updates (status, received_at);

GRANT SELECT, INSERT, UPDATE ON housing.telegram_updates TO cf_housing_runtime_20261103;
ALTER TABLE housing.telegram_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS housing_runtime_access ON housing.telegram_updates;
CREATE POLICY housing_runtime_access ON housing.telegram_updates FOR ALL TO cf_housing_runtime_20261103 USING (true) WITH CHECK (true);
REVOKE ALL ON housing.telegram_updates FROM anon, authenticated, PUBLIC;
