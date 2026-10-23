# Schleswig-Holstein rollout runbook

## Scope and cost guardrail

This change uses the existing Supabase project, existing Edge Functions, existing Cloudflare Worker and the current GitHub repositories. It does not create a Supabase development branch, a new project, a new Cloudflare service, or any paid resource.

The feature branches are not production. The additive geography migration is already present in the existing production database and was verified read-only: 1,120 Schleswig-Holstein areas, two aliases, zero SH listings, and zero SH search profiles. The migration history currently contains two same-name records (20261023094810 and 20261023104210); both are represented by idempotent migration files in this branch. Do not re-run the SQL manually. Do not deploy application functions or merge the feature branches until the validation gates below pass.

## Required order

1. Confirm the existing production migration is registered and the catalog checks below pass. The repository contains both `supabase/migrations/20261023094810_add_schleswig_holstein_geography.sql` and `supabase/migrations/20261023104210_add_schleswig_holstein_geography.sql` to reflect the two recorded migration versions. Both are idempotent. Do not run them manually a third time. The WG-Gesucht Schleswig-Holstein connector remains disabled and shadow-only.
2. Verify the catalog before enabling any source:
   - `jsonb_array_length(public.get_schleswig_holstein_areas()) = 1120` (1 state + 15 counties/independent cities + 1,104 municipalities).
   - 1,104 unique eight-digit municipality AGS codes and 15 unique parent-region codes.
   - `Garstedt` resolves to Norderstedt, AGS `01060063`; it is a locality alias, not a municipality.
   - the existing Hamburg profile modes and existing Hamburg listing rows remain present.
3. Deploy the updated `source-worker` Edge Function from the feature branch. Its geography lookups use the restricted service RPCs; unresolved/ambiguous public listing locations are logged and skipped instead of being assigned to Hamburg.
4. Deploy the updated `telegram-ui` and `coach-api` Edge Functions from the same feature branch. They read the SH catalog through the service-only RPCs. Do not deploy either function before step 1 because those RPCs do not exist before the migration.
5. Verify that the live functions report the new versions and run read-only geography checks. Confirm that Hamburg profiles only match `HH` listings and that SH profiles only match `SH` listings.
6. Only after the new `source-worker` is live, enable the WG-Gesucht SH connector with the guarded SQL below. Do not enable it while the old worker is deployed.
7. Merge/deploy the Coach Portal change after the API is live. The existing GitHub workflow `.github/workflows/deploy-coach-portal-cloudflare.yml` builds and deploys the existing Cloudflare Worker `traumwohnung-coach-portal`; no new Cloudflare resource is required.
8. Validate real search coverage by source. Keep source coverage separate from auto-application support; WG-Gesucht is search-only in the current application router.

## WG-Gesucht connector activation (manual post-deploy step)

Run only after step 4 and after confirming the live `source-worker` contains the SH normalization code:

```sql
update public.source_connectors
set enabled = true,
    shadow_only = false,
    updated_at = now()
where source_id = 6
  and priority = 4
  and config->>'region_state_code' = 'SH'
  and config->>'url' = 'https://www.wg-gesucht.de/wohnungen-in-Schleswig-Holstein.0.2.1.0.html'
returning id, source_id, priority, enabled, shadow_only, config;
```

Expected result: exactly one row. If no row or more than one row is returned, stop and inspect the connector registry instead of broadening the update.

## Rollback

- Disable the WG-Gesucht SH connector first if its results are malformed.
- Do not roll back the geography migration blindly after listings have been ingested; that would remove the identifiers required to classify those listings.
- If an Edge Function regression appears, restore the previous function bundle while leaving the additive geography schema in place.
- Do not run a database reset or create a paid Supabase branch as a rollback shortcut.

## Current validation limitation

GitHub Actions has been failing before any test step executes. The PRs must remain drafts until the complete test suite, strict runtime check, and live inventory checks execute successfully. The additive database migration is already applied; no Edge Function has been deployed, no Schleswig-Holstein connector has been enabled, and the Coach Portal Cloudflare Worker has not been deployed with this feature.
