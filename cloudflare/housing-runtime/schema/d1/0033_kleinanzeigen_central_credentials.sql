-- Kleinanzeigen: permit encrypted operator credentials in the existing provider vault.
-- No applications or application_events tables are touched.
CREATE TABLE provider_connections_kleinanzeigen (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('immoscout24','immowelt','immomio','kleinanzeigen')),
  status TEXT NOT NULL CHECK (status IN ('pending','connected','needs_login','error','disconnected')),
  ciphertext TEXT,
  iv TEXT,
  key_version INTEGER,
  expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  account_hint TEXT,
  UNIQUE (participant_id,provider)
);

INSERT INTO provider_connections_kleinanzeigen
  (id,participant_id,provider,status,ciphertext,iv,key_version,expires_at,updated_at,account_hint)
SELECT id,participant_id,provider,status,ciphertext,iv,key_version,expires_at,updated_at,account_hint
FROM provider_connections;

DROP TABLE provider_connections;
ALTER TABLE provider_connections_kleinanzeigen RENAME TO provider_connections;
