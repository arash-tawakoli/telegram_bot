# Telegram product releases — 2026-09-01

This release finalizes the code and database implementation of releases A–E while leaving the 65-source crawling, connector, inventory, and deduplication architecture unchanged. The only remaining account-level prerequisite is the Stripe Customer Portal/restricted-key configuration described below.

## Production components

- `telegram-gateway`: authenticated Telegram webhook entry point and compatibility layer for the existing `telegram-ui`.
- `notification-dispatcher`: recipient-aware delivery, profile matching, quiet hours, digests, daily limits, feedback/mutes, change messages, and non-blocking map routes.
- `stripe-webhook`: signed and idempotent Stripe lifecycle processing.
- `billing-maintenance`: retryable referral-credit processing.
- `mini-app`: Telegram `initData` verification and the Mini App JSON API.
- Mini App frontend: `https://traumwohnung-mini-app.vercel.app`.

## Required Stripe configuration

The subscription checkout and webhook are live. Customer Portal sessions and referral credits additionally require:

1. Activate the Stripe Customer Portal for the live account, including payment-method updates, invoice history, and cancellation at period end.
2. Create a restricted live Stripe key with only the permissions needed to create Customer Portal sessions and customer balance transactions.
3. Store the key in Supabase Vault as `stripe_restricted_api_key`.

Until this key exists, the code returns a controlled “not configured” response and leaves qualified referral rewards pending. No secret is exposed to Telegram, Vercel, or GitHub.

An optional no-code Customer Portal login URL can be stored as `stripe_portal_url` and is used as a fallback.

## Cost guard

No paid Google Routes or Geocoding API has been enabled. Pendelziel links use Google Maps URLs and therefore do not introduce a paid API dependency. Paid route/geocoding activation still requires explicit cost approval.

## Verification

- Vercel Mini App HTML and JavaScript return HTTP 200 with CSP headers.
- Invalid Telegram Mini App authentication returns HTTP 401.
- A correctly signed current Telegram `initData` bootstrap returns HTTP 200.
- Stripe webhook event claiming returns `busy` for a concurrent duplicate and `duplicate` after completion.
- Telegram global menu button points to the Vercel Mini App.
- Supabase security and performance advisors contain no new warning or error findings; remaining notices are informational.
