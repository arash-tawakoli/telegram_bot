# WG-Gesucht authentication bridge runtime source

This directory mirrors the exact production bundle for `wg-gesucht-auth-bridge` (Supabase version 3, observed 2026-11-02).

The deployed bundle includes its own `functions/application-worker/credentials.ts` copy. It differs from the current `application-worker/credentials.ts` used by the main application worker, so it is intentionally kept isolated under `supabase/deployed-support/wg-gesucht-auth-bridge/functions/` rather than overwriting the shared production source.

The entrypoint is `functions/wg-gesucht-auth-bridge/index.ts`. Preserve the relative folder layout when packaging this source for a future deployment.
