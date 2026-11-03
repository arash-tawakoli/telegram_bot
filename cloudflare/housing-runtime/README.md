# Traumwohnung Housing Runtime

A single Cloudflare Worker is the target execution runtime for the housing product.

## Current scope

- PostgreSQL readiness through Cloudflare Hyperdrive.
- Bounded listing-retention execution.
- A one-minute Cron Trigger that calls `app_private.delete_expired_listings(1000)`.
- No job-search, Indeed, coach analytics, D1 listing store, or duplicate backend.

## Database contract

The Worker uses the existing Supabase PostgreSQL database through Hyperdrive. Supabase remains the database host only; application execution moves to Cloudflare.

The dedicated database role is:

`cf_housing_runtime_20261103`

It is a login role with a five-connection limit, RLS bypass for the existing service-role data model, and membership in the existing `service_role`. Its password must be set by the project owner and entered directly into the Cloudflare Hyperdrive configuration. Do not commit or paste the password into GitHub.

Create a Hyperdrive configuration named `traumwohnung-postgres` with:

- Origin: `db.dpmohkrwdlicexwcrqfy.supabase.co:5432`
- Database: `postgres`
- User: `cf_housing_runtime_20261103`
- TLS: required
- Caching: disabled
- Origin connection limit: 5

After creating the Hyperdrive configuration, add its ID to `wrangler.jsonc`:

```jsonc
"hyperdrive": [
  {
    "binding": "HYPERDRIVE",
    "id": "YOUR_HYPERDRIVE_ID"
  }
]
```

The Worker is intentionally not attached to a production route and must not be deployed as a production backend until the Hyperdrive binding is configured and the PostgreSQL migration has passed its release gate.

## Verification

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run check
npm test
```

## Retention

The SQL function deletes in bounded batches when `first_seen_at` reaches 23 hours 59 minutes. The one-minute safety margin is intended to ensure physical deletion no later than 24 hours. Application history is detached from the listing and retains a compact listing snapshot.
