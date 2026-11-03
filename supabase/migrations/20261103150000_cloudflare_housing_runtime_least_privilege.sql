SET lock_timeout = '2s';
SET statement_timeout = '30s';

DO $role$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'cf_housing_runtime_20261103'
  ) THEN
    CREATE ROLE cf_housing_runtime_20261103
      NOLOGIN
      NOBYPASSRLS
      INHERIT
      CONNECTION LIMIT 5;
  END IF;
END
$role$;

ALTER ROLE cf_housing_runtime_20261103
  NOLOGIN
  NOBYPASSRLS
  CONNECTION LIMIT 5;

REVOKE service_role FROM cf_housing_runtime_20261103;
GRANT CONNECT ON DATABASE postgres TO cf_housing_runtime_20261103;
GRANT USAGE ON SCHEMA app_private TO cf_housing_runtime_20261103;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  app_private.immoscout_central_credentials,
  app_private.immoscout_central_oauth_flows,
  app_private.immoscout_central_audit_events
TO cf_housing_runtime_20261103;

GRANT USAGE, SELECT ON SEQUENCE
  app_private.immoscout_central_audit_events_id_seq
TO cf_housing_runtime_20261103;

DROP POLICY IF EXISTS cf_housing_runtime_access
  ON app_private.immoscout_central_credentials;
CREATE POLICY cf_housing_runtime_access
  ON app_private.immoscout_central_credentials
  FOR ALL TO cf_housing_runtime_20261103
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cf_housing_runtime_access
  ON app_private.immoscout_central_oauth_flows;
CREATE POLICY cf_housing_runtime_access
  ON app_private.immoscout_central_oauth_flows
  FOR ALL TO cf_housing_runtime_20261103
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cf_housing_runtime_access
  ON app_private.immoscout_central_audit_events;
CREATE POLICY cf_housing_runtime_access
  ON app_private.immoscout_central_audit_events
  FOR ALL TO cf_housing_runtime_20261103
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION app_private.get_housing_runtime_secret(secret_name text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = secret_name
    AND secret_name IN (
      'immoscout_central_cloudflare_api_secret',
      'application_credential_key_v1'
    )
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION app_private.get_housing_runtime_secret(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.get_housing_runtime_secret(text)
  TO cf_housing_runtime_20261103;

GRANT EXECUTE ON FUNCTION app_private.delete_expired_listings(integer)
  TO cf_housing_runtime_20261103;

COMMENT ON ROLE cf_housing_runtime_20261103 IS
  'Cloudflare housing runtime: NOLOGIN until Hyperdrive credentials are provisioned; NOBYPASSRLS; no service_role membership; access limited to central ImmoScout token storage, two allow-listed Vault secrets, and bounded listing retention.';

COMMENT ON FUNCTION app_private.get_housing_runtime_secret(text) IS
  'Returns only the two Vault secrets required by the Cloudflare housing runtime. It does not expose the general get_bot_secret interface.';

RESET lock_timeout;
RESET statement_timeout;
