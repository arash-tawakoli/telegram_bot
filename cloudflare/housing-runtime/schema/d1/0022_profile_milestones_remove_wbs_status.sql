-- One-time Telegram celebrations; keep existing users from being celebrated again.
CREATE TABLE IF NOT EXISTS telegram_profile_milestones (
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  profile_type TEXT NOT NULL CHECK (profile_type IN ('search','applicant')),
  claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (participant_id,profile_type)
);

INSERT OR IGNORE INTO telegram_profile_milestones(participant_id,profile_type)
SELECT DISTINCT participant_id,'search' FROM search_profiles;

INSERT OR IGNORE INTO telegram_profile_milestones(participant_id,profile_type)
SELECT participant_id,'applicant'
FROM applicant_profiles
WHERE json_valid(profile)
  AND EXISTS (
    SELECT 1 FROM json_each(profile)
    WHERE json_each.key <> 'wbs_status'
      AND json_each.value IS NOT NULL
      AND length(trim(CAST(json_each.value AS TEXT))) > 0
  );

-- Remove the retired optional WBS status from existing D1 applicant profiles.
UPDATE applicant_profiles
SET profile=json_remove(profile,'$.wbs_status')
WHERE json_valid(profile) AND json_type(profile,'$.wbs_status') IS NOT NULL;
