ALTER TABLE participants ADD COLUMN language_code TEXT;
ALTER TABLE participants ADD COLUMN last_start_at TEXT;
ALTER TABLE participants ADD COLUMN engagement_notifications_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE participants ADD COLUMN test_auto_apply_updated_by_telegram_id INTEGER;

UPDATE participants
SET language_code = (SELECT json_extract(payload_json, '$.language_code') FROM supabase_archive_rows WHERE schema_name='public' AND table_name='bot_users' AND row_key=json_array(participants.id)),
    last_start_at = (SELECT json_extract(payload_json, '$.last_start_at') FROM supabase_archive_rows WHERE schema_name='public' AND table_name='bot_users' AND row_key=json_array(participants.id)),
    engagement_notifications_enabled = COALESCE((SELECT json_extract(payload_json, '$.engagement_notifications_enabled') FROM supabase_archive_rows WHERE schema_name='public' AND table_name='bot_users' AND row_key=json_array(participants.id)), 1),
    test_auto_apply_updated_by_telegram_id = (SELECT json_extract(payload_json, '$.test_auto_apply_updated_by_telegram_id') FROM supabase_archive_rows WHERE schema_name='public' AND table_name='bot_users' AND row_key=json_array(participants.id))
WHERE EXISTS (SELECT 1 FROM supabase_archive_rows WHERE schema_name='public' AND table_name='bot_users' AND row_key=json_array(participants.id));
