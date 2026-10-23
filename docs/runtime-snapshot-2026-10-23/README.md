# Runtime and migration reconciliation — 2026-10-23

## Live Edge Function baseline

A read-only comparison of the live Supabase Edge Function inventory against `supabase/runtime-manifest.json` found nine managed functions whose recorded live version and/or artifact hash was stale. Their exact currently deployed source bundles have been archived and the manifest now records the current live version, artifact hash, per-file deployed Git blob hashes, archive path, and file count.

| Function | Live version | Files archived |
|---|---:|---:|
| `application-worker` | 199 | 11 |
| `billing-maintenance` | 129 | 1 |
| `coach-api` | 48 | 2 |
| `immomio-account` | 21 | 4 |
| `notification-dispatcher` | 230 | 9 |
| `source-worker` | 108 | 33 |
| `stripe-webhook` | 139 | 1 |
| `telegram-gateway` | 95 | 2 |
| `telegram-ui` | 242 | 9 |

Archive files:

- `bundles/batch-23.json`: application-worker, billing-maintenance, coach-api
- `bundles/batch-24.json`: immomio-account, notification-dispatcher, source-worker
- `bundles/batch-25.json`: stripe-webhook, telegram-gateway, telegram-ui

The live inventory contains 114 functions: 47 repository-managed and 67 archived-only. The new snapshot preserves deployed code separately from the current branch source, so source/deployment divergence is explicit rather than silently overwritten.

The live `application-worker` and `immomio-account` bundles both include `_shared/platform-refresh.ts`. That source file has been added to the repository and to both managed runtime bundles. The exact deployed file hashes remain recorded per function.

A scan for common hardcoded private-key, service-secret, API-token, JWT-literal, and Telegram-token patterns found no matches in these nine archived bundles. This is a targeted marker scan, not a claim that arbitrary source code can never contain sensitive data.

## Migration registry

- SQL migration files in the branch: 330.
- Base registry entries: 171.
- 37 registry fragments: 159 entries.
- Total registry entries: 330.
- The two Schleswig-Holstein migration records (`20261023094810` and `20261023104210`) match their filenames and both record the verified SHA-256 of the identical migration content: `65e528042af93cfac67e0984f63a36aa56bd3fca80cb44dc35c7c359ed8ba91d`.

The full strict registry check remains part of `scripts/check-runtime.mjs`; it validates filename/version agreement, duplicate versions and paths, file counts, and migration checksums.

## Validation status and safety

- The nine archived bundles were compared with their corresponding manifest entries: version, file count, artifact hash and per-file deployed Git blob hashes agree.
- The complete live inventory comparison now has no version/artifact mismatches across the 47 repository-managed functions.
- GitHub Actions still fails before assigning a runner, with `runner_id = 0` and no executed steps. Therefore the full CI suite and the strict runtime checker have **not** been executed successfully in GitHub Actions.
- This reconciliation did not deploy any Edge Function, alter Cloudflare, enable the WG-Gesucht connector, or make further database changes.
- No paid Supabase branches, projects, or other resources were created.

The feature pull request remains a draft until the full CI checks can execute successfully.
