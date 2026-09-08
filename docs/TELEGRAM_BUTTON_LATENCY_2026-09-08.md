# Telegram button latency — 2026-09-08

## Implemented and deployed

`telegram-ui` v62 uses the existing `prepare_telegram_update` RPC instead of separate claim, user read, user write and subscription read. Instrumented original and modified handlers counted 4 versus 1 preparation requests. Empty callback acknowledgements run via `EdgeRuntime.waitUntil` alongside menu updates. Save/admin result acknowledgements remain awaited after their mutations. Auth, duplicate/busy handling, lease completion and premium overrides are covered by tests. Main menu fast routing remains unchanged.

89 tests passed. Live v62 retrieved and all seven files compared byte-for-byte with repository files. Deployment cutoff: 2026-09-08 14:52:37.281 UTC.

## Actual production measurements

Read directly from `public.bot_events` on 2026-09-08, using completed callback events with `processing_attempt = 1`. Duration is `processing_at - created_at`: initial event creation in the claim transaction through `finish_telegram_update`. The finish function sets `processing_at = now()` after the handler completes. This includes subsequent processing and the successful Telegram API response for ordinary callback edits. It excludes the user's network, initial webhook/function startup before the event is created, and Telegram's final device rendering.

| Observed group | Samples | Median | P95 |
|---|---:|---:|---:|
| Before v62, since 00:00 UTC | 24 | 435.0 ms | 617.8 ms |
| After v62 | 50 | 265.2 ms | 549.3 ms |

Latest completed event: 17:20:38 UTC. This is historical real traffic, not 50 artificially generated new clicks. The overall observed median is 169.8 ms lower (39%). Different button mixes and small samples prevent attributing that entire difference solely to the change.

Selected action families:

| Action | Before n / median | After n / median |
|---|---:|---:|
| Home | 8 / 256.6 ms | 3 / 241.1 ms |
| Settings | 4 / 368.5 ms | 2 / 241.4 ms |
| Profile family | 3 / 573.6 ms | 6 / 372.1 ms |
| Save | 3 / 565.3 ms | 2 / 325.5 ms |
| Help | 2 / 332.7 ms | 1 / 540.7 ms |

The help sample demonstrates that not every individual callback became faster. No blanket sub-100-ms or phone-to-screen guarantee is made.

## Direct live verification

Two already-completed real callback payloads (`home` and `area:70`) were submitted to the actual configured webhook entrypoint, `telegram-fast?forceFunctionRegion=eu-west-1`, using the existing webhook authentication. Both returned HTTP 200 and `{ok:true,duplicate:true}`. Supabase HTTP request IDs: 166465 and 166466. This exercises both the fast routing and detail fallback path while verifying that completed actions are not repeated. It does not measure a new menu render; no user state, message, profile or saved listing was intentionally changed by these replays.

The timestamps in `net._http_response.created` were not used as HTTP latency measurements because they are not reliable per-request completion timestamps. Production callback timings above come from the application's actual processing lifecycle instead.

Regional invocation was checked against the [Supabase regional invocation documentation](https://supabase.com/docs/guides/functions/regional-invocation). The existing pinned entrypoint and `x-region` forwarding already match the documented mechanism; no unmeasured region change was applied.
