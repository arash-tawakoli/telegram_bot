-- Existing users retain their established home language and skip first-run language onboarding.
ALTER TABLE participants ADD COLUMN language_selected_at TEXT;
UPDATE participants SET language_selected_at=CURRENT_TIMESTAMP
WHERE telegram_user_id IS NOT NULL AND language_selected_at IS NULL;

-- One-time 30-day welcome Premium, without modifying Stripe billing or shortening referrals.
ALTER TABLE participants ADD COLUMN welcome_premium_granted_at TEXT;
UPDATE participants
SET welcome_premium_granted_at=CURRENT_TIMESTAMP,
    referral_bonus_until=CASE
      WHEN julianday(referral_bonus_until)>julianday('now','+30 days') THEN referral_bonus_until
      ELSE strftime('%Y-%m-%dT%H:%M:%SZ','now','+30 days')
    END,
    updated_at=CURRENT_TIMESTAMP
WHERE telegram_user_id IS NOT NULL AND welcome_premium_granted_at IS NULL;

-- This is separate from the first name/last name celebration.
CREATE TABLE IF NOT EXISTS applicant_completion_prompts (
  participant_id TEXT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  prompted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
