-- A durable once-per-participant marker for the native Telegram party effect.
-- Backfill existing profiles so historical users never receive a false "first profile" celebration.
CREATE TABLE IF NOT EXISTS profile_celebrations (
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('search','applicant')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(participant_id,kind)
);

INSERT OR IGNORE INTO profile_celebrations(participant_id,kind)
SELECT DISTINCT participant_id,'search' FROM search_profiles;

INSERT OR IGNORE INTO profile_celebrations(participant_id,kind)
SELECT participant_id,'applicant' FROM applicant_profiles;

-- WBS status is no longer collected: delete only this profile JSON key.
-- WBS-restricted offers will still require manual review rather than an unsafe application.
UPDATE applicant_profiles
SET profile=json_remove(profile,'$.wbs_status'),updated_at=CURRENT_TIMESTAMP
WHERE json_valid(profile) AND json_type(profile,'$.wbs_status') IS NOT NULL;
