-- Preserve delivery idempotency, but retire unprocessable and shadow-only queued work.
UPDATE applications
SET offer_identity_id = NULL,
    listing_expired_at = COALESCE(listing_expired_at, CURRENT_TIMESTAMP),
    status = CASE WHEN status IN ('pending','processing') THEN 'failed' ELSE status END,
    last_error = CASE WHEN status IN ('pending','processing') THEN 'shadow_source_retired' ELSE last_error END,
    updated_at = CURRENT_TIMESTAMP
WHERE offer_identity_id IN (SELECT id FROM offer_identities WHERE source_id IN (30,32,36,39,71));

UPDATE deliveries
SET offer_identity_id = NULL,
    listing_expired_at = COALESCE(listing_expired_at, CURRENT_TIMESTAMP),
    status = CASE WHEN status IN ('pending','processing') THEN 'skipped' ELSE status END,
    error_message = CASE WHEN status IN ('pending','processing') THEN 'shadow_source_retired' ELSE error_message END
WHERE offer_identity_id IN (SELECT id FROM offer_identities WHERE source_id IN (30,32,36,39,71));

DELETE FROM offer_identities WHERE source_id IN (30,32,36,39,71);
UPDATE source_registry SET enabled = 0 WHERE id IN (30,32,36,39,71);

UPDATE deliveries
SET status = 'skipped', error_message = 'stale_delivery_backlog'
WHERE status = 'pending' AND error_message IS NOT 'cutover_waiting'
  AND julianday(CASE WHEN substr(created_at,-3)='+00' THEN substr(created_at,1,length(created_at)-3)||'Z' ELSE created_at END)
    <= julianday('now','-15 minutes');

DROP TABLE IF EXISTS scout_shadow_offers;
DROP TABLE IF EXISTS scout_shadow_scans;

CREATE INDEX IF NOT EXISTS deliveries_pending_fresh_idx
  ON deliveries(created_at,id)
  WHERE status='pending' AND error_message IS NOT 'cutover_waiting';
CREATE INDEX IF NOT EXISTS deliveries_pending_cutover_idx
  ON deliveries(created_at,id)
  WHERE status='pending' AND error_message='cutover_waiting';
CREATE INDEX IF NOT EXISTS offer_identities_expiry_idx
  ON offer_identities(expires_at,id)
  WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS applications_retention_idx
  ON applications(julianday(CASE WHEN substr(created_at,-3)='+00' THEN substr(created_at,1,length(created_at)-3)||'Z' ELSE created_at END),id)
  WHERE status <> 'processing';
CREATE INDEX IF NOT EXISTS application_events_retention_idx
  ON application_events(julianday(CASE WHEN substr(created_at,-3)='+00' THEN substr(created_at,1,length(created_at)-3)||'Z' ELSE created_at END),id);
