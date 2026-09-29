update app_private.application_platforms
set verified_at = coalesce(verified_at, timestamptz '2026-09-27 20:49:03.507477+00')
where source_id = 3;
