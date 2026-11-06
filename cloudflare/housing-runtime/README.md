# Traumwohnung Housing Runtime

One Cloudflare Worker is the target execution runtime for the housing product.

## Current scope

- PostgreSQL access through Cloudflare Hyperdrive.
- Bounded listing retention. Listings are deleted from PostgreSQL; listing payloads are never exported to D1, KV, R2, or another store.
- A one-minute Cron Trigger calls `app_private.delete_expired_listings(5000)`.
- Central ImmoScout token and OAuth/MFA handling, with encrypted credentials in the temporary Cloudflare D1 binding.
- No job-search, Indeed, coach analytics, D1 listing store, or duplicate backend.
- A temporary `LEGACY_D1` binding reads only the three central ImmoScout tables for the one-time migration. The Worker verifies the AES-GCM ciphertext with the Vault key before importing it transactionally. Remove this binding after the import is verified.

The cutover allowlist is explicit in `src/source-allowlist.js` and contains only ImmoScout24, Immowelt, and verified Immomio Tenant sources. The target schema in `schema/0001_housing_core.sql` stores offer identity and idempotency keys instead of complete listing payloads. The durable `(participant, offer)` delivery key and `(participant, provider, offer)` application key prevent duplicate notifications and applications after a source re-publishes an offer.

The Cloudflare ingress exposes `/telegram/webhook`, validates `TELEGRAM_WEBHOOK_SECRET`, and handles the housing Telegram flow directly against the target schema. Premium, referral and non-housing menus are intentionally outside this runtime.

## Database contract

The target is an external PostgreSQL host. Cloudflare runs the housing application code and connects through Hyperdrive; Supabase is only the legacy export source until cutover.

The dedicated database role is:

`cf_housing_runtime_20261103`

Security properties:

- `NOLOGIN` until the final Hyperdrive credential is provisioned.
- `NOBYPASSRLS` and no membership in `service_role`.
- Public execution is revoked for existing and future functions in `app_private`; the runtime receives execute rights only for its two explicitly granted functions.
- Access only to the `housing` schema on the target host.
- Central ImmoScout secrets are Worker secrets; central OAuth state remains in the temporary D1 binding.

The migration `20261103150000_cloudflare_housing_runtime_least_privilege.sql` creates these scoped grants and RLS policies. Do not grant this role `service_role`, `BYPASSRLS`, or access to `public.get_bot_secret(text)`.

## Hyperdrive

Create or update the Hyperdrive configuration named `traumwohnung-housing-postgres` using the dedicated role and the external PostgreSQL endpoint:

- Host: provided external PostgreSQL host
- Port: `5432`
- Database: `postgres`
- User: `cf_housing_runtime_20261103`
- TLS: `sslmode=require`
- Origin connection limit: `5`
- Query caching: disabled

Use the direct connection, not the Supavisor pooler. Hyperdrive performs the connection pooling for Workers; Cloudflare's Supabase integration guide recommends the direct endpoint.

After creating the configuration, add its ID to `wrangler.jsonc`:

```jsonc
"hyperdrive": [
  {
    "binding": "HYPERDRIVE",
    "id": "YOUR_HYPERDRIVE_ID"
  }
]
```

## Required secrets

Configure these as Worker secrets before a production route is enabled:

- `TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_BOT_TOKEN` for webhook validation and delivery.
- `INTERNAL_WORKER_SECRET` for the temporary provider bridge calls.
- `SOURCE_RUN_TOKEN` and `DELIVERY_RUN_TOKEN` for scheduled source/delivery invocations.
- `RETENTION_TOKEN` for bounded cleanup.
- `CENTRAL_API_SECRET` and `CENTRAL_TOKEN_ENCRYPTION_KEY` for the temporary D1-backed ImmoScout OAuth flow.

Values never belong in `wrangler.jsonc`, Git or the public portal bundle.

The Worker must not be attached to a production route or used as the production backend until the database binding, least-privilege grants, health check, and end-to-end tests pass.

## Cost guardrails

- One Cron Trigger runs every minute: at most 43,200 scheduled invocations in a 30-day month.
- The Worker CPU limit is capped at 500 ms per invocation. At that cap, scheduled execution uses at most 21.6 million CPU milliseconds per 30-day month, below the Workers Paid included allowance of 30 million CPU milliseconds.
- Scheduled invocations are well below the 10 million monthly included Worker request allowance.
- No R2, KV, Queues, Durable Objects, Browser Rendering, or other paid add-on is used by this runtime.
- Hyperdrive is included in the Workers Paid plan. Do not add a second Hyperdrive configuration or a second Cron Worker.
- Cloudflare Billing Read access is not available to this connection; verify account usage in the dashboard before any additional Worker or trigger is added.

## Retention

The SQL function deletes listings in bounded batches once `first_seen_at` reaches 23 hours 50 minutes. The ten-minute margin protects against Cron scheduling jitter and batch backlog. Application, delivery, and saved-item history keep only non-listing status metadata and have their listing references detached.

No listing snapshot is retained. A legacy export queue was found in production and disabled; its historical HTTP delivery could not be conclusively verified, so do not treat the empty current D1 database as proof that no payload was ever received by a now-absent endpoint.

## Verification

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run check
npm test
```

## Migration status

This Worker currently owns the target schema, Auth/session boundary, Coach API foundation, R2 document contract, source allowlist, three source adapters, matching and the Telegram delivery boundary.

Still running on Supabase Edge Functions and not yet ported here:
- Telegram Gateway/UI internals and update persistence.
- Auto-application orchestration and provider workers.
- External PostgreSQL export/import and final Hyperdrive cutover.

Do not switch provider adapters, AutoApply schedules, portal APIs, or domains until each replacement is implemented and smoke-tested. Hyperdrive remains on the legacy host until the external connection string is supplied and the imported target is verified.
