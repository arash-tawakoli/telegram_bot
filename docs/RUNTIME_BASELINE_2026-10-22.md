# Runtime-Baseline 2026-10-22

## Status

**Scope:** Phase 0 (read-only release baseline and source reconciliation) for the planned Schleswig-Holstein location expansion.

**Production impact:** None. No database migration was applied, no Edge Function was deployed, and no production listing or search-profile data was changed.

## Database and runtime inventory

- Live database migration history: **328** applied migrations.
- Repository migration files: **328**.
- The read-only version comparison found no applied migration missing from the repository and no repository migration missing from the live migration history.
- Live Supabase Edge Functions: **114**.
- Runtime manifest: **47 managed functions** plus **67 archived-only functions**, totaling **114**.
- Latest read-only comparison: no version mismatches among the 47 managed functions.
- Listings remain Hamburg-only in the inspected live dataset; no Schleswig-Holstein search was enabled as part of Phase 0.

## Runtime source reconciliation

The following live source snapshots were refreshed into `docs/runtime-snapshot-2026-10-22/bundles/batch-03.json` and tracked in `supabase/runtime-manifest.json`:

| Function | Live version |
|---|---:|
| `application-worker` | 199 |
| `auth-facade-broker` | 22 |
| `telegram-oauth-bridge` | 38 |
| `telegram-ui` | 242 |
| `source-worker` | 108 |
| `immomio-account` | 21 |

The same reconciliation synced current live source into the repository for the application worker's provider and credential modules, the authentication facade, Telegram OAuth bridge, Telegram navigation, source-worker Immomio adapters, and Immomio account modules.

## Explicitly captured per-function source divergence

The shared file `supabase/functions/_shared/application-profile-adapters.ts` is bundled at different revisions in different deployed functions:

- Current repository source and `application-worker` use blob `9f6aea09a6b7f443db284cfe6d20ebc550edc037`.
- The archived deployed bundles for `coach-api`, `kleinanzeigen-application-worker`, and `telegram-ui` contain the older blob `45e5c9eeea4e5d2ab161d1ea0072f815f58417cc`.

Both versions are retained accurately in the manifest: `git_blob_sha` records the current repository source, while `deployed_git_blob_sha` records the exact per-function archived source. No deployment was triggered to force these independently deployed functions onto the same shared-module revision.

## Validation performed

- Checked live migration versions against repository migration files.
- Compared the live Edge Function inventory with the runtime manifest.
- Captured current live source for the six functions listed above.
- Checked archived bundle metadata (version, JWT setting, artifact hash, file count, full-source status).
- Checked archive file paths and SHA-256 deployment hashes for the archived files using the updated path-normalization rules.
- Added regression tests for archived source/deployment divergence and deployed-support archive paths.
- Added tests for the live `[[Vorname]]` application-message substitution.

## Remaining blocker

The latest GitHub Actions jobs are being marked failed within a few seconds, with `runner_id = 0`, an empty runner name, no executed steps, and no retrievable job logs. The same behavior occurred for both `pull_request` and a temporary branch-specific `push` trigger, so it is not limited to PR events. Switching temporarily from `ubuntu-latest` to `ubuntu-22.04` did not change the result, so the workflow was restored to its original runner label and trigger. GitHub Status recorded an October 22 incident affecting Actions and related repository services, subsequently marked resolved; however, the current branch still fails to obtain a runner. The remaining cause is not exposed by the available run metadata and cannot be fixed safely by changing application source. Repository/account Actions policy, runner provisioning, or usage limits need to be inspected in GitHub's account/repository settings. This prevents a reliable claim that the **current** branch passed the complete CI suite. A previous run passed 371 existing tests but failed at the strict runtime gate before the baseline reconciliation; that result does not certify the current branch.

**Phase 0 is therefore not declared fully complete until the current branch's test and runtime-verification workflow runs successfully.** The data and source reconciliation is prepared in the open pull request; it has not been merged and production remains unchanged.

## Next action

Resolve or retry the GitHub Actions runner/startup issue, then require all of the following to pass on the current pull-request head:

1. Full `npm test` suite, including the new regression tests.
2. Strict `scripts/check-runtime.mjs` validation.
3. Live runtime inventory comparison, when `SUPABASE_ACCESS_TOKEN` is available to the workflow.
4. Migration registry and content integrity checks.

Only after those checks pass should Phase 0 be signed off and Phase 1 (official Schleswig-Holstein geography import dry-run) begin.
