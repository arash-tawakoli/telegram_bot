# Runtime recovery runbook — 2026-10-21

## Snapshot inventory

The snapshot is intentionally split into small, auditable files:

- `database-catalog.json`: 101 table definitions and column metadata, constraints, indexes, RLS flags, policies, triggers, views, sequences, enums, extensions.
- `routines-01.json` … `routines-05.json`: all 249 custom routine definitions with signatures, owners, security-definer flags, volatility, configuration and ACL metadata.
- `security-storage-cron.json`: 12 cron definitions, four Storage bucket definitions, Storage policy state, table/routine grants, and role flags.
- `cloudflare-bindings.json`: current settings and non-secret bindings for both Cloudflare Workers.
- `bundles/batch-01.json` … `batch-23.json`: source contents and runtime metadata for all 114 live Supabase Edge Functions.
- `function-security-audit.json`: static auth-signal triage for every Edge Function.
- `migration-history-and-drift.json`: all 328 applied migration versions and the repository drift ledger.
- `provider-contract-snapshot.json`: live connector state for ImmoScout24, Kleinanzeigen, Immowelt and WG-Gesucht.

## What CI verifies

`scripts/check-runtime.mjs` verifies the repository-managed bundles and migration registry. It now also validates all 114 archived function records against their recorded slug, version, JWT setting, artifact hash, file count, and secret-scan status.

`scripts/check-live-runtime.mjs` queries the Supabase Management API and compares live slugs, versions and `verify_jwt` settings with the manifest. Configure the GitHub Actions secret `SUPABASE_ACCESS_TOKEN` to activate this comparison. If the secret is absent, the check emits a warning and skips the live request.

## Restore procedure

1. Create an isolated Supabase project or branch and obtain cost approval if Supabase quotes a nonzero cost.
2. Reconcile the eight live-only historical migrations listed in `MIGRATION-RECONCILIATION.md`. Do not substitute empty or guessed migration files.
3. Create platform-managed schemas/extensions first; do not manually recreate Supabase-managed `auth`, `storage`, `realtime` internals from the catalog JSON.
4. Rebuild custom schemas and tables from the catalog, then apply constraints/indexes, custom routines, RLS policies, triggers, views and grants in dependency order.
5. Restore cron definitions only after required routines and Edge Functions exist. Keep jobs 29 and 30 disabled, keep SAGA disabled, and do not requeue the dead-letter queue during restore.
6. Deploy only approved runtime functions from the source archive. Diagnostic/canary candidates must pass dependency and authorization review before being re-enabled.
7. Reapply non-secret Cloudflare bindings from `cloudflare-bindings.json`; provision secret values separately through the appropriate secret manager.
8. Run provider contract tests, queue/delivery/token/RLS smoke tests, 104-neighborhood coverage tests, portal responsive tests at 320/390/768/1024/1440px, and then perform a clean-room restore validation.
9. Compare the restored runtime manifest and schema against the snapshot. Record any deviations before calling the restore complete.


## Smoke checks completed on the live project

- The Telegram link-token issuance function successfully issued a token for an eligible test candidate inside a transaction that was rolled back; the token value was not retained or exposed.
- The bootstrap-token validity check rejected a non-existent token. Bootstrap issuance remains correctly blocked while an active admin already exists.
- All four internal tables checked have RLS enabled, an explicit client-deny policy, and no SELECT privileges for `anon` or `authenticated`.
- The job-application index `job_applications_search_profile_id_idx` exists. The latest performance advisor no longer reports the missing-index warning.
- The persisted `listings.neighborhood_id` matches the canonical normalizer for all **32,751** listings checked; mismatches: **0**.
- The one-job retry canary was retried once and failed again with a timeout. The source circuit breaker then excluded that source from further automatic retries; the current dry-run preview has no eligible retry candidates.
- The provider contract tests are being added to CI. The last run exposed two test-fixture/assertion defects and a stale test path after migration filename reconciliation; those tests were corrected and are rerunning.

## Additional live hardening — 2026-10-22

