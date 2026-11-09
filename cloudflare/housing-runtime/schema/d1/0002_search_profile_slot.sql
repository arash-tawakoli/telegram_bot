-- Add the physical profile slot used by Telegram's D1 adapter.
-- Preserve every existing slot value stored in criteria; rows without a valid
-- slot retain the backward-compatible default of 1.
ALTER TABLE search_profiles
ADD COLUMN profile_slot INTEGER NOT NULL DEFAULT 1
CHECK (profile_slot BETWEEN 1 AND 4);

UPDATE search_profiles
SET profile_slot = CASE
  WHEN json_valid(criteria) THEN
    CASE
      WHEN json_type(criteria, '$.profile_slot') IN ('integer', 'real')
        AND CAST(json_extract(criteria, '$.profile_slot') AS INTEGER) BETWEEN 1 AND 4
      THEN CAST(json_extract(criteria, '$.profile_slot') AS INTEGER)
      ELSE 1
    END
  ELSE 1
END;

CREATE UNIQUE INDEX IF NOT EXISTS search_profiles_participant_slot_unique
ON search_profiles(participant_id, profile_slot);
