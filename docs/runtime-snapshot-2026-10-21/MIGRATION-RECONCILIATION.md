# Migration reconciliation — 2026-10-21

- Live migrations: **328**
- Repository SQL migration files after filename reconciliation: **320**
- Live versions without a repository migration file: **8**
- Repository migration files whose version is absent from live history: **0**

## Remaining live-only versions

- `20261002162748` — `repair_application_queue_reconciliation`
- `20261002170417` — `platform_session_reauth_notifications`
- `20261002181908` — `user_engagement_campaigns`
- `20261002213748` — `add_wg_gesucht_platform_login`
- `20261007115124` — `revoke_public_execute_on_internal_rpcs`
- `20261007115302` — `add_missing_fk_indexes`
- `20261019222908` — `allow_admin_participant_assignment`
- `20261019224939` — `add_jobseeker_workspace`

## Completed reconciliation

The three repository files with timestamps that differed from live migration history were aligned to the applied live versions, preserving their SQL content and hashes:

- `coach_super_admin_role`: 20261014121529
- `add_job_applications_search_profile_index`: 20261020193533
- `add_hamburg_alias_neighborhood_index`: 20261020193641

## Recovery status

The current schema catalog, custom routine definitions, grants, RLS policies, triggers, views, enums, extensions, storage metadata, cron definitions, Cloudflare bindings, and 114 Edge Function bundles are archived in this directory.

The eight historical SQL migrations above were applied in the live project but their original source files could not be recovered from Git. I have not fabricated migration bodies based only on their names. The live snapshot improves recovery capability, but a clean-room restore remains blocked until the eight migrations are semantically reconciled and an isolated restore test passes.
