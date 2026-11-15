-- Keep only cooperatives with a successful tenant.immomio.com application
-- endpoint and at least one delivered offer (verified 2026-11-15).
-- Keep: 23 Hamburger Wohnen, 29 VHW, 35 Walddörfer, 66 GEWOBA Nord.
-- Retire: 30 HARABAU, 32 EBV Harburg, 34 Bauverein Reiherstieg,
--         36 Fuhlsbüttel, 39 mgf Gartenstadt Farmsen.
--
-- Earlier migrations and source audits stay immutable for reproducibility.
-- Historical deliveries/applications must remain intact. Their foreign keys
-- prevent deleting an unexpected still-referenced offer identity.
-- If a new offer appears during cutover, preserve all source configuration
-- and profile links instead of partly deleting its references.
DELETE FROM source_links
WHERE source_id IN (30,32,34,36,39)
  AND NOT EXISTS (
    SELECT 1 FROM offer_identities WHERE source_id IN (30,32,34,36,39)
  );
DELETE FROM source_registry
WHERE id IN (30,32,34,36,39)
  AND NOT EXISTS (
    SELECT 1 FROM offer_identities WHERE source_id IN (30,32,34,36,39)
  );
