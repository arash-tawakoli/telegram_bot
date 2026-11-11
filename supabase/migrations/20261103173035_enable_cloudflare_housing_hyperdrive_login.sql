SET lock_timeout = '2s';
SET statement_timeout = '30s';

DO $provision_hyperdrive$
DECLARE
  runtime_password text := encode(gen_random_bytes(32), 'hex');
BEGIN
  PERFORM vault.create_secret(
    runtime_password,
    'cloudflare_hyperdrive_role_password',
    'Dedicated password for the least-privilege Cloudflare Housing Hyperdrive login. Not readable by the Worker.',
    NULL
  );

  EXECUTE format(
    'ALTER ROLE cf_housing_runtime_20261103 LOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 5 PASSWORD %L',
    runtime_password
  );

  EXECUTE format(
    'COMMENT ON ROLE cf_housing_runtime_20261103 IS %L',
    'Cloudflare Housing Hyperdrive login; NOINHERIT, NOBYPASSRLS, no service_role membership, connection limit 5. Password managed in Supabase Vault.'
  );
END
$provision_hyperdrive$;

RESET lock_timeout;
RESET statement_timeout;
