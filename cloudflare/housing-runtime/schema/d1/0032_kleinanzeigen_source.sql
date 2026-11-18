-- Kleinanzeigen Hamburg as a live search source (public Kleinanzeigen MCP).
-- SQLite cannot widen a CHECK constraint, so source_registry is rebuilt.
-- It is dropped and recreated under the same name (no RENAME) so the
-- foreign keys of offer_identities, source_links and scout_coverage_jobs
-- keep pointing at it; re-inserting the rows settles the deferred checks.
PRAGMA defer_foreign_keys = true;

CREATE TABLE source_registry_backup AS SELECT * FROM source_registry;
-- Coverage jobs are seeded by 0030, so even a fresh database has children here.
-- Parking them keeps this file valid when it runs outside one transaction (tests).
CREATE TABLE scout_coverage_jobs_backup AS SELECT * FROM scout_coverage_jobs;
DELETE FROM scout_coverage_jobs;
DROP TABLE source_registry;
CREATE TABLE source_registry (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  family TEXT NOT NULL CHECK (family IN ('immoscout24','immowelt','immomio','kleinanzeigen')),
  connector TEXT NOT NULL,
  connector_config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_success_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);
INSERT INTO source_registry(id,name,family,connector,connector_config,enabled,last_success_at,consecutive_failures)
  SELECT id,name,family,connector,connector_config,enabled,last_success_at,consecutive_failures FROM source_registry_backup;
DROP TABLE source_registry_backup;
INSERT INTO scout_coverage_jobs SELECT * FROM scout_coverage_jobs_backup;
DROP TABLE scout_coverage_jobs_backup;

INSERT OR IGNORE INTO source_registry(id,name,family,connector,connector_config,enabled)
VALUES (2,'Kleinanzeigen Hamburg','kleinanzeigen','mcp',
  '{"url":"https://gateway.kleinanzeigen.de/openai-app/mcp","location":"Hamburg"}',1);

-- Every profile that already searches Immowelt Hamburg also gets Kleinanzeigen Hamburg.
-- Location matching still decides per listing (Kleinanzeigen ads are Hamburg-only).
INSERT OR IGNORE INTO source_links(search_profile_id,source_id)
  SELECT search_profile_id, 2 FROM source_links WHERE source_id = 3;

PRAGMA defer_foreign_keys = false;