- Eight source transport/feed endpoints (`covivio-feed`, `immobilie1-transport`, `immobilien-de-transport`, `meravis-feed`, `noncoop-feed`, `noncoop-new-feed`, `spacest-feed`, `vonovia-transport`) now require Supabase JWT gateway verification for direct HTTP access.
- The source-worker uses `provider-fetch.ts` to dispatch these handlers in-process for the same project origin. The latest crawl evidence shows successful in-process results for Spacest, HousingAnywhere and Ohne-Makler; further scheduled runs will verify the remaining connectors.
- Fifteen retired endpoints remain non-success stubs and now require JWT verification.
- The runtime manifest, source archive metadata, inventory indexes and security audit were refreshed to record these versions and classifications.
- `tests/runtime-security-classification.test.mjs` asserts the gateway settings and in-process routing contract.

## Security hardening applied

The following retired/test-only endpoints now require JWT verification at the Supabase gateway: `auth-admin-repair`, `deploy-merge-test`, `html-render-test`, `immomio-introspection-probe`, `immomio-probe`, `immomio-tenant-inspect`, `ka-gateway-egress-probe`, `kleinanzeigen-direct-login-probe`, `kleinanzeigen-mobile-canary`, `kleinanzeigen-refresh-probe`, `mini-app`, `mini-app-publisher`, `platform-connect`, `telegram-webhook-region-switch`, and `wunder-probe`. The deployment-test endpoint was replaced by an HTTP 410 response. These changes do not reactivate retired functionality.


## Acceptance evidence refreshed — 2026-10-22

- Live Edge Functions: **114**. Runtime manifest parity: **114/114** on slug, version, JWT setting and artifact hash.
- Direct HTTP access to the eight source transport/feed endpoints is now gated by Supabase JWT verification. The source-worker's `provider-fetch.ts` dispatches same-project connector handlers in-process, so scheduled crawling does not rely on public HTTP access.
- A post-deployment crawl for **Immobilien.de Hamburg** completed successfully (`fetched=1`, `inserted=1`). Other sources remain subject to their normal polling intervals; the change does not alter crawl cadence.
- The latest live normalization check covered **32,761** listings: **16,739** had canonical neighborhood IDs, **16,022** remained unmapped, and **0** mapped IDs disagreed with the canonical normalizer. Unmapped values were not force-assigned.
- The targeted ImmoScout neighborhood evidence contains all seven required rows. Two have observed results; five are recorded as no reliable listings found in that search, not as proof that no listings exist.
- Dead-letter retry dry-run selected **0** jobs. The current queue snapshot shows **154 dead**, **21 enqueued**, and **0 processing**. No bulk requeue was performed.
- The latest Performance Advisor does not report the missing `job_applications.search_profile_id` index. Unused-index warnings remain and have not been acted on.

## Remaining actions requiring external authorization

1. Add a scoped Supabase Management API token as the GitHub Actions secret `SUPABASE_ACCESS_TOKEN` (auth-config read/write and project-admin permissions), then run `.github/workflows/enable-auth-password-protection.yml`. The workflow verifies `password_hibp_enabled=true` without printing the auth configuration.
2. Run the new GitHub Actions workflow `.github/workflows/runtime-restore-smoke.yml`, which replays all migrations from an empty local Supabase database and validates the runtime registry. This does not create a billable Supabase branch. Only if local emulation cannot validate a platform-specific object should a cloud branch be considered; its quoted compute rate is US$0.01344/hour and requires explicit approval.
3. For final browser-level verification of Manager Preview, dialog focus return, contrast and the production dashboard at 200% zoom, use the new Playwright acceptance workflow in the website repository. It uses mocked API responses and does not mutate production participant data.

## Known blockers

- Eight historical migration SQL bodies are absent from Git. The current schema/routine snapshots are recovery artifacts, not proof that those original migrations can be replayed exactly.
- The live Supabase Auth setting for leaked-password protection remains disabled. The connected project/database tools cannot change that Auth dashboard setting; enable it in Supabase Auth settings or through an authorized Management API token, then rerun the Security Advisor.
- Fifteen retired/test-only endpoints were hardened to require JWT verification, and the temporary deployment-test endpoint now returns HTTP 410. The remaining `verify_jwt=false` functions are listed in the static audit; any further changes require dependency-aware review because the static scan is a triage heuristic, not proof of authorization.
- Seven targeted neighborhood records are `ambiguous`. They show that a reliable neighborhood-level result count was not obtained, not that the neighborhoods have no listings.
- No clean-room restore has yet been performed. This runbook must remain marked incomplete until an isolated restore test succeeds.
