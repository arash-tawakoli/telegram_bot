ALTER TABLE applications ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE applications ADD COLUMN next_attempt_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00';
ALTER TABLE applications ADD COLUMN lease_until TEXT;
ALTER TABLE applications ADD COLUMN quota_local_date TEXT;
ALTER TABLE applications ADD COLUMN wait_reason TEXT;

CREATE TABLE IF NOT EXISTS application_queue_cutover (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO application_queue_cutover (id) VALUES (1);
CREATE INDEX IF NOT EXISTS applications_due_idx
  ON applications(status, next_attempt_at, lease_until);
