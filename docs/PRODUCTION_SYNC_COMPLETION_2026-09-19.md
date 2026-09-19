# Production/source reconciliation - 19 September 2026

## Completed engineering work

1. PR #32 merged as `e44e6b84f131024274b917777a4dbff4e86f0a2e`. Main now carries the deployed Scout and Wunderflats budget behaviour, with the matching regression tests. The earlier "not deployed" rollout description has been replaced with the actual production observations.
2. Exported all fifteen missing applied SQL versions (fourteen historical plus the cooperative identity fix). Each exported SQL payload was checked against the SHA-256 from `supabase_migrations.schema_migrations`. Eight repository timestamp aliases were renamed to the true applied version after content comparison; one combined canary export was replaced by the three exact applied versions. Old commit history preserves the former files.
3. There are 211 migration identifiers on each side; the sorted, newline-separated identifier list hashes to `8d8a7283bc982e54fc39836639ad2f2d0573d4234e552b99fd5ef667d2dfd403` both locally and in production (read-only check 18:34:36 UTC). This closes missing-version/alias drift, not a full fresh-database restoration test. No historical SQL was rerun and no production migration ledger row was edited.
4. Added a filename/version consistency check to the registry validator so guessed timestamp aliases cannot silently recur.
5. Exported `20260919171615_preserve_cooperative_object_identity_dedupe` and added real PostgreSQL/PGlite tests for distinct apartment IDs at one address, matching platform identities across sources, stable repeated assignment, old-group repair, uncertain-outcome preservation and client privilege denial. Production EBV repair remains five separate active apartments; there was no stale-offer replay.
6. Removed the completed one-off completion-checkpoint workflow. Permanent architecture CI is retained. Runtime metadata records source-worker v73 and its observed compiled artifact checksum without inventing per-file deployed hashes.

## Verification

The local test suite and migration registry checks are run on this exact source tree before the reconciliation commit is published. CI must also be checked on the final branch/main commit. Successful tests do not constitute a real rental application.

## Boundaries that are not marked complete

- Two of the three users who opted into auto-apply still need to connect their own Immomio accounts. No login, opt-in, profile answer or registration was fabricated.
- A suitable, genuinely new cooperative offer for a full real-send pilot was not present at the previous check. No old listing was made fresh and no unsolicited test application was sent.
- The six additional registration-only cooperatives need verified, authorized access to concrete offers. Personal invitations are not public inventory; a new email does not prove an apartment was published within 24 hours. A production private-offer importer is not delivered by this change.
- ImmoSolve/Wohnungshelden and other unsupported application processes still require provider-specific implementation and verification. They are not described as supported merely because inventory can be crawled.
- Historical per-file runtime hash differences remain explicit. Management artifact metadata and selected behavioural checks are not a byte-for-byte audit of all old deployed Edge functions. No warning was suppressed by copying a local hash into an unverified deployment field.
- Existing unknown Telegram outcomes are preserved; without an independent delivery confirmation they are neither declared sent nor resent.

Therefore the repository/migration reconciliation and deployed crawl-budget work are complete, but the product goal "all 32 cooperatives fully automated and end-to-end send verified" is not complete. External account access, unsupported integrations and genuinely new live test data cannot be replaced by a bookkeeping completion flag.
