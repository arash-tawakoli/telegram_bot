# Telegram Fast Path v3 — 2026-09-20

## Goal

Reduce perceived Telegram button latency beyond Fast Path v2 without weakening state integrity, delivery safety, auto-apply controls, or language handling.

## Baseline after v2

Measured on real callbacks after the v2 rollout:
- total P50: 219 ms
- total P95: 321.8 ms
- total average: 231.9 ms
- SQL execution of telegram_fast_action_v2 itself: about 12 ms mean in pg_stat_statements
- the remaining stateful latency is therefore mostly Edge-to-PostgREST/database network time plus Telegram acknowledgement/network time, not PostgreSQL execution.

## v3 changes

1. German Home, Settings and Help use locale-tagged callbacks (`home:de`, `settings:de`, `help:de`) and render in the gateway without a blocking database request.
2. These static actions still record sanitized telemetry asynchronously in `bot_events`; they do not skip observability.
3. Edge execution region is recorded in timing metadata for both stateful and static fast paths.
4. Telegram webhook and bot-token secrets are prewarmed in parallel on cold worker startup.
5. Telegram bot-token cache TTL is raised to one hour. Authentication failures refresh the token once before failing, preserving token-rotation safety.
6. Existing non-German, auto-apply, admin, provider-auth and stateful profile actions keep their existing authoritative paths.
7. Existing legacy callbacks remain valid. Locale-tagged callbacks are emitted only by the German Fast UI.

## Expected effect

The most frequently observed navigation actions no longer wait for the approximately 80–130 ms Edge-to-database round trip before producing their visible Telegram edit. Stateful profile/filter mutations remain database-authoritative.

No claim is made that every visible Telegram update will be under 100 ms. Telegram transport and client rendering remain outside the project runtime. Actual post-rollout P50/P95 must be measured from real callbacks.

## Safety

- Static actions are read-only navigation only.
- No application submission, billing mutation, source crawl or delivery behavior is changed.
- Static telemetry stores only update id, Telegram user id, callback action, timing numbers and Edge region; it does not copy the full Telegram payload.
- New telemetry RPCs are service-role only.

## Isolated canary verification

A separate `telegram-gateway-v3-canary` bundle was deployed before touching the production webhook. With the function forced to `eu-west-1` and invoked twice through the same authenticated code path:

- cold static Home response: 238 ms (includes first worker secret warmup)
- warm static Home response: 68 ms
- returned method: `editMessageText`
- recorded DB time for static path: 0 ms
- recorded render time: 1 ms
- Edge region: `eu-west-1`
- no persistent synthetic user or event data retained

This canary is a server-side runtime check, not a guarantee of Telegram client-visible latency. Telegram transport remains external.
