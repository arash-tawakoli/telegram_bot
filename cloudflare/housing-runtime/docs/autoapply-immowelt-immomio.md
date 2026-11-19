# AutoApply: why Immowelt and Immomio do not send (findings, 2026-11-19)

No code bug was found. Both errors come from deliberate safety gates. This
note records the evidence and how to open each gate safely. Production D1 was
only read.

## Immomio: `central_identity_mismatch`

Raised in `application-runtime.js` (normal sends) and `immomio-application.js`
(test sends and the final check).

- Central Immomio credentials are the owner's own account
  (`provider_connections`, owner telegram id 8538226539, `account_hint`
  `arash@nexalabs.de`, status `connected`, refreshed hourly).
- `createApplication` assigns the application to that account's Immomio
  `userId`, so it would apply as the owner, with the owner's Immomio profile.
  The runtime therefore requires `owner id == applicant` and
  `account_hint == applicant profile email`. For every other participant this
  is a genuine provider limitation, not a comparison bug.
- All 21 rows of the last 7 days are the owner's own `test_provider_submission`
  runs. His applicant profile email (`marketplace@kawasindi.com`) differs from
  the Immomio account email, so the sender stops at its email check.
  Fix for the test path: set the owner's applicant profile email to the Immomio
  account email (data, not code).
- Opening Immomio for other participants needs a per-participant Immomio
  login (a different connection model); do not route them through the owner's
  account.

## Immowelt: `provider_contract_unverified`

- `CENTRAL_IMMOWELT_TRANSPORT_VERIFIED` is not set anywhere (neither
  `wrangler.jsonc` vars nor Worker secrets). `application-runtime.js` and
  `immowelt-application.js` return `provider_contract_unverified` before any
  quota or network use. That is the intended gate: the SOAP `SendContactMail`
  call with the central cookie session, on behalf of another person, has never
  been verified.
- Even with the gate open, new Immowelt expose URLs use 12 character ids
  (for example `26BDELDE3T1F`), while the sender requires a 32 hex estate
  GUID. Those would end as `provider_identifier_unresolved`.
- Verification that would justify setting the flag: one real
  `SendContactMail` that returns `<SendContactMailResult>true</SendContactMailResult>`
  and arrives in the Immowelt inbox for a GUID-style listing, done through the
  owner test path (below). Then resolve short ids to the GUID.
- Why so few Immowelt rows: of 39 Immowelt offers since the queue cutover, a
  replay of `matchesProfile` against the 10 enabled participants gives only 3
  matches. Immowelt lists cold rent only (`warm_rent` null) and most listings
  exceed the participants' `max_warm_rent` (390 to 2.250 EUR). The
  `applications` table also hides history: retention deletes rows after the
  listing expires and keeps only the dedupe hash.

## Testing one real application per provider after deploy

Use the owner (telegram id 8538226539; `test_auto_apply_allowed=1`,
`test_auto_apply_enabled=1`, `auto_apply_enabled=0`, provider enabled in
`application_preferences`). The queue creates `test:<participant>:<offer>` rows
automatically for matching offers.

- Immomio: first set the owner's applicant profile email to
  `arash@nexalabs.de`. Pick a fresh Immomio offer without custom questions, SMS
  or captcha (GEWOBA Nord, source 66).
- Immowelt: set `CENTRAL_IMMOWELT_TRANSPORT_VERIFIED=1` for the test only, on a
  GUID-style expose.

Confirm with read-only queries:

```sql
SELECT a.status, a.last_error, a.sent_at, e.status, e.reason, e.metadata
FROM applications a JOIN application_events e ON e.application_id = a.id
WHERE a.test_mode = 1 AND a.provider = 'immomio'  -- or 'immowelt'
ORDER BY e.created_at DESC LIMIT 5;
```

`status = 'sent'` with `confirmation` `immomio_application_created` or
`immowelt_communication_service` in the event metadata means it went out. Check
the Immomio tenant portal or the Immowelt inbox as the final proof. Rows and
events are purged after the listing expires, so query within a day.
