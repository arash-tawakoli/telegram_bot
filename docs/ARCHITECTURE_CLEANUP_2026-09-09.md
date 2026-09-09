# Architecture cleanup audit — 9 September 2026

Small, behavior-preserving cleanups are prepared against `arash-tawakoli/telegram_bot` commit `3225679662db49801156813f437dd707e330f04f`. All 112 existing tests pass before and after. No tests, dependencies, endpoints, migrations, or production data were deleted. No deployment was performed.

## Directories inspected

The review covered the complete 262-file repository inventory, imports and references throughout the runtime, all major layers below, all 19 test files, CI wiring, and migration/configuration references. This is a codebase audit, not a fresh live acceptance test of all 65 providers. There is no repository AGENTS.md. All 71 JavaScript/TypeScript/test/script modules were parsed in full. Historical SQL was scanned for definitions, dependencies and duplicated history; it was not replayed against production.

| Directory/package | Purpose and review focus |
| --- | --- |
| Root | README, package/lockfile, ignore rules; Node 24 test environment, single PGlite development dependency |
| `.github/workflows` | Architecture, seed, legacy-reference and secret checks; separate Wunderflats identity workflow and its additional branch coverage |
| `docs` | 20 architecture, rollout, incident, source-coverage, product and migration-register documents/data files; distinguish historical observations from current claims |
| `scripts` | Eight integrity/SQL operational scripts; registry alignment, diagnostics and incident containment; manual scripts are not dead just because application code does not import them |
| `supabase` | JWT configuration, runtime manifest and bootstrap seed; deployed inventory versus repository snapshots |
| `supabase/.temp` | Ignored CLI cache; an empty tracked historical cache file has no runtime role; left alone |
| `supabase/migrations` | All 151 exports inventoried/scanned; queue/lease ownership, freshness, matching, entitlement, RLS/permissions, scheduling and schema history; 96 function names and 35 repeatedly defined function names identified |
| `supabase/deployed-support/mini-app`, `mini-app-publisher`, `noop` | Three independently deployed compatibility/support endpoints; retain their HTTP responses |
| `supabase/functions/source-worker` | All 17 files: entry routing, shared parsing/persistence, checked results, job ownership, Scout, Kleinanzeigen, GCP, generic, Immomio inventory/fallbacks, ImmoSolve/HPM, public/cooperative inventory, Nestpick, city/Wunderflats/swap catalogs and Deno configuration |
| `supabase/functions/source-shadow` | Separate diagnostic probes and telemetry, not a redundant delivery worker |
| `supabase/functions/notification-dispatcher` | Eight modules: event selection, entitlement, availability, exact source facts, labels, lease/recovery, pacing, Telegram failure classification, preview checkpoints and sending |
| `supabase/functions/telegram-ui` | Eight modules: authenticated entry, handlers, runtime/state, navigation, profiles, localization, admin and organizer; import cycles and unused code |
| `supabase/functions/telegram-gateway` | REST-backed fast command responses, user hydration, forwarding and inbox handling |
| `supabase/functions/telegram-fast` | Combined authorization/snapshot RPC, callback acknowledgement, background completion and UI fallback |
| `supabase/functions/telegram-premium` | Separate premium response/payment-link path and image fallback |
| `supabase/functions/telegram-premium-image`, `telegram-fallback-logo` | Public image assets/proxies and response/cache contracts |
| `supabase/functions/stripe-webhook`, `billing-maintenance` | Signature verification, event claims, subscription ordering, entitlements, credit idempotency and notifications |
| `supabase/functions/kleinanzeigen-transport` | Authenticated, target-restricted upstream HTML transport |
| `supabase/functions/immobilien-de-transport` | Native/legacy card schemas, paging, cookies, bounded fetching and completeness |
| `supabase/functions/immobilie1-transport` | Full-snapshot enumeration and provider-specific card parsing |
| `supabase/functions/vonovia-transport` | Provider-scoped portal searches, detail discovery and deduplication |
| `supabase/functions/noncoop-feed`, `noncoop-new-feed` | Provider discovery and detail enrichment; preserve differing coverage/freshness behavior |
| `supabase/functions/covivio-feed`, `meravis-feed`, `spacest-feed` | Official sitemap, HTML-card and public-API feeds; individual parsing and completeness semantics |
| `tests`, `tests/fixtures` | 19 test files/112 cases and two SQL fixtures; application invariants, mocked handler execution, PGlite database behavior and fixture limitations |

