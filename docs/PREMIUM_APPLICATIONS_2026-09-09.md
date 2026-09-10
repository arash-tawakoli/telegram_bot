# Premium applicant dossier rollout

## Delivered

`/mappe` and Settings → Bewerbermappe open a private Telegram flow for applicant name, email, phone, occupation, income, household size and a custom application text. Premium users can state whether WBS, SCHUFA, rent clearance, a guarantee, income evidence and other documents are available. Statements and uploaded files are separate; neither claims the document has been validated.

PDF, JPEG and PNG uploads are limited to 5 MiB and 20 files per user. Supabase Storage is private, with backend-only access. Uploads start without forwarding permission. Every file can be downloaded, deleted or explicitly approved for future forwarding. After Premium expires, export, deletion and revocation remain available. Account deletion removes objects before deleting database pointers. No public or signed download URLs are sent to Telegram.

Premium quick applications use the saved name or custom text. Long templates are displayed as selectable text without exceeding Telegram's copy-button limit. Existing platform links and manual submission remain unchanged. Attachments are not automatically submitted yet.

The migration adds applicant fields to existing `bot_users`, document metadata, and application state with a unique user/listing key and an irreversible submission-start checkpoint. Database checks use the existing Premium and listing-freshness functions. Automation is disabled by default and the verified-platform registry is empty. This is a state foundation, not an operational submission worker.

## Not delivered; required next

Update 2026-09-10: Browserbase is connected through Vault and the session/queue implementation is deployed. See [the current implementation report](PLATFORM_APPLICATIONS_2026-09-10.md). Automatic submission and document forwarding are still not approved for production: authenticated platform send/upload tests remain outstanding. Gmail OAuth and aliases were not added: they cannot contact listings without recipient addresses.

To complete platform submission, sign in through the new personal platform connection flow and test the two contact forms with consenting test recipients. Do not mark a platform verified based on mocks. Do not retry after an ambiguous remote-send result. Security challenges require user interaction; a discovery connector does not grant messaging capability or remove those challenges.

## Scope reviewed and reused

- `supabase/functions/source-worker` and source transports: discovery, existing Scout/Klein adapters; unchanged.
- `supabase/functions/notification-dispatcher`: delivery and existing quick-apply link; only its shared message module bundle changed.
- `supabase/functions/telegram-ui`, `telegram-fast`, `telegram-gateway`: existing private user identity, onboarding state, Premium calculation and routing reused.
- Billing/Premium functions: existing entitlement rules retained; no new subscription logic.
- `supabase/migrations`, `supabase/config.toml`, runtime manifest: backend-only permissions, live freshness/matching functions, migration registry and deployment integrity checked.
- `supabase/deployed-support`: existing support bundles retained without changes.
- `tests` and fixtures: application behavior, ownership, persistence and regression coverage reused and extended.
- `scripts`, `.github/workflows`, package manifests and `docs`: existing checks and dependency setup retained; no new package dependency, service or cron process introduced.

## Safety and verification

- `node --test tests/dossier.test.mjs tests/dossier-database.test.mjs tests/application.test.mjs`: 21 passed, including private uploads, ownership, Premium lapse, eligibility and duplicate submission protection.
- `npm test`: 142 passed.
- `node /workspace/scratch/c75134c3ec7e/audit-tools/static.cjs`: TypeScript 5.9 analysis, 91 existing diagnostics, no new diagnostics. This external baseline comparison is not a clean project-wide type-check claim.
- `node scripts/check-runtime.mjs`: 23 function bundles and 152 migrations verified.
- `git diff --check`: passed.
- Supabase migration `20260909223100_premium_applications` applied successfully, then exported using the server-generated version.
- Deployed source read back and compared byte-for-byte: telegram-ui 74, telegram-fast 3, telegram-gateway 25, notification-dispatcher 76.
- Production metadata: private bucket; anonymous document access false; authenticated application/read and submit permissions false; zero opted-in users and zero verified platforms.
- Supabase security advisor: informational RLS-without-policy findings are intentional for backend-only tables. See [advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). No permissive policy was added to silence them.
- Performance advisor: new foreign-key indexes have no usage yet because application tables are empty. They are retained for referential operations; see [unused-index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

No live Telegram upload/download or live platform submission was performed. Local integration tests and deployment verification do not prove either end-to-end interaction with external accounts.

## Intentional limits

No existing tests, dependencies or production code paths were deleted. There is no claimed performance benchmark improvement. Reusing the existing Edge runtime avoids a new always-running process for dossier management. Actual upload bytes are bounded while streaming. Existing discovery, matching and delivery semantics remain intact.

File signatures are checked, but this is not malware scanning. Multi-field profile edits use the existing read/modify/write pattern; concurrent edits may overwrite one another. A future submission worker must read current entitlements and current file permissions immediately before external I/O, and reconcile interrupted uploads and ambiguous sends. Platform attachment support and browser-service costs remain unverified for this deployment.
