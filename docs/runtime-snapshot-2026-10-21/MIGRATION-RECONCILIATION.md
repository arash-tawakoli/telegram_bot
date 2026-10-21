# Migration reconciliation — 2026-10-21

Generated from the live Supabase migration history and the repository tree.

- Live migrations: **328**
- SQL files in `supabase/migrations`: **314**
- Live versions without a same-version repository file: **17**
- Repository migration files whose version is absent from live history: **3**

## Live-only versions

- `20261002162748` — `repair_application_queue_reconciliation`
- `20261002170417` — `platform_session_reauth_notifications`
- `20261002181908` — `user_engagement_campaigns`
- `20261002213748` — `add_wg_gesucht_platform_login`
- `20261007115124` — `revoke_public_execute_on_internal_rpcs`
- `20261007115302` — `add_missing_fk_indexes`
- `20261014121529` — `coach_super_admin_role`
- `20261019222908` — `allow_admin_participant_assignment`
- `20261019224939` — `add_jobseeker_workspace`
- `20261020193533` — `add_job_applications_search_profile_index`
- `20261020193641` — `add_hamburg_alias_neighborhood_index`
- `20261021200809` — `optimize_source_health_neighborhood_join`
- `20261021201029` — `bounded_transient_source_job_retries`
- `20261021201306` — `tighten_retry_eligibility_and_public_coverage_rpc`
- `20261021201616` — `preserve_strong_neighborhood_evidence`
- `20261021201704` — `guard_source_retry_with_circuit_breaker`
- `20261021201818` — `schedule_bounded_source_job_retries`

## Repository-only versions

- `20261014090000` — `coach_super_admin_role` (`supabase/migrations/20261014090000_coach_super_admin_role.sql`)
- `20261020193600` — `add_job_applications_search_profile_index` (`supabase/migrations/20261020193600_add_job_applications_search_profile_index.sql`)
- `20261020193700` — `add_hamburg_alias_neighborhood_index` (`supabase/migrations/20261020193700_add_hamburg_alias_neighborhood_index.sql`)

## Safety decision

This report does not create fake migration SQL or mark unrecovered migrations as reproducible. Current table/constraint/index/policy/trigger/view/enum/extension metadata, all custom routine definitions, grants, storage bucket metadata, cron definitions, and Edge Function source bundles are exported alongside this ledger. A clean-room restore is still blocked until the missing original migration semantics are reconciled and an isolated restore test succeeds.
