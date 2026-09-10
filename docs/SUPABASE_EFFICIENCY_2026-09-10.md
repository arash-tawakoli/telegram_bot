# Supabase efficiency audit — 2026-09-10

Project: `dpmohkrwdlicexwcrqfy` · repository: `arash-tawakoli/telegram_bot`

## Outcome

Deployed changes reduce repeated enrichment, ingestion round trips, idle Edge calls, scheduler transactions and unbounded operational-log growth. The source catalogue, live crawl cadence, freshness gates, matching, deduplication, Telegram leases, billing and application workflows were preserved. This is a measured optimization pass, not a claim that every resource is now mathematically minimal.

## Scope actually checked

| Area | Evidence and result |
| --- | --- |
| Database/workload | Table sizes and update/HOT-update counters; WAL and statement counters; listing indexes; trigger/function definitions; queue claims; maintenance routines. |
| Runtime | 24 deployed bundles inventoried. Changed bundles read back and matched byte-for-byte; newer application/UI/gateway/fast-path code recovered into GitHub without redeploying an older version. |
| Scheduling | All 11 original cron jobs reviewed; 10 remain. Source/delivery readiness includes retry and expired-lease paths. |
| Sources | All 65 configurations reviewed through live status/queue evidence; all 51 live sources completed two full post-cutover cycles (102 successful jobs). The 14 shadow/disabled sources were not promoted. Successful crawling is not proof of complete external inventory. |
| Telegram | Lease, pacing, availability, unknown-outcome, single-photo and source-fact regression tests; normal live retry/delivery evidence. No artificial listing was sent to users. |
| Security | Table/RPC grants, RLS, security/performance advisors, existing custom Edge authentication. 49 private routines deny client execution and retain service execution. |
| Storage | Two buckets and their object counts/sizes: one public bot asset (67,048 bytes), one private application document (359,228 bytes). No document/image deletion or unnecessary storage redesign. |
| Billing/applications | Existing code, grants, private storage and conditional application scheduler inspected and preserved. No payment, browser-login or real application-submission test was performed. |
| Operations | Migration registry, deployment manifest, regression tests, bounded retention and rollback path. No provider-scale load test or full disaster-recovery exercise. |

## Findings and changes

| Priority | Confirmed observation | Implemented change | Trade-off / risk control |
| --- | --- | --- | --- |
| High | About 4.51 million listing updates against about 20,700 retained listings. The dominant upsert accumulated 15.83 GB WAL; project WAL 34.62 GB since 2026-08-20. These are cumulative, not daily figures. | Service-only `ingest_listing_batch`: at most 100 rows, source-scoped transaction lock, explicit allowed fields, duplicate/source checks, atomic fresh counts. Unchanged normalized input updates only `last_seen_at`; changed/new input retains existing triggers. | A nullable 32-byte fingerprint is added. External source-field writes invalidate it. Rule changes must explicitly invalidate affected fingerprints. Real observations still cause timestamp writes and index maintenance. |
| High | Each ingestion did a separate existing-key read and then blind upserts. | Removed the pre-read; one RPC per 100 listings. | For 100 listings: two HTTP DB requests become one; for 300: four become three. Request-count reduction is structural, not a measured end-to-end latency percentage. |
| High | Worker/dispatcher Edge functions were invoked every minute even without actionable work. | Combined enqueue + conditional worker start; removed the separate worker cron. Dispatcher invoked only for due events or expired processing leases, after the existing freshness preparation. | Minute-level recovery and existing five-minute source eligibility are unchanged. No source priority or filter was relaxed. |
| Medium | Shadow diagnostics ran 288 times/day independently of live crawling. | Hourly at minute 12: 24 scheduled invocations/day, 264 fewer (91.7%). | Diagnostic detection may be up to an hour later; live search/crawling is unchanged. A scheduled post-change probe returned HTTP 200 with 50 probes. |
| Medium | Dispatcher read all subscriptions for every nonempty batch. | Restrict subscription query to unique profile owners in that batch (at most 200). | Same premium/expiry logic. Scaling benefit is expected; current small subscription table was not a measured bottleneck. |
| Medium | Cron execution history had no retention: ~140,000 rows / 81 MB allocated. | Added success=7 days / failure=30 days retention to existing daily maintenance, bounded to 20,000 rows/run. Deleted 77,466 expired success logs in four bounded transactions. | No business data deleted. Allocated relation size did not immediately shrink; ordinary vacuum/reuse, not a blocking VACUUM FULL, is intended. Deleted logs require a suitable retained backup to recover. |
| Medium | Internal source-job grants were broader than needed; private helper functions inherited client execute grants; provider-index queue lacked RLS. | Revoke source-job client grants, enable private-queue RLS, revoke private routine execution from public/client roles and explicitly retain service access. | Existing routines verified: 49 total, 0 client-executable, 0 missing service grants. Private schema remains inaccessible to clients. |
| High (deployment safety) | Supabase had newer application functionality and two migrations missing from GitHub. | Reconciled that existing live code/history and the runtime manifest alongside these optimizations. | No rollback of the user's newer features. Dispatcher optimization was applied to live version 76, not the older repository version. |

