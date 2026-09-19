# Verification checkpoint - 19 September 2026

## Applied production changes

Both migrations are present in Supabase project `dpmohkrwdlicexwcrqfy`:

- `20260919150847_avoid_redundant_ingest_locks_and_dedupe_writes`
- `20260919152426_retain_compact_performance_snapshots_and_crawl_counters`

The actual database optimizations are live. No new source-worker Edge deployment was completed. The tested crawl changes are isolated in draft PR #32, branch `audit/crawl-budget-20260919`, head `86af95b93c25cc298c5c0a62166e2ff922d8e3a8`. They must not be reported as active production savings.

## Tests and repository

The completed GitHub Actions audit job (run 35452929630, job 105923116377) verified the patch checksum, passed the main synchronization tests and migration checks, then separately passed the pending crawl rollout tests.

- Main synchronization: 181 tests passed.
- Pending crawl changes: 184 tests passed.
- Repository migration files: 204, all checked against their export hashes.
- Recorded runtime hash drift remains visible as warnings. Structural/test success is not proof that every Edge bundle matches production byte-for-byte.

Main synchronization commit: `c450580726e1bb9c8436f60473aff460d3f70054`. The temporary audit workflow was removed in `553d08c0ef74f75f78a2c7bd1e8156846f517dd9`.

Ten previously production-only migrations from 18 September and the two live changes above were exported exactly. A broader version cross-check still found 14 older production-only versions and nine repository-only versions. Those historical discrepancies were not blindly replayed or marked applied. They remain a deployment-reproducibility limitation.

## Production validation

In rolled-back tests, ingestion passed insert, unchanged repeat, heartbeat, changed data, reactivation, immutable first_seen and no test-delivery checks. No fixture rows remained.

A second dedupe refresh in each of 20 sampled groups produced no new physical member or group tuples, verified by comparing `ctid` before and after. The test was rolled back; it did not commit notifications or altered inventory.

The 50-call no-op microbenchmark changed from 857 to 657 shared buffer hits, 54 to zero WAL bytes, and 43.791 to 37.305 ms. These are controlled fixture measurements, not an instance-wide percentage saving or a billing prediction.

At 2026-09-19 15:48:09 UTC (17:48:09 Europe/Berlin):

| Check | Result |
|---|---:|
| Final crawl results since 15:24:26 UTC | 250 |
| Failed crawl results | 1 |
| Pending Telegram deliveries | 0 |
| Stuck processing deliveries | 0 |
| Unknown delivery outcomes retained | 20 |
| Failed cron runs in previous hour | 0 |
| Unprocessed Stripe events | 0 |
| Active cron jobs | 9 |
| Database bytes | 169102483 |
| Performance snapshot rows | 1 |
| Performance snapshot relation bytes | 49152 |

The one observed source failure was Wohnungsverein Hamburg von 1902. It subsequently reported success; consecutive_failures was zero and last_error_at null at the follow-up check. This is not attributed to the refactor without evidence.

## Advisors and privacy

Final security/performance advisor calls at 15:50 UTC returned no WARN or ERROR findings. INFO findings: 34 RLS-enabled tables without client policies (including the intentionally private new snapshot table), seven unused indexes, and fixed Auth allocation of ten connections. No client access was opened and no integrity-related index was dropped just to clear a notice.

Supabase remediation references:

- RLS without policy: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- Unused indexes: https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index
- Auth deployment guidance: https://supabase.com/docs/guides/deployment/going-into-prod

## Limits

The complete source-worker rollout, historical migration reconciliation, runtime hash reconciliation and dependency-proven diagnostic-function retirement are not complete. Actual host CPU/RAM, billed Egress and full Edge billing timeseries are not measured by these database checks. Four-hour snapshots are useful for trends but not a replacement for high-frequency platform spike monitoring. Existing billing, freshness, source polling, profile matching and unknown-send protections were not loosened.
