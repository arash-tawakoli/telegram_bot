# Tauschwohnung delivery incident and preview corrections

## Confirmed cause and impact

The preceding coverage fix restored Tauschwohnung pagination and `/expose/<id>` acceptance. It reused `cursor.baseline_done=true` from the previous parser. That parser counted inventory keys separately from candidates it actually accepted and persisted. Newly recovered records therefore passed the existing “new database ID after baseline” gate. No publication timestamp proved they were newly published.

Kawa received 64 distinct Tauschwohnung listings between 20:29:42 and 21:02:22 UTC. In the same incident interval, Scout delivered 1, Kleinanzeigen 1, and Immowelt 2. The earlier 24-hour snapshot contained 124 Immowelt, 87 Kleinanzeigen and 29 Scout deliveries, so these integrations had not stopped; the recovered catalog dominated the recent stream.

This corrects the preceding coverage report: the parser repair worked, but retaining its old freshness baseline was unsafe. The prior test suite failed to cover a parser revision with an already-completed baseline.

## Deployed changes

- Source 21 delivery mode is `shadow`; crawling remains enabled. Pending/known-failed events were skipped, without replaying or deleting sent messages. Last source-21 send across recipients: 21:02:38 UTC; no pending or processing source-21 events remained at verification.
- Catalog cursors now carry a parser revision. A different revision restarts enumeration at page 1 and cannot release the recovered baseline as fresh. Tauschwohnung additionally never requests fresh delivery until an independent publication criterion is implemented. The dispatcher also blocks source 21, including previously queued records.
- Immediately before sending, the dispatcher re-fetches the detail page or native Immomio property. Confirmed 404/410, explicit unavailable page headings and exact-listing structured OutOfStock/SoldOut/Discontinued flags suppress delivery. Confirmed unavailable listings are marked inactive.
- Blocked/failed detail requests are not considered successful checks. Only an active, freshness-eligible positive native Scout, Kleinanzeigen, Immowelt or HPM observation at most ten minutes old can substitute. Other unknown cases retry after at least five minutes under the existing queue expiry. A cached caption alone is insufficient. This is evidence that the source advertises the property, not proof a landlord has not already allocated it.
- All validated images now go through the existing checkpointed Telegram gallery mechanism, in batches of at most ten. Image variants of the same Scout/Kleinanzeigen photo are deduplicated. Confirmed image-fetch failures retain the existing binary-upload fallback; uncertain Telegram results are not blindly replayed.
- Added Scout native gallery extraction, RealEstateListing JSON-LD, deposit/total-rent/type labels, explicit publication dates, district, structured amenities and additional labeled property facts. Kleinanzeigen thumbnail images without gallery classes and checktag amenities are now retained. Unknown values remain hidden; contact/description addresses are not used.

## Verification

- 103 tests passed, including old-parser baseline regression, unknown availability preventing sends, unavailable/blocked pages, gallery continuation, exact listing facts and image completeness.
- 23 runtime manifests and 151 migration files verified. Existing 15 unrelated repository/deployment differences were preserved.
- All 24 files retrieved from deployed source-worker v62 and notification-dispatcher v67 matched the intended payload exactly.
- Direct source checks: Scout, Kleinanzeigen and a Tauschwohnung detail returned HTTP 200; Immowelt returned HTTP 403. The Tauschwohnung page had an active object but did not establish its publication date.
- The accessible Scout detail supplied all 8 images, a 5,064.15 EUR deposit, exact street address, 1,979 EUR warm rent, additional facts and `datePosted=27-08-2026`. It was online but was not newly published on September 8.
- The accessible Kleinanzeigen detail supplied all 14 distinct images, warm rent 950 EUR, cold rent 770 EUR, additional costs 180 EUR, 69 sqm, 2.5 rooms and four amenities.
- Production dry runs (no Telegram test sends): request 166778 Kleinanzeigen: HTTP 200, `online`, 14 images, two albums plus text; 166779 Scout: HTTP 200, `recent_inventory`, 8 images; 166780 Immowelt: HTTP 200, `recent_inventory`, 1 available card image. Scout detail access from the deployed environment did not yield detail evidence, so its live fallback did not include the deposit/street/date obtained in the separate direct-source test. No claim of universally complete detail coverage is made.

## Remaining limits

Online does not guarantee unallocated. Some platforms block detail requests, and inaccessible images or details cannot be reconstructed reliably. Existing authorized native integrations remain in use; access controls are not bypassed. Tauschwohnung remains delivery-disabled until publication freshness can be independently established. This incident check covers the shared delivery path and the named platform samples, not a new per-listing audit of every source.

Changes are reversible through Git and the documented source setting; do not restore the old freshness behavior as an operational rollback. No old listings are replayed. The user now explicitly requested all images, superseding the prior one-image preference.
