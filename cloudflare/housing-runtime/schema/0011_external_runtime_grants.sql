REVOKE ALL ON SCHEMA housing FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA housing FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA housing FROM PUBLIC;

DO $policies$
DECLARE
  table_name text;
  role_name text := current_user;
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA housing TO %I', role_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA housing TO %I', role_name);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA housing TO %I', role_name);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA housing GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', role_name);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA housing GRANT USAGE, SELECT ON SEQUENCES TO %I', role_name);
  FOR table_name IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'housing' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE housing.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS housing_runtime_access ON housing.%I', table_name);
    EXECUTE format('CREATE POLICY housing_runtime_access ON housing.%I FOR ALL TO %I USING (true) WITH CHECK (true)', table_name, role_name);
  END LOOP;
END;
$policies$;