Read-only Supabase inspection confirmed 23 deployed functions, ten active cron jobs, and 65 configured sources. The deployed UI bundle was read and compared with the relevant repository code. The three removed identifiers have no references in public/private SQL function bodies. No secret values or user records were needed. The Supabase changelog was checked; these changes introduce no new Supabase API, schema or configuration behavior.

## Removed

| Removal | Evidence and safety |
| --- | --- |
| `telegram-ui/runtime.js`: `ensureUser` | No runtime, test, script, SQL or registration caller. The actual entrypoint uses `prepare_telegram_update`, whose user/subscription snapshot is covered by button tests. Removing the uncalled function executes no database operation. It was an internal module export, not an HTTP or published package API. |
| `telegram-ui/runtime.js`: empty `PREMIUM_PREVIEW_B64` | Definition only; actual image paths use the premium-image endpoint. No initializer side effect. |
| `telegram-ui/localization.js`: `textFor` | Definition only. Active text and keyboard rendering uses `localizeText`/`localizeMarkup`; all translation tables retained. |
| 13 unused imported bindings across `admin.js`, `index.ts`, `localization.js`, `navigation.js`, `profiles.js`, `runtime.js` | TypeScript symbol analysis identified unused bindings. Complete UI ESM linking/evaluation still registers one handler and constructs one client, as before. Removing localization's back-imports also removes its accidental database dependency. |
| Duplicate `node_modules/` ignore entry and adjacent redundant blank lines | Identical existing rule remains; ignore behavior unchanged. |
| README's stale fixed test/function/migration counts | Replaced with executable verification instructions and clear historical-test attribution, avoiding another quickly stale count. |

No existing test was demonstrably obsolete or a framework-only check. Similar-looking database, lease, adapter and handler tests exercise different failure boundaries. No tests were removed or weakened. Both CI workflows remain: `fix-wunderflats-key.yml` additionally covers `codex/**` pushes, which the architecture workflow does not.

## Simplified

- Localization no longer imports navigation, profiles or the database runtime. The full UI still loads the same necessary runtime graph; standalone localization now evaluates one module instead of five.
- Longest-first translation alias order and extra-key order are computed once, retaining the existing replacement order. Reference checks found no external mutations of these tables.
- Runtime money rendering and organizer numeric rendering each reuse a module-local `Intl.NumberFormat` with the same explicit locale/options. Two local instances avoid adding a shared abstraction or new dependency.
- Wunderflats extracts the ordered HTML link list once per page. The same first-match predicate, canonical URL construction, source IDs, price units and pagination checks remain.
- Eight repository file hashes in `runtime-manifest.json` were updated to match the reviewed edits. Recorded deployment hashes and versions were deliberately preserved. The integrity checker itself is unchanged.

## Performance evidence

Instrumented synthetic comparisons against the baseline produced:

| Work | Before | After |
| --- | ---: | ---: |
| HTML link scans for a 30-listing Wunderflats page | 30 | 1 |
| Sort calls while translating 1,000 English labels, after module initialization | 2,000 | 0 |
| NumberFormat instances for 1,000 runtime money values, including initialization | 1,000 | 1 |
| Modules/client constructions when loading localization independently | 5 / 1 | 1 / 0 |
| Full UI entrypoint client constructions/handler registrations | 1 / 1 | 1 / 1 |

The Wunderflats lookup still searches the ordered link list per listing; no indexing semantics were introduced. Empty pages now extract an empty/unused link list once. Formatter and translation ordering initialization moves a small bounded amount of work to module load. These are operation/allocation counts, not measured production latency, cost or throughput claims. No database/network-I/O reduction or deployment speedup is claimed. Runtime edits total 18 added and 65 removed lines, before documentation/manifest changes.

