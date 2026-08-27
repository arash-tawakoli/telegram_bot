# Migration reconciliation

## Status

Older repository migrations predate the current production migration registry and use bootstrap-style filenames. They remain as historical setup material and are not rewritten retroactively in this change.

From production migration `20260827170557_strict_immomio_tenant_connectors.sql` onward, production migration versions are mirrored in GitHub using the exact Supabase migration version prefix.

## Rule going forward

1. Create every schema change as a Supabase migration.
2. Commit the exact production migration version and SQL to GitHub.
3. Keep Edge Function runtime code in GitHub aligned with the deployed production version.
4. Do not rename or renumber source IDs.
5. Do not blindly replay pre-v2 bootstrap files against an existing production database.
6. Verify migration drift before every production deployment.

## Architecture v2 baseline

Architecture v2 starts at:

- `20260827174953_architecture_v2_core.sql`
- `20260827175119_architecture_v2_source_queue.sql`
- `20260827175348_architecture_v2_observability_and_availability.sql`

All later architecture migrations use exact production version prefixes and are the canonical migration trail for the v2 runtime.
