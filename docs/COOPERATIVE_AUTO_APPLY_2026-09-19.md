# Cooperative auto-apply expansion - 19 September 2026

Project: `dpmohkrwdlicexwcrqfy`. This is the first application-coverage package, not the deferred crawler/compute rollout in PR #32.

## Production rollout

- Database migration: `20260919164605_expand_cooperative_auto_apply_targets`.
- `immomio-account`: deployed version 7, artifact `f48f77e6391da1fb4c341dc68891389299677a9879d52aadd912ef2396009585`.
- `immomio-application-worker`: deployed version 2, artifact `85c55e83f0b14cba28e42da65890e55e9d9b13736586deaf0d30b1e527e88f80`.
- Both existing authenticated health endpoints returned HTTP 200 with `applicationTargets=central-db-resolver` and `sendAuthorization=single-use-object-lease` (requests 33958 and 33959).
- No source was switched, no account was registered, no user opt-in changed, and no historical application was requeued. No real test application was sent.

## Implemented

1. A single database resolver recognizes explicit `applicationLink`, `application_link`, `applicationUrl`, `application_url`, `tenant_apply_url` and the actual canonical URL. It accepts only valid HTTPS Tenant Immomio object URLs, including the `/de/apply/` variant, normalizes UUIDs and ignores tracking suffixes. Registration URLs, malformed UUIDs, untrusted hosts and conflicting object identities are not valid application targets. It never manufactures a Tenant object ID from an unrelated external ID.
2. Application routing, worker selection and account checks use the actual application target rather than just the discovery platform. Compatibility wrappers remain. The Finkenwaerder REST discovery connector stays in place.
3. `get_immomio_application_listing` normalizes the resolved link only in its read response. Existing provider code receives the expected `raw.applicationLink`; no rewrite of raw listing data, first_seen_at, fingerprints or discovery history is needed.
4. `application_send_keys` reserves `(user_id, immomio, source_identifier)` before submission. A second application record for the same provider object, even from another source, cannot submit again. Historical submissions with resolvable keys are retained; none were found for the initial backfill. Reservations are not automatically released after ambiguous outcomes.
5. Before provider submission the account endpoint validates the application ID, user, listing, live lease and expected object. Immediately before the provider mutation a one-use database authorization is consumed. Replaying the same request cannot consume it again. The old unbound `send_test` path no longer has unconditional authorization.
6. Submission rechecks the 24-hour newness policy, current listing/source eligibility, opt-in, premium entitlement, applicant profile and an eligible new-listing delivery event. Unsupported challenges, missing answers, re-login requirements and ambiguous outcomes retain the manual-required/error paths. This does not bypass CAPTCHA or SMS, invent answers, or read another user's invitations.
7. `cooperative_auto_apply_readiness(user_id)` reports all 32 cooperative sources, their routing class, recognized links, current eligible targets and the user's account/consent/profile/entitlement state. Per-provider registration remains explicitly unverified; a connected account is not claimed to be registration at every cooperative. The account endpoint exposes this only through its existing internal authentication as `action=readiness`.

## Observed coverage, not successful-send claims

At the post-rollout SQL verification:

| Class | Sources | Recognized retained object links | Currently new eligible objects |
|---|---:|---:|---:|
| Native Immomio discovery | 10 | 63 | 0 |
| Finkenwaerder hybrid discovery | 1 | 13 | 0 |
| Immomio registration portal only | 6 | 0 | 0 |
| Other provider or unverified access | 15 | 0 | 0 |
| Total | 32 | 76 | 0 |

The former field-only expression recognized 48 retained cooperative links. The shared resolver recognizes 76, an increase of 28 historical records, with zero conflicting targets. Finkenwaerder increases from five field-only links to 13 recognized links. These are NOT 28 new apartments or applications and are NOT a reason to backfill stale inventory.

Application status counts remained 71 sent, four failed and seven manual-required; there were zero application records created after the migration at the check. There was no fresh cooperative target for a real end-to-end pilot, and no such pilot was authorized or performed.

## Security and tests

All new RPCs deny PUBLIC, anon and authenticated execution and grant only service_role. The reservation table has RLS and no client grants. It grants the service only SELECT, INSERT and column-level UPDATE of request_started_at. No credentials or personal applicant content are included in this report or test fixtures.

23 focused tests passed locally against the exact production-exported migration and mocked gateway/worker: resolver variants and conflicts, canonical fallback, platform precedence, lease and target binding, opt-in/premium/profile/freshness rejection, source-independent duplicate protection, one-use consumption, uncertain outcomes, readiness and client-access denial. The available local repository snapshot's complete suite also passed 203 tests; the current main branch must be tested separately in CI because the snapshot predates the last database synchronization.

Runtime manifests record the two observed deployment versions and artifact hashes. Individual-file deployment hashes must not be inferred from local file hashes; unrelated historical drift is not hidden. A healthy endpoint proves startup, not a successful real application at every source.

## Remaining expansion stages

- Lehrerbau and Buchdrucker: currently no public offer on the checked offer pages. Do not enable a new public feed or label them send-verified without a real, attributable object target.
- Gartenstadt Hamburg, FLUWOG, WG1904 and WHW1897: provider-specific registration and authorized private offer access remain required. No personal mailbox ingestion or private invitation retrieval was activated. A new email alone is not proof of source publication within 24 hours.
- The five ImmoSolve sources and WV1902's separate application process still need provider-specific validation/adapters. Reading their inventory does not prove a compatible submission API.
- The remaining cooperatives require individual official application-path checks. No claim of 17 or 32 fully operational auto-apply sources is made.
- The current provider adapter still performs its existing account, object, prior-application, CAPTCHA/SMS and question checks. A new source becomes send-verified only after a separately authorized genuine pilot with a suitable user and current offer.

Public offer/access evidence checked without account login or form submission:
- Lehrerbau: https://www.lehrerbau.de/ and https://portal.immobilienscout24.de/ergebnisliste/45584335
- Buchdrucker: https://www.buchdrucker.de/de/wohnungsangebote and https://buchdrucker.immomio.de/
- Finkenwaerder: https://fwheg.de/wohnungssuche/
- FLUWOG: https://www.fluwog.de/wohnen/wohnungssuche/
- Gartenstadt Hamburg: https://www.gartenstadt-hamburg.de/angebote/
- WG1904: https://www.1904.de/wohnungen/wohnungssuche

## Operational inspection (read-only)

```sql
select * from public.cooperative_auto_apply_readiness(null);
-- For a specific authorized user, pass their UUID instead of null.
```

Do not test by invoking `process`, `send_authorized` or a registration mutation against real users. Use the existing authenticated `health` and readiness reads, synthetic tests and a separately approved pilot. Keep failed/uncertain provider submissions from being blindly retried.