## Preserved intentionally

- `checked`, `databaseQuery`, `persistCandidates`, `runClaimedJob`, delivery-lease and pacing helpers enforce failure classification, ownership, acknowledgement or timing contracts. They are meaningful boundaries despite small implementations.
- Telegram request wrappers differ in authentication, direct-webhook responses, retry behavior and ambiguous delivery handling. Consolidating them could change duplicate-send behavior.
- `button`, `send`, `edit`, organizer `owned`/`render`, GCP connector accessors and image endpoints encode UI, ownership, defaults or HTTP contracts; brevity alone does not justify deletion.
- Duplicate historical SQL exports are migration history. Repeated definitions can be necessary in ordered upgrades; deleting them is not a runtime optimization.
- Mini-app HTTP 410 handlers and noop remain externally callable. Missing internal callers do not establish safe removal.
- Provider-specific number, HTML, URL and address helpers have differing semantics. Importing the broad source-worker shared module into independent public feeds would also initialize a privileged database client.
- SQL/TypeScript freshness and entitlement checks serve separate ingress, persistence and dispatch boundaries. They cannot safely be collapsed based on similar expressions alone.
- The profile-count query whose count is unused remains because its failure currently aborts saving; removal requires an explicit error-contract decision. Similarly, no unproven index, cron, fallback, configuration or source path was removed.
- Synthetic SQL fixtures and source-extraction test harnesses remain. They support meaningful regressions even though they do not validate all real module wiring or the complete production schema.

## Verification evidence

Commands below ran from the checked-out repository unless otherwise stated. Auxiliary audit programs were temporary review instrumentation, not new runtime dependencies.

| Exact command / check | Result |
| --- | --- |
| `git clone https://github.com/arash-tawakoli/telegram_bot.git` | Failed: shell GitHub credentials unavailable. Retrieved the fixed snapshot through the authorized GitHub connector instead. |
| `npm ci --ignore-scripts` | Passed under Node `v24.19.0`; installed the existing pinned PGlite dependency. |
| `npm test` | Baseline 112/112 and final 112/112; zero failures, skips or deleted tests. Final local duration approximately 3.42 s; not a benchmark. |
| `node --test tests/telegram-buttons.test.mjs tests/organizer.test.mjs` | 13/13 after unused-code/import cleanup. |
| `node --test tests/organizer.test.mjs tests/telegram-buttons.test.mjs` | 13/13 after formatting/localization optimization. |
| `node --test tests/catalog.test.mjs tests/listing-keys.test.mjs` | 10/10 after catalog optimization. |
| `node --test tests/listing-keys.test.mjs` | 2/2; separate CI workflow's command. |
| `node scripts/check-runtime.mjs` | Baseline passed. Correctly failed after edits before hash refresh; passed after updating only the eight changed repository hash entries: 23 manifests, 151 migrations. Reports 23 differing recorded deployment file hashes versus 15 before this un-deployed cleanup. |
| `node --check supabase/functions/telegram-ui/runtime.js` | Passed. |
| `node --check supabase/functions/telegram-ui/localization.js` | Passed. |
| `node --check supabase/functions/telegram-ui/organizer.js` | Passed; also ran `node --check` on every UI `.js` file. |
| `node --check supabase/functions/source-worker/catalog.ts` | Passed. |
| `node --check supabase/functions/source-worker/generic.ts` | Failed on a TypeScript annotation; baseline has the same failure. This direct Node syntax-check path is not a reliable check of this Deno module. No source/test was changed to hide it. |
| `node --experimental-vm-modules ../audit-tools/modules.cjs` | All 71 full modules parsed after `stripTypeScriptTypes`; original/current UI graphs linked and evaluated with mocked external client/environment. Identical handler/client registration at the UI entrypoint; localization no longer constructs a client. |
| `node ../audit-tools/static.cjs` | TypeScript 5.9.3 `allowJs`, `checkJs`, `noEmit`, `noUnusedLocals`, `noUnusedParameters`, ESNext/Bundler probe: 91 baseline diagnostics → 81, no new diagnostics. This is a successful differential check, not a clean full type check. |
| `node ../audit-tools/performance.cjs` | Operation counts in the performance table; Wunderflats output exactly matched the baseline. |
| Inline Node/VM baseline comparison | 10,346 translated strings and 10,346 keyboard outputs equal; 1,016 money outputs equal, including null/missing, invalid, signed, fractional and large inputs. |
| Architecture workflow shell steps, executed verbatim via `bash -e -c` | All five passed: architecture files, v3 seed, Mini-App reference rejection, legacy runtime rejection, committed-secret pattern rejection. |
| `git diff --check` | Passed after each cleanup and at final review. |

