ALTER ROLE cf_housing_runtime_20261103
  NOLOGIN
  NOBYPASSRLS
  PASSWORD NULL;

COMMENT ON ROLE cf_housing_runtime_20261103 IS
  'Reserved for the Cloudflare housing Worker. Login is disabled until a least-privilege database connection is provisioned and verified.';
