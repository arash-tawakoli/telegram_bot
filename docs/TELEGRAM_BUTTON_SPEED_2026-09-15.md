# Telegram button audit and speed fix — 2026-09-15

## Button inventory

**86 distinct emitted callback-action templates. The home menu has 5 buttons.**
This counts actions, not repeated Back/Cancel placements or every user's dynamic
listing/profile/user ID. There is no fixed total of rendered button instances.
The inventory covers the deployed UI, fast entrypoint, gateway, notification
dispatcher, premium endpoint and Stripe notifications. Legacy accepted callback
aliases that are no longer emitted are excluded. Pagination literals `saved:0`
and `saved:1` are included under `saved:{page}`.

| Group | Templates | Actions |
|---|---:|---|
| Navigation | 14 | `home`, `settings`, `help`, `status`, `premium`, `portal`, `referral`, `language`, `lang:{code}`, `new`, `draft`, `cancel`, `types`, `location` |
| Profiles | 13 | `profile`, `profile:save`, view/edit/pause/resume/delete/delete-confirm by slot; five edit-field actions by slot |
| Review editing | 5 | `edit:types`, `edit:location`, `edit:rent`, `edit:rooms`, `edit:area` |
| Property selection | 4 | `type:{value}`, `type:all`, `type:clear`, `type:done` |
| Location mode | 3 | `loc:all`, `loc:boroughs`, `loc:neighborhoods` |
| Borough selection | 4 | `borough:{id}`, all/clear/done |
| Neighbourhood selection | 6 | `neighborhood:{id}`, all/clear/done/prev/next |
| Rent | 6 | `rent`, `rent:800`, `rent:1000`, `rent:1250`, `rent:2000`, `rent:custom` |
| Rooms | 5 | `rooms`, `rooms:1`, `rooms:2`, `rooms:3`, `rooms:4` |
| Area | 5 | `area`, `area:20`, `area:50`, `area:70`, `area:90` |
| Saved listings | 3 | `saved`, `saved:{page}`, `save:{listing}` |
| Application preview | 1 | `apply:{listing}` |
| Platform accounts | 5 | `platforms`, `platforms:{on/off}`, login/check/disconnect by source |
| Admin | 11 | list; user/block/unblock/delete/delete-confirm by user; five plan grants by user |
| Page indicators | 1 | `noop` |

Finite options include 4 property types, 7 boroughs, **104 neighbourhoods**, 9
languages, up to 3 profile slots and 2 platform accounts. URL buttons (offers,
maps, saved offers, checkout, billing portal, login and application destinations)
and the copy-text button are Telegram client actions, not server callbacks.
Every emitted callback goes through the same immediate acknowledgement branch.

## Findings

The active webhook is `telegram-fast?forceFunctionRegion=eu-west-1`, with
40 connections and no queued updates at audit time. Immediate webhook responses
using `answerCallbackQuery` were already deployed; stopping the spinner alone
was not a new optimization.

Of 510 callbacks recorded during the preceding seven days, all were complete;
one had multiple processing attempts. Example processing medians: home 258.1 ms
(105 samples), profile 280.1 ms (55), settings 263.4 ms (49), platforms 1934.0 ms
(17). These database lifecycle measurements exclude initial webhook startup,
network transit before claim creation and final device rendering. Some records
include queue delay: two property clicks took 181 and 234 seconds from event
creation to completion, despite only one successful claim attempt.

The per-user database lease rejects overlapping updates as busy. Previously the
acknowledged callback then waited for a scheduled retry, which considers pending
events older than one minute. Ordinary detail callbacks also invoked a second
Edge Function over HTTP and authenticated twice before doing useful work.

## Minimal fix

- Extract the existing authenticated UI request handler into `handler.ts`;
  keep `index.ts` as the serving entrypoint.
- Call that same handler directly from `telegram-fast` for detail/fallback
  actions. This removes one Edge HTTP invocation and its duplicate authentication
  lookup while retaining the existing optimized main-menu paths.
- For callback claims only, retry busy responses every 100 ms for at most two
  seconds before falling back to existing durable inbox recovery. Successful
  claims, completed duplicates, unauthorized requests and RPC errors do not retry.

No database migration, new dependency, webhook change or speculative cache was
needed. Existing authorization, per-user serialization, update deduplication,
attempt fencing, premium checks, translations and state-write ordering remain.

## Verification and deployment

- **160 tests passed**, including direct in-process forwarding, authentication,
  immediate acknowledgements while work is blocked, busy-to-success,
  busy-to-duplicate, bounded busy retries, failure handling and application guards.
- Both production bundles passed syntax checks.
- Deployed `telegram-ui` **v108** and `telegram-fast` **v7**. All 11 files in
  each bundle matched the submitted files byte-for-byte after retrieval.
- Both live endpoints rejected unauthenticated requests with HTTP 401.
- Completed home/platform/property callbacks replayed against the actual webhook
  returned HTTP 200 with `answerCallbackQuery` (request IDs 15222–15224).
  Replays intentionally use completed updates to avoid changing user messages.
- Runtime verification passed for 28 bundle structures and 167 migrations.
  It reports 15 byte-hash warnings: existing source/deployment differences,
  including the preserved live helper files now also bundled into telegram-fast.
  Source and deployed hashes are recorded separately; unmodified live helpers
  were preserved rather than replaced by a repository snapshot.

This removes a real network hop and avoids the minute-based retry for short
overlaps. It does **not** prove a new phone-to-screen latency percentile: no new
user clicks or messages were generated. Cold starts, Telegram/network latency,
rate limits, long platform operations and contention exceeding two seconds can
still delay completed screen updates. Literal instantaneous completion for every
button cannot be guaranteed by a backend-only change.