No linter/formatter or Deno executable is configured/available in this checkout. No dependency migration or wholesale formatting was introduced. The temporary TypeScript installation was outside the repository. The TypeScript 7.x package initially lacked the expected older compiler API; the independent audit tool was pinned to 5.9.3. Supabase inspection was read-only: deployed-function metadata/content and SQL selections for cron, source/connector routing and removed-symbol references. No messages, purchases or provider applications were sent.

## Remaining concerns

1. **Deployment drift is real and broader than this cleanup.** Current live versions include UI 68, source-worker 62, dispatcher 70, Stripe 36 and billing 23; the manifest contains historical observations. Live UI verification supports the UI removals, but does not prove the entire repository equals production. Review deployment-specific differences before release; do not bulk overwrite live functions.
2. **No clean full type-check baseline.** Most probe diagnostics concern absent Deno/EdgeRuntime types and unresolved `npm:`/`jsr:` imports, but some are genuine existing type issues. Notably `meravis-feed` declares a string named `URL` while `abs()` calls `new URL(...)`; non-root-relative URLs therefore hit its catch and become null. Fix separately with provider fixtures, since changing emitted links is outside this cleanup.
3. **Overlapping Telegram implementations.** Gateway, fast, UI and premium duplicate entitlement/menu/transport rules. They have distinct acknowledgement and fallback semantics; removing a layer requires a webhook/routing and delivery-contract audit. The gateway's menu also differs from the new planner-aware fast/UI menus.
4. **Concrete remaining unnecessary work needs broader contracts.** Generic pagination fetches the front page through `parseOne` and again for pagination metadata; reuse needs a return-contract change. Dispatcher reads all subscriptions for a nonempty event batch. Immomio/HPM inventory reconciliation uses repeated array membership tests. `persistProfile` counts rows without using the count but propagates failures. These are identified candidates, not claimed improvements.
5. **Provider coverage and concurrency.** Some feeds swallow individual fetch failures or cap pages while returning completeness metadata; `immobilie1-transport` and Covivio detail fetching can fan out without a small global cap. Altering coverage or scheduling could change freshness/deactivation behavior and needs targeted integration tests.
6. **Migration exports are not a verified clean-install schema.** Historical reconciliation documents missing/prior state dependencies. PGlite tests load reduced fixtures and selected migrations; passing them does not prove `supabase db reset` succeeds or validate real PGMQ concurrency.
7. **Tests are useful but not comprehensive.** Several harnesses strip imports or extract source slices. They can miss integration/linkage errors. This audit added temporary full-module linking evidence but did not rewrite the suite or claim full Telegram/Stripe/provider end-to-end coverage.
8. **Historical residue needs care.** Dispatcher `enrich` retains an unused `previous` binding and a misleading cache-reuse comment; billing credit paths, archived source routes, source-fact fallback behavior and stale historical documentation need live-use evidence before broader removal. Fast/UI notification retries have ambiguous-send risks distinct from the stricter dispatcher.

The resulting architecture remains scheduler → source jobs → adapter/persistence → SQL matching/freshness → delivery events → dispatcher, with separate authenticated Telegram and billing inputs. Changes are limited to verified dead UI code, import boundaries, repeated local computation and documentation accuracy.
