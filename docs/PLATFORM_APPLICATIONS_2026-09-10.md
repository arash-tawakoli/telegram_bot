# Platform application implementation — 2026-09-10

## Current result

The browser service, private session state, Telegram connection controls and application work list are implemented. **Automatic applications are not enabled or verified end to end.** The verified-platform registry remains empty. No real application or applicant document was sent to a landlord.

In Telegram: `/mappe` → **Plattformkonten / Auto-Bewerbung**. Premium users can open a personal 100-second browser login window. Each user/platform pair has its own persistent encrypted Browserbase context. Supabase stores identifiers and status, not plaintext cookies or passwords. The provider key and project ID are in Vault. Recording, session logs, CAPTCHA solving and advanced stealth are disabled. Context persistence alone is not proof of successful authentication. Expired Premium still permits disconnect and deletion. Account deletion must remove remote contexts first.

Address fields reuse `bot_users.applicant_profile`, following the required fields observed in the live ImmoScout contact form. Existing document storage and per-file permission remain unchanged.

## Application processing

- An insert trigger on existing `delivery_events` creates an application only for matched, active, fresh listings and opted-in active Premium users on a verified platform. The existing freshness and entitlement functions are reused.
- Existing `applications` is the work list. Unique user/listing records, `SKIP LOCKED`, expiring leases and lease tokens prevent duplicate workers. No separate queue technology is introduced.
- Existing Supabase Cron checks once per minute and invokes the worker only when work exists. One application is processed per invocation.
- Authorization is checked again before the first disclosure of applicant data. The irreversible checkpoint occurs before form filling, because platforms may autosave input. A timeout after this point is never automatically retried, even if no final click was observed.
- Known transient browser errors before the checkpoint permit at most three preparation attempts. Expired sessions, challenges, missing fields and unsupported attachments require manual intervention.
- Telegram lists recent application states. A previously sent or uncertain application displays a verification link instead of a fresh copy-and-send prompt.

## Actual platform observations and remaining work

Both public listing/contact pages were inspected without submitting. One supposedly active stored Scout offer was already deactivated on the platform. Another Scout contact form showed required name, email and postal address fields. Kleinanzeigen showed its contact form and platform-specific consent fields. These observations justify conservative handling; they do not prove authenticated submission.

The two adapter entry points are independently replaceable and use the existing listing URL allowlist. Their selectors and success detection must be validated with authenticated accounts and consenting targets before registration in `app_private.application_platforms`. Existing platform name fields are preserved; the adapter does not guess how a full name splits into given/family names.

**The attachment path is implemented but not verified on authenticated platform forms.** It requires exactly one file control in the contact form, explicit acceptance of the selected PDF/image types and multiple-file support when needed. Transfers are capped at 10 MiB per application; file ownership, current permission, size and signature are checked server-side. No public download link is created. Unsupported controls/formats become `manual_required`; files are never silently dropped or converted to evade format restrictions. Actual upload completion and recipient-side attachment receipt still require platform tests. Do not label this as complete automation.

Browserbase Free uses bounded login sessions and may exhaust its runtime allowance. No paid upgrade was selected. A 100-second login window may be insufficient for some verification flows. Session renewal remains platform-controlled; there is no Gmail refresh token. Earlier failed infrastructure probes may have left empty test contexts; none contained applicant credentials or documents.

## Scope and simplification review

Reviewed/reused: discovery in `source-worker` and source transports; SQL matching/freshness and `delivery_events`; Telegram UI/fast/gateway routing; existing Premium billing rules; Supabase migrations, Storage, Vault and Cron; `tests`, `scripts`, `.github/workflows`, package manifests, deployment manifest, migration registry and `docs`. `supabase/deployed-support` remains unchanged.

Changed production files: a single migration, `application-worker` (runtime, provider calls, adapters), `telegram-ui/platform-sessions.js` and narrow changes to applicant fields, dossier navigation, callback routing, account deletion and quick-application duplicate warnings. No search, crawler, matcher or existing delivery worker was replaced. No existing tests or dependencies were removed. The unused new provider session wrapper was removed; terminal-session checks live in the disconnect operation that needs them.

Concrete efficiency: no browser/Edge invocation for an empty work list; browser sessions have a 120-second cap; repeat workers are fenced; no separate scheduler/queue server, Gmail service or alias infrastructure. No benchmark improvement is claimed. `puppeteer-core` is pinned to 24.31.0; the deployed bundle resolves it without installing a browser in Supabase.

## Verification

- `node --test tests/platform-database.test.mjs tests/platform-adapters.test.mjs tests/browserbase.test.mjs`: 9 passed before the additional disconnect regression test.
- `node --test tests/application.test.mjs tests/dossier.test.mjs tests/platform-adapters.test.mjs`: 19 passed.
- `node --test tests/application-worker.test.mjs`: 2 passed, including uncertain authorization and no post-checkpoint retry.
- `node --test tests/platform-sessions.test.mjs`: 2 passed, covering private owner access and disconnect after Premium lapse.
- `node --test tests/browserbase.test.mjs tests/application-worker.test.mjs`: 7 passed after disconnect recovery fixes.
- `npm test`: 158 tests passed.
- `node scripts/check-runtime.mjs`: 24 bundles / 153 migrations; deployment files read back and compared byte-for-byte.
- `git diff --check`: passed.
- External TypeScript 5.9 baseline comparison: 99 diagnostics, consisting of 91 preexisting diagnostics and 8 new Deno/npm/Node-resolution environment diagnostics. Two actual JavaScript type issues were fixed. This is **not** a clean type-check. No project formatter/linter is configured.
- Supabase migration `20260910085141_platform_application_sessions` applied and exported under the server-generated version. Local SQL SHA-256 matches production migration history exactly. CLI is unavailable; `supabase --version` exits 127. No migration timestamp was invented.
- Production grants: anonymous session-table read false; authenticated send-RPC execution false; verified platform count zero. Security advisor information about RLS without policies is intentional for backend-only tables, not a reason to grant public access.
- Real Supabase→Browserbase probe: project access, context creation, remote Chromium connection, `about:blank`, session release and context deletion all succeeded. It sent no application data.
- Deployed worker: authorized empty queue returns HTTP 200 `idle`; unauthenticated invocation returns HTTP 401.
- Read-only checks reused the two saved contexts successfully. Kleinanzeigen reported a logged-out state; ImmoScout authentication could not be conclusively identified. Neither is a verified authenticated submission session. Telegram now offers a connection check alongside login/disconnect.

Outstanding external proof: user login through Telegram/Live View, persistence/reuse of each platform account, valid contact form submission, recipient-side receipt, supported attachment upload and explicit success detection. Consenting test targets and user-performed platform sign-in are needed for those checks; mocks are not substitutes.
