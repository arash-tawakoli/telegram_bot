# Quick application through the platform contact form

## Delivered scope

The live bot offers a manual quick-application fallback for Kleinanzeigen and
ImmoScout24. A supported new delivery card includes **⚡ Schnell bewerben**.
The same action is available on supported saved listings in the existing premium
organizer. Previously sent cards are not rewritten.

The action sends a German draft, a Telegram clipboard button and the original
platform listing link. The user reviews the suggested Telegram name, copies the
text, opens the offer, signs in if necessary and submits through the platform.
The bot explicitly says the application has not been sent. It neither prefills a
platform form nor claims to detect its submission.

## Why this path

The inspected stored listings contain no contact email: 2,007 Scout and 5,261
Kleinanzeigen records had no email-shaped value in their raw data. Gmail OAuth or
an outbound alias cannot address an application using only an expose ID or URL.
The existing runtime also has no provisioned browser service or user platform
login flow. Introducing unused OAuth infrastructure would not complete a
platform application.

This is a usable manual fallback, **not the requested complete automatic
application system**. Automated submission, session acquisition/storage, an
auto-apply toggle, an application ledger and browser workers remain unimplemented.
No automated adapter was advertised as working without a real platform test.

## Changes and preserved behavior

- `telegram-ui/application-message.js`: short deterministic draft and strict
  source/host/listing-path validation; complete text fits Telegram's 256-character
  clipboard limit, including non-BMP characters.
- `telegram-ui/application.js`: private-chat and active-user checks, recipient-
  scoped delivered-event lookup, or owner-scoped premium saved-listing lookup.
  No writes and no platform network requests. German draft is sent without UI
  translation so the displayed and copied text agree.
- `telegram-ui/handlers.js`: acknowledge and route `apply:<listing UUID>` through
  the existing authenticated core.
- `telegram-ui/organizer.js` and `notification-dispatcher/index.ts`: add the button
  without changing existing offer, save, premium, matching or delivery behavior.
- Runtime manifest records the verified deployed files, including the shared
  helper in both affected bundles.

No tables, migrations, dependencies, jobs, credentials or profile fields added.
Existing discovery, matching, freshness, delivery leases, retry policy, premium
access and manual organizer status tracking remain unchanged. Draft generation
requires two reads for a delivered listing; an older saved listing can require
three. These reads occur only when the user requests the draft.

## Safety and limitations

Only HTTPS listing URLs on the exact platform hosts are accepted, paired with
their source IDs. Credentials, nonstandard ports, non-listing paths and unrelated
hosts are rejected. Query parameters and fragments are removed. Source titles
and names are HTML-escaped in messages. Drafts are not rendered into group chats
or other users' private chats. Database failures fail closed.

No platform cookies, passwords, tokens or OAuth permissions are collected. There
is no false `sent` state. Repeated clicks produce drafts, not applications.
Because the final send is manual, this feature cannot prevent a user submitting
twice or verify receipt. Delivery retention can make an older unsaved card
ineligible for draft generation. The active flag is the stored source state;
the user must check current availability on the platform.

## Verification

- `node --test tests/application.test.mjs tests/listing-preview.test.mjs tests/organizer.test.mjs tests/telegram-buttons.test.mjs tests/dispatcher-handler.test.mjs`
  — 47 passed.
- `npm ci --ignore-scripts` — succeeded, one existing dependency installed.
- `npm test` — 129 passed, zero failures or skipped tests.
- `node --check supabase/functions/telegram-ui/application-message.js` and
  `node --check supabase/functions/telegram-ui/application.js` — passed.
- `node /workspace/scratch/c75134c3ec7e/audit-tools/static.cjs` — 91 existing
  TypeScript diagnostics, no new diagnostics against the earlier audit baseline.
  This is not a claim of a clean Deno type check; no separate formatter/linter is
  configured in the repository.
- `git diff --check` — passed.
- `node scripts/check-runtime.mjs` — 23 function bundles and 151 unchanged
  migrations verified after deployment.
- Live predeployment bundle contents matched the repository baseline exactly.
  Postdeployment retrieval matched all 11 files of `telegram-ui` version 73 and
  all 9 files of `notification-dispatcher` version 75 exactly.
- Unauthenticated POST to live `telegram-ui` returned HTTP 401.
- After preserving cancellation of pending organizer notes on the new callback,
  `node --test tests/application.test.mjs tests/organizer.test.mjs tests/telegram-buttons.test.mjs`
  passed all 21 affected tests.
- Read-only SQL inspection: all 1,944 active Scout and 3,067 active Kleinanzeigen
  listing URLs matched the supported URL formats at verification time.

The tests cover both platform routes, copied/escaped text, caller authorization,
invalid links, inactive listings, read failures, existing premium behavior and
callback routing. No real landlord was contacted during testing. An interactive
Telegram-to-platform submission and an authenticated automated platform submission
have not been tested.

## Remaining work for automation

A deployed browser runtime and a safe user-driven login handoff are required.
Once available, real test accounts and approved contact targets must establish
the selectors, required fields and success signals separately for both sites.
The backend then needs a durable per-user/listing application record and a
pre-submit checkpoint. A timeout after a submit attempt must become an uncertain
manual-review result, not an automatic resend. CAPTCHA or verification requires
user interaction. Neither a mock adapter nor a unique database row alone proves
that a remote application can only be sent once.
