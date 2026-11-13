ALTER TABLE participants ADD COLUMN last_activity_at TEXT;

UPDATE participants
SET last_activity_at = (
  SELECT MAX(json_extract(payload_json, '$.created_at'))
  FROM supabase_archive_rows
  WHERE schema_name='public'
    AND table_name='bot_events'
    AND CAST(json_extract(payload_json, '$.telegram_user_id') AS TEXT)=CAST(participants.telegram_user_id AS TEXT)
)
WHERE telegram_user_id IS NOT NULL;

CREATE UNIQUE INDEX user_engagement_participant_campaign_idx
  ON user_engagement_notifications(participant_id,campaign_key);
