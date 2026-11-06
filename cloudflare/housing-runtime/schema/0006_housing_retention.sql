ALTER TABLE housing.deliveries
  ADD COLUMN IF NOT EXISTS listing_expired_at timestamptz;

ALTER TABLE housing.applications
  ADD COLUMN IF NOT EXISTS listing_expired_at timestamptz;

ALTER TABLE housing.deliveries
  ALTER COLUMN offer_identity_id DROP NOT NULL;

ALTER TABLE housing.applications
  ALTER COLUMN offer_identity_id DROP NOT NULL;

ALTER TABLE housing.deliveries
  DROP CONSTRAINT IF EXISTS deliveries_offer_identity_id_fkey;

ALTER TABLE housing.deliveries
  ADD CONSTRAINT deliveries_offer_identity_id_fkey
  FOREIGN KEY (offer_identity_id) REFERENCES housing.offer_identities(id) ON DELETE SET NULL;

ALTER TABLE housing.applications
  DROP CONSTRAINT IF EXISTS applications_offer_identity_id_fkey;

ALTER TABLE housing.applications
  ADD CONSTRAINT applications_offer_identity_id_fkey
  FOREIGN KEY (offer_identity_id) REFERENCES housing.offer_identities(id) ON DELETE SET NULL;
