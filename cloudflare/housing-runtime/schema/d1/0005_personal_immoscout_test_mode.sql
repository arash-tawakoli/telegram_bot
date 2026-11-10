-- Restore the isolated, owner-only ImmoScout24 test application path on Cloudflare D1.
-- The test mode is opt-in and never changes participant plugin credentials or the global switch.
ALTER TABLE applications ADD COLUMN test_mode INTEGER NOT NULL DEFAULT 0;
ALTER TABLE applications ADD COLUMN submission_started_at TEXT;
ALTER TABLE applications ADD COLUMN sent_at TEXT;

CREATE INDEX applications_test_mode_daily_idx
  ON applications(participant_id, test_mode, submission_started_at);
CREATE INDEX applications_test_mode_queue_idx
  ON applications(test_mode, status, created_at);

-- The only allowlisted test account is the NexaLabs owner. It remains disabled.
UPDATE participants
SET test_auto_apply_allowed = 1,
    test_auto_apply_enabled = 0,
    test_auto_apply_daily_limit = 1,
    test_auto_apply_enabled_at = NULL,
    test_auto_apply_disabled_at = NULL
WHERE telegram_user_id = 8538226539
  AND status = 'active'
  AND auto_apply_enabled = 0;