## Measurements

Rollback-backed `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)` replays on real existing listings. Three samples per source, before/after paired in sequence. The optimized path is measured after warming its fingerprint; this represents repeated unchanged input, not initial ingestion. All transactions were rolled back. SQL replays still generate WAL, even though their data effects are rolled back.

| Sample | Median old SQL | Median fast path | Median buffer hits: old → new |
| --- | ---: | ---: | ---: |
| Spacest, 99 listings | 152.917 ms | 98.049 ms | 5,600 → 5,493 |
| ImmoScout24, 100 listings | 185.250 ms | 102.824 ms | 9,845 → 5,420 |

These bounded samples show ~36% and ~44% lower median execution time. The first Scout sample was much slower (cold/cache/runtime noise); raw plans are retained in [efficiency-metrics-2026-09-10.json](efficiency-metrics-2026-09-10.json). They do not establish a project-wide CPU or cost reduction.

**WAL-byte reduction is not established.** Median bytes were 357,122 → 370,633 for Spacest and 386,650 → 454,222 for Scout. Full-page-image counts varied between runs. WAL record counts fell in the Scout samples, but the byte results do not justify a savings claim. The CPU/request improvements are deployed with this explicit limitation. No durability setting, critical queue logging or replication safety was weakened.

Scheduled cron transactions fall from 10,658/day to 8,954/day by configuration (one redundant minute timer and fewer shadow probes). Actual billed Edge savings depend on pending work; they are not reported as a measured daily total.

## Verification

- All 139 behavior, regression and least-privilege tests passed together (9.24 seconds locally, concurrency 2).
- Six scheduling tests cover empty queues, visible retries, hidden/live leases, expired leases, future retries, exhausted attempts, unknown delivery outcomes, freshness preparation, and history retention.
- Nine ingestion tests cover first-seen stability, no old-inventory promotion, source isolation, invalid batches, atomic failure, changed data, reactivation and external-writer invalidation.
- Live rollback assertions: unchanged heartbeat preserves all other listing facts; changed rows take normal processing; new rows count once; baseline fixture creates no delivery; mixed-source input is rejected.
- Normal live operation: two full 51-source cycles completed after cutover; a worker response claimed 51 jobs. Two ordinary deliveries first reported retryable failure, then a subsequent dispatcher response reported two sent. No exactly-once or zero-transient-error claim.
- Cron SQL executions observed after cutover succeeded. Three pg_net peer/transport errors were also observed; 73 of the same error existed before cutover. Request attribution was unavailable after the provider request IDs changed, so their precise cause is not asserted.
- Security advisor: no WARN/ERROR findings; service-only tables intentionally have RLS without user policies. Performance advisor's seven unused-index notices concern FK-support indexes; they were retained rather than removed from short-lived usage statistics.
- `node scripts/check-runtime.mjs`: 24 bundles and 156 migrations verified.

The full-suite harness initially lacked the newly deployed `quickApplyButton` import. Tests now use the real shared helper; runtime functionality was not removed to satisfy old fixtures.

## Operational rules and remaining limits

- The new RPC is service-only, accepts only normalized connector fields and never treats a fingerprint as evidence of availability. Do not bypass normal ingestion for changed data.
- PostgreSQL per-schema default REVOKE cannot remove globally granted defaults. New helper functions still need explicit role grants/revocations; the migration's per-schema default statement is not relied upon as a future-function protection. See [PostgreSQL default privilege semantics](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html).
- Intentional service-only RLS notices: [Supabase linter explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Index notices alone do not establish redundancy: [index notice](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
- Existing source-coverage/availability limitations remain in the source audit. No artificial promotion of Tauschwohnung or shadow sources.
- The two retired HTTP-410 Mini App endpoints remain deployed compatibility tombstones. The available management interface has no Edge-function deletion operation; they have no active bot routing/schedule. No credential extraction or bypass was attempted.
- No sustained before/after WAL-rate, billed cost, maximum concurrency or large-user load test. No guarantee that external listings remain available after the check.
- No change to paid entitlements, Stripe signatures/idempotency, unknown Telegram outcome handling, one-image preview, source-exact addresses or unknown-field suppression.

## Deployment / rollback

Applied migrations:

1. `20260910095851_ingestion_fingerprint_fast_path.sql`
2. `20260910100251_work_aware_scheduling_and_log_retention.sql`
3. `20260910100818_backend_internal_least_privilege.sql`

Runtime: source-worker **64**, source-shadow **8**, notification-dispatcher **77**. Other newer live application/UI bundles were preserved, not redeployed by this optimization.

Rollback narrowly: restore source-worker 63 and source-shadow 7 if ingestion needs reverting; the additive fingerprint column/RPC may safely remain until their callers are gone. Restore only the subscription query from dispatcher 76, not the older pre-application dispatcher. Restore the exact prior cron commands from the saved audit evidence if scheduling rollback is needed. Do not reverse RLS/least-privilege improvements casually. Retention deletion is not undone by a code rollback.
