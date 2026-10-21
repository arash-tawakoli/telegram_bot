# Migration reconciliation — 2026-10-21

- Live migrations: **328**
- Repository SQL migration files: **328**
- Live versions without a repository migration file: **0**
- Repository migration files whose version is absent from live history: **0**

## Reconstructed historical migrations

The following eight versions were present in the live Supabase migration history but their original SQL source files were not recoverable from Git. Replayable equivalents were reconstructed from the current live catalog and registered in `docs/migration-registry.d/20261021-reconstructed-live-migrations.json`:

- `20261002162748` — `repair_application_queue_reconciliation`
- `20261002170417` — `platform_session_reauth_notifications`
- `20261002181908` — `user_engagement_campaigns`
- `20261002213748` — `add_wg_gesucht_platform_login`
- `20261007115124` — `revoke_public_execute_on_internal_rpcs`
- `20261007115302` — `add_missing_fk_indexes`
- `20261019222908` — `allow_admin_participant_assignment`
- `20261019224939` — `add_jobseeker_workspace`

These files are explicitly marked `RECONSTRUCTED EQUIVALENT`. They restore the observed schema, function, constraint, index, trigger, grants, and scheduled-job contracts, but they are not claimed to be byte-for-byte historical originals.

## Completed reconciliation

The three repository migration filenames that differed from the applied live versions were aligned while preserving their SQL content:

- `coach_super_admin_role`: 20261014121529
- `add_job_applications_search_profile_index`: 20261020193533
- `add_hamburg_alias_neighborhood_index`: 20261020193641

## Recovery status

The current schema catalog, custom routine definitions, grants, RLS policies, triggers, views, enums, extensions, Storage metadata, cron definitions, Cloudflare bindings, and all 114 Edge Function source bundles are archived in this directory.

**Migration-version parity is now complete.** A clean-room restore is gated by the `clean-room-restore` job in `.github/workflows/architecture-check.yml`. Exact restoreability is not certified until that isolated local restore job succeeds. The original eight migration bodies remain unavailable as historical source, although equivalent replayable SQL is now versioned.
