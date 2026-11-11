DELETE FROM housing.deliveries
WHERE offer_identity_id IN (SELECT id FROM housing.offer_identities WHERE source_id = 37);

DELETE FROM housing.applications
WHERE offer_identity_id IN (SELECT id FROM housing.offer_identities WHERE source_id = 37);

DELETE FROM housing.source_links WHERE source_id = 37;
DELETE FROM housing.offer_identities WHERE source_id = 37;
DELETE FROM housing.source_registry WHERE id = 37;
