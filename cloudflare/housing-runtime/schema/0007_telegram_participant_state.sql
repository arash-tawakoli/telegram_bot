ALTER TABLE housing.participants
  ADD COLUMN IF NOT EXISTS telegram_state jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS housing_participants_telegram_user_idx
  ON housing.participants (telegram_user_id) WHERE telegram_user_id IS NOT NULL;
