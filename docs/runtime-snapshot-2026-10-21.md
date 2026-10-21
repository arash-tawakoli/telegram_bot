# Runtime snapshot — 21.10.2026

**Generated:** 2026-10-21T19:54:20.498Z  
**Runtime authority:** Supabase project `dpmohkrwdlicexwcrqfy`  
**Repositories:** `e3167eea497d` (telegram_bot), `0eb5134187c2` (website_traumwohnung)

## Current inventory

- Live migrations: **322**
- Migration files across both repositories: **316**
- Live Edge Functions: **114**
- Runtime-manifest entries: **47**
- Live functions missing from the manifest: **67**
- Live functions without a source path in either repository: **67**
- Functions with `verify_jwt=false`: **99**
- Registered sources: **68**, enabled/live: **55**
- Active listings: **25952**
- Listings without district: **9355**
- Listings with noncanonical raw district values: **5050**
- Dead source jobs: **155**; latest 50 are classified in the JSON snapshot.

## Implemented in this pass

- Source health RPC includes rolling crawl error rates, last error, last successful outcome, per-source delivery statuses and a classified dead-letter sample.
- A private `app_private.source_neighborhood_coverage` table and service-role-only recording RPC were added. No synthetic coverage records were inserted.
- `public.listings.neighborhood_id` was added and backfilled only through `normalize_hamburg_neighborhood`; raw `district` values remain unchanged.
- Two unambiguous aliases, `Neugraben` and `Fischbek`, map to canonical `Neugraben-Fischbek`.
- Post-migration verification: **32728 listings**, **16722 normalized neighborhood IDs**, **0 mismatches**.
- Coach Portal source health UI was merged and deployed successfully; verification and deployment workflows both passed.

## Remaining recovery and verification gaps

1. **Function source export:** the snapshot contains metadata and artifact hashes, not the source contents of all 114 live functions. 67 live functions do not have a matching source directory in either repository; 67 are absent from the runtime manifest. Their code must be exported and reviewed before a complete rollback claim.
2. **Migration drift:** 11 live migration versions are absent from repository migration files; 5 repository migration versions are not in the live migration history. See `migrations.liveOnly` and `migrations.repositoryOnly` in the JSON file.
3. **Neighborhood search evidence:** current listing presence is not proof that a source searched a neighborhood. The evidence table is ready, but source adapters still need to record explicit per-neighborhood search attempts and result counts.
4. **Retry behavior:** dead-letter errors are classified and retry candidates are marked, but no bulk requeue was run. A queue-contract canary is still required before automated retries.
5. **Security configuration:** leaked-password protection was reported disabled by the previous Auth Advisor audit. The available connector does not expose the Auth dashboard setting, so it was not changed here.
6. **Edge Function retirement:** diagnostic candidates are classified by name/runtime metadata in the JSON, but no live function was disabled without dependency and authorization review.
7. **Restore test:** no restore was run. This is a live metadata/health snapshot, not yet a complete deployable source-and-schema archive.

## Safety decisions

- SAGA remains disabled.
- Cronjobs 29 and 30 remain disabled.
- No dead jobs were requeued.
- No source configuration, provider credentials, participants, applications, or delivery events were modified by the portal changes.
