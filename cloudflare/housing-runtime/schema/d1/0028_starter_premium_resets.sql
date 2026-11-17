-- Each existing active Telegram user receives one banked 7-day Premium reset.
-- A reset remains unused while Premium is already active.
INSERT OR IGNORE INTO usage_reset_credits
  (id,participant_id,grant_key,granted_by_telegram_user_id)
SELECT lower(hex(randomblob(16))),p.id,'starter:7d',0
FROM participants p
WHERE p.status='active' AND p.telegram_user_id IS NOT NULL;
