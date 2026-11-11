GRANT USAGE ON SCHEMA housing TO cf_housing_runtime_20261103;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA housing TO cf_housing_runtime_20261103;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA housing TO cf_housing_runtime_20261103;

ALTER DEFAULT PRIVILEGES IN SCHEMA housing
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cf_housing_runtime_20261103;
ALTER DEFAULT PRIVILEGES IN SCHEMA housing
  GRANT USAGE, SELECT ON SEQUENCES TO cf_housing_runtime_20261103;

DO $policies$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'housing' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE housing.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS housing_runtime_access ON housing.%I', table_name);
    EXECUTE format('CREATE POLICY housing_runtime_access ON housing.%I FOR ALL TO cf_housing_runtime_20261103 USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END;
$policies$;

REVOKE ALL ON SCHEMA housing FROM anon, authenticated, PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA housing FROM anon, authenticated, PUBLIC;
