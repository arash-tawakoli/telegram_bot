# Backend efficiency audit - 19 September 2026

Project: `dpmohkrwdlicexwcrqfy` / `telegram_bot`.

## Deployment status

Two database migrations are applied and verified in production:

- `20260919150847_avoid_redundant_ingest_locks_and_dedupe_writes`
- `20260919152426_retain_compact_performance_snapshots_and_crawl_counters`

Production remains on source-worker v72 and notification-dispatcher v108. The separate crawl-budget change is tested but **not deployed**. No lower provider-request or billed-CPU figure is claimed for that change.

## Audit coverage and protections

Reviewed database/table sizes, update statistics, expensive SQL, WAL counters, queues, retention, scheduler, delivery triggers, active source coverage state, worker code, migration drift, RLS/privileged RPC exposure, replication slots, storage and billing backlog. All 65 source records are included in the new counters. This is not a claim that every diagnostic Edge endpoint or every external provider received a live end-to-end test.

Preserved source availability, 24-hour newness policy, profile matching, deduplication winner selection, per-recipient idempotency, unresolved-send protection and Stripe/user data. No manual listing broadcasts or applications were started. No source was disabled and no polling frequency was reduced. No VACUUM FULL, stats reset or aggressive deletion was performed.

## Live improvements

### 1. No-op ingestion and deduplication

Removed the unconditional SELECT FOR UPDATE over every existing ingest row. The per-source transaction advisory lock remains. Real UPDATE and INSERT ON CONFLICT operations retain normal PostgreSQL row locking. The heartbeat update rechecks the current active state and fingerprint, so concurrent deactivation or source-data changes are not overwritten by an old classification.

Dedupe winner selection is unchanged. Listing primary/duplicate flags and the preferred-listing row are only written when their values actually change. This does not fix or modify the previously observed same-building matching semantics.

A controlled, rolled-back fixture test performed 50 identical ingest calls:

| Metric | Before | After |
|---|---:|---:|
| Shared buffer hits | 857 | 657 |
| WAL records | 1 | 0 |
| WAL bytes | 54 | 0 |
| Execution time | 43.791 ms | 37.305 ms |

These are a single small no-op microbenchmark, not whole-system CPU/WAL savings. Repeated locks within one transaction produce less WAL than separate production transactions, so this test must not be extrapolated into a daily GB estimate.

Production rollback checks passed: insert, unchanged repeat, heartbeat, changed payload, reactivation, immutable first_seen_at and absence of test delivery events. Fixture rows remaining: zero.

### 2. Comparable performance evidence without per-crawl log growth

Added cumulative crawl counters to the source row already being updated: attempts, failures, candidates, inserted rows and elapsed milliseconds. These counters include outcomes omitted by compact routine crawl logging. They start at 2026-09-19 15:24:26 UTC; earlier values are not reconstructed or fabricated.

A private, RLS-enabled performance snapshot is captured once per four-hour bucket by the existing maintenance job, with a 35-day retention. There is no additional cron or Edge invocation. The first snapshot covered 65 sources and 39 application/queue/cron tables, about 25 KB of JSON text and 49 KB total initial relation allocation. The small bounded storage/write overhead buys a valid comparison basis.

Snapshots contain database/WAL reset epochs and cumulative counters, table sizes and source counters. They contain no user payloads, API keys or raw query text. anon/authenticated cannot access them. Elapsed crawler time is not CPU billing. Four-hour snapshots cannot detect every sub-minute resource spike.

For weekly reports, compare compatible reset epochs and source telemetry_since values. Rate-normalize windows when they differ. A first week without an earlier snapshot must be labelled baseline. Retained/sample-only crawl logs must not be presented as full seven-day success/failure populations.

Example read-only inspection:

```sql
select captured_at, metrics
from app_private.performance_snapshots
order by captured_at desc;
```

## Repository reconciliation

Ten migrations previously applied only in production on 18 September are exported exactly from the database migration registry, with matching SHA-256 hashes. The two new migrations are likewise included. Existing historical migrations are not rewritten. A version cross-check also found 14 older production versions absent from this repository and nine repository-only versions; these pre-existing history differences are not resolved by this audit and are not blindly replayed against production.

The repository source-worker caller was still on the old ingest RPC. Restored v72 RPC, presence-epoch, snapshot reconciliation and connector warm-state semantics to prevent a later deployment from regressing the already-live optimization. Version 72 is observed live; modified source-file deployment hashes are not asserted without byte-level measurement, so recorded hash drift remains explicit.

## Health checkpoint

At 2026-09-19 15:34:58 UTC:

- 100 completed final crawl results since counter activation; zero failures.
- Zero pending deliveries, stuck delivery leases, failed cron runs in the preceding hour, or unprocessed Stripe events.
- Database size 169,102,483 bytes, approximately 161.27 MiB.
- Existing unresolved delivery outcomes were not reset or resent.

Earlier advisor checks showed only existing INFO findings: seven unused indexes, fixed Auth connection allocation and private/backend RLS tables with no client policy. These are not reasons to open client access or drop integrity-related indexes.

## Tested but not deployed: crawl budget follow-up

Separate change: keep all ImmoScout fresh queries, reduce coverage partitions from four to one, avoid writing fresh IDs again as coverage, and account for two MCP handshake requests. Normal HTTP budget is 16 to 10 including the handshake (14 to 8 for query requests only); these are code-derived budgets, not observed billed savings.

Wunderflats: first page remains on every regular run; at most eight additional cursor pages rather than 32. Preserve cycle identity/start and last completion, build the href index once per page. A full catalogue sweep becomes slower. Because catalogue order is relevance-based, discovery on deeper pages can also become slower; do not promise zero recall/latency trade-off. Verify complete-cycle progress and absence of missed newly available listings before considering the rollout complete.

## Remaining limits

No new source-worker deployment was completed during this audit. Host CPU/RAM and actual billed Egress/Edge invocation timeseries are not available through the connected database tools. Existing diagnostic function cleanup and source-specific availability/parser issues need separate dependency evidence; no diagnostic functions were blindly deleted.
