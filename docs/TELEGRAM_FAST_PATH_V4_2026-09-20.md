# Telegram Fast Path v4 — 2026-09-20

## Goal

Remove the last blocking database read from the webhook-authentication path on cold Edge workers without exposing the Telegram webhook secret or weakening rotation handling.

## Change

The gateway stores only the SHA-256 fingerprint of the high-entropy Telegram webhook secret. Incoming webhook headers are hashed locally and compared with that fingerprint.

- Normal validation requires no database call.
- The plaintext webhook secret is not committed.
- If the fingerprint does not match, the gateway falls back to the existing authoritative secret RPC once.
- A successfully validated rotated secret refreshes the in-memory fingerprint.
- The Telegram bot token remains a secret and is still loaded through the existing protected secret RPC; it is prewarmed in the background and cached for one hour with one forced refresh on authentication failure.

## Canary

An isolated Edge canary using the exact v4 gateway bundle was invoked with the valid webhook secret and a synthetic `home:de` callback.

- HTTP status: 200
- returned Telegram method: `editMessageText`
- static path DB time: 0 ms
- first recorded in-function response time: 2 ms
- second recorded in-function response time: 10 ms
- Edge region: `eu-west-1`

These timings start after the Edge runtime begins executing the function; CDN routing, worker startup before handler execution, Telegram transport and client rendering are not included. They therefore are not presented as end-user latency.

## Safety boundaries

Stateful search/profile mutations remain database-authoritative. Auto-apply, provider authentication, admin actions, billing and delivery behavior are unchanged. Non-German users continue to use their language-aware stateful route. The production webhook is not region-pinned; real region measurements are collected before accepting the failover trade-off of explicit pinning.
