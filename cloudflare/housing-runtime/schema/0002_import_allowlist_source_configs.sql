-- One-time bridge while Supabase PostgreSQL is still the legacy host.
-- Copy only the approved primary connector configuration; no historical source is imported.
INSERT INTO housing.source_registry (id, name, family, connector, connector_config, enabled, last_success_at, consecutive_failures)
SELECT
  s.id,
  s.name,
  CASE
    WHEN s.id IN (1, 69) THEN 'immoscout24'
    WHEN s.id IN (3, 71) THEN 'immowelt'
    ELSE 'immomio'
  END,
  CASE
    WHEN c.connector_kind = 'immomio_tenant' THEN 'immomio_tenant'
    WHEN s.id IN (1, 69) THEN 'mcp'
    WHEN s.id IN (3, 71) THEN 'html_discovery'
    ELSE c.connector_kind
  END,
  COALESCE(c.config, '{}'::jsonb),
  s.enabled,
  s.last_success_at,
  s.consecutive_failures
FROM public.sources s
JOIN public.source_connectors c ON c.source_id = s.id
WHERE s.id IN (1, 3, 23, 29, 34, 35, 66, 69, 71)
  AND c.connector_role = 'primary'
  AND c.enabled = true
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  family = EXCLUDED.family,
  connector = EXCLUDED.connector,
  connector_config = EXCLUDED.connector_config,
  enabled = EXCLUDED.enabled,
  last_success_at = EXCLUDED.last_success_at,
  consecutive_failures = EXCLUDED.consecutive_failures;
