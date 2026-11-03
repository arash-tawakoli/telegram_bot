# Traumwohnung Housing Runtime

One Cloudflare Worker is the target execution runtime for the housing product.

## Current scope

- PostgreSQL access through Cloudflare Hyperdrive.
- Bounded listing retention. Listings are deleted from PostgreSQL; listing payloads are never exported to D1, KV, R2, or another store.
- A one-minute Cron Trigger calls `app_private.delete_expired_listings(5000)`.
- Central ImmoScout token and OAuth/MFA handling, with encrypted credentials stored in PostgreSQL.
- No job-search, Indeed, coach analytics, D1 listing store, or duplicate backend.

## Database contract

Supabase remains the PostgreSQL host. Cloudflare runs the housing application code and connects through Hyperdrive.

The dedicated database role is:

`cf_housing_runtime_20261103`

Security properties:

- `NOLOGIN` until the final Hyperdrive credential is provisioned.
- `NOBYPASSRLS` and no membership in `service_role`.
- Public execution is revoked for existing and future functions in `app_private`; the runtime receives execute rights only for its two explicitly granted functions.
- Access only to the three central ImmoScout tables in `app_private`.
- Execute permission only for the bounded listing-retention function and the allow-listed runtime-secret function.
- No direct access to the Vault schema, Auth schema, or general application tables.

The migration `20261103150000_cloudflare_housing_runtime_least_privilege.sql` creates these scoped grants and RLS policies. Do not grant this role `service_role`, `BYPASSRLS`, or access to `public.get_bot_secret(text)`.

## Hyperdrive

Create a Hyperdrive configuration named `traumwohnung-postgres` using the dedicated role and the Supabase PostgreSQL endpoint. Use TLS and disable query caching. Keep the origin connection limit at five.

The Free Supabase project's direct database endpoint is IPv6-only. If Cloudflare cannot reach it, use Supavisor session mode (IPv4, port 5432) rather than enabling the paid IPv4 add-on. Obtain the exact session-pooler host from the Supabase project's Connect panel; do not guess the hostname.

After creating the configuration, add its ID to `wrangler.jsonc`:

```jsonc
"hyperdrive": [
  {
    "binding": "HYPERDRIVE",
    "id": "YOUR_HYPERDRIVE_ID"
  }
]
```

The Worker must not be attached to a production route or used as the production backend until the database binding, least-privilege grants, health check, and end-to-end tests pass.

## Retention

The SQL function deletes listings in bounded batches once `first_seen_at` reaches 23 hours 50 minutes. The ten-minute margin protects against Cron scheduling jitter and batch backlog. Application, delivery, and saved-item history keep only non-listing status metadata and have their listing references detached.

No listing snapshot is retained.

## Verification

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run check
npm test
```
