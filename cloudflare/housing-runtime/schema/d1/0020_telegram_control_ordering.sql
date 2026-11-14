ALTER TABLE telegram_updates ADD COLUMN telegram_user_id INTEGER;
ALTER TABLE telegram_updates ADD COLUMN callback_data TEXT;
CREATE INDEX telegram_updates_control_ordering_idx
  ON telegram_updates(telegram_user_id, callback_data, update_id)
  WHERE callback_data IS NOT NULL;
