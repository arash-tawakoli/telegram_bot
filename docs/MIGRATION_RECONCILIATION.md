# Migration reconciliation

## Observed on 2026-09-05

Before this PR, GitHub contained 125 migration files and production recorded 139 migration entries. 62 repository version prefixes had no identical version in the production registry. Matching names suggest that some changes were deployed under different timestamps; this is not proof of 62 unapplied schema changes.

The previous assertion that every migration after the v2 baseline mirrored the exact production version is not supported by the current registry.

## Required procedure

1. Compare both registries by version, name and actual SQL content.
2. Identify genuinely missing changes separately from timestamp differences.
3. Reconcile each entry with evidence. Do not blindly replay old bootstrap migrations or bulk-mark versions as applied.
4. Test the new lifecycle migration against an isolated Supabase environment with real PGMQ.
5. Apply the new additive migration before deploying the source worker that calls `finish_source_job_attempt`.
6. Drain old dispatcher invocations before enabling the dispatcher with delivery reservations.
7. Check advisors and operational queries after rollout. Keep source IDs and tier classifications stable.

The migration in this PR was created with `supabase migration new`. It has not been applied to production. PGlite tests validate the SQL using a minimal PGMQ interface fixture, not a full Supabase integration.

See [the review](ARCHITECTURE_REVIEW_2026-09-05.md) for findings, current limits and rollback notes.
