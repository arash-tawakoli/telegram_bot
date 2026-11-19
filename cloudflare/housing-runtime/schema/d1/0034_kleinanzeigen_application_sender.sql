-- Extend the existing AutoApply queue to Kleinanzeigen, retaining all historical
-- application and event rows. D1 cannot alter a CHECK constraint in place.
PRAGMA defer_foreign_keys = true;

CREATE TABLE application_events_ka_saved AS
  SELECT * FROM application_events;
DELETE FROM application_events;
CREATE TABLE applications_ka_saved AS
  SELECT * FROM applications;
DROP TABLE applications;

CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  offer_identity_id TEXT REFERENCES offer_identities(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('immoscout24','immowelt','immomio','kleinanzeigen')),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','processing','sent','failed','manual_required')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  listing_expired_at TEXT,
  test_mode INTEGER NOT NULL DEFAULT 0,
  submission_started_at TEXT,
  sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00',
  lease_until TEXT,
  quota_local_date TEXT,
  wait_reason TEXT
);
INSERT INTO applications (
  id,participant_id,offer_identity_id,provider,idempotency_key,status,last_error,
  created_at,updated_at,listing_expired_at,test_mode,submission_started_at,sent_at,
  attempts,next_attempt_at,lease_until,quota_local_date,wait_reason
)
SELECT
  id,participant_id,offer_identity_id,provider,idempotency_key,status,last_error,
  created_at,updated_at,listing_expired_at,test_mode,submission_started_at,sent_at,
  attempts,next_attempt_at,lease_until,quota_local_date,wait_reason
FROM applications_ka_saved;
DROP TABLE applications_ka_saved;

INSERT INTO application_events (
  id,application_id,provider,event_type,status,attempt,reason,document_result,metadata,created_at
)
SELECT id,application_id,provider,event_type,status,attempt,reason,document_result,metadata,created_at
FROM application_events_ka_saved;
DROP TABLE application_events_ka_saved;

CREATE INDEX applications_participant_idx ON applications(participant_id,created_at);
CREATE INDEX applications_test_mode_daily_idx
  ON applications(participant_id,test_mode,submission_started_at);
CREATE INDEX applications_test_mode_queue_idx
  ON applications(test_mode,status,created_at);
CREATE INDEX applications_due_idx
  ON applications(status,next_attempt_at,lease_until);
CREATE INDEX applications_retention_idx
  ON applications(julianday(CASE WHEN substr(created_at,-3)='+00'
    THEN substr(created_at,1,length(created_at)-3)||'Z' ELSE created_at END),id)
  WHERE status <> 'processing';

PRAGMA defer_foreign_keys = false;
