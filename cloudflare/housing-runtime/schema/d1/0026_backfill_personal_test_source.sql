-- Restore the Scout source selection for accounts already in the legacy
-- personal test mode. New test controls use per-source application preferences.
UPDATE application_preferences
SET immoscout_enabled = 1,
    enabled = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE participant_id IN (
  SELECT id
  FROM participants
  WHERE telegram_user_id = 8538226539
    AND test_auto_apply_allowed = 1
    AND test_auto_apply_enabled = 1
    AND auto_apply_enabled = 0
)
  AND immoscout_enabled = 0
  AND immowelt_enabled = 0
  AND immomio_enabled = 0;