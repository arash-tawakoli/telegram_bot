-- Add legacy Telegram user metadata to the Cloudflare D1 participant table.
-- All fields are nullable or have safe defaults; existing participant rows remain intact.
ALTER TABLE participants ADD COLUMN username TEXT;
ALTER TABLE participants ADD COLUMN origin TEXT;
ALTER TABLE participants ADD COLUMN plan_override TEXT;
ALTER TABLE participants ADD COLUMN plan_override_expires_at TEXT;
ALTER TABLE participants ADD COLUMN referral_bonus_until TEXT;
ALTER TABLE participants ADD COLUMN auto_apply_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE participants ADD COLUMN test_auto_apply_allowed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE participants ADD COLUMN test_auto_apply_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE participants ADD COLUMN test_auto_apply_daily_limit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE participants ADD COLUMN test_auto_apply_enabled_at TEXT;
ALTER TABLE participants ADD COLUMN test_auto_apply_disabled_at TEXT;

UPDATE participants SET origin='telegram' WHERE origin IS NULL AND telegram_user_id IS NOT NULL;
