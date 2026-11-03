REVOKE service_role FROM cf_housing_runtime_20261103;

COMMENT ON ROLE cf_housing_runtime_20261103 IS
  'Reserved for the Cloudflare housing Worker. NOLOGIN, NOBYPASSRLS, and no service_role membership until least-privilege grants and Hyperdrive are configured.';
