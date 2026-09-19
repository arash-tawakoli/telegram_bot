# Crawl-budget rollout: deployed and merged

Production: source-worker version 73, deployed 2026-09-19 at 17:37:52 UTC. PR #32 merged into main as e44e6b84f131024274b917777a4dbff4e86f0a2e on the same day.

The production worker keeps all normal fast discovery queries. Scout coverage is one partition per normal run; IDs already handled in the same fast batch are not overwritten by coverage. Request accounting includes two MCP session calls: the previous normal budget was 16 HTTP calls, now 10. Wunderflats keeps page one and at most eight cursor pages, and indexes hrefs once. Catalogue cycle identity/start/last completion are preserved across partial runs. Kleinanzeigen polling and all listing newness guards are unchanged.

## Observed production evidence

- Scout, 17:45:03 UTC: successful crawl, requests=10, session_requests=2, coverage_partitions=1, fresh_lane_items=60, map_errors=0.
- Wunderflats, 17:45:22 UTC: successful completion, enumerated=reported_total=1375, pages_total=46, pages_checked=9, deep_page_budget=8, coverage_errors=[]. This cycle began before deployment; it is evidence of compatible continuation and completion, not a full fresh-cycle latency benchmark.
- At 18:16 UTC Scout, Kleinanzeigen, Wunderflats, Hamburger Wohnen, EBV Harburg and Finkenwaerder had successful post-deployment activity without consecutive errors. No newness-invalid pending new listings were present. Existing uncertain Telegram outcomes were not retried.

Observed artifact: `1869144f536bf2e0968adc5ecf7a417bdaa5792815520bfb1270270bea0c2bb8`. Entry: `index.js`; import map: `deno.json`; existing custom internal authentication remains in place. This is a compiled multi-file ES module bundle, not a claim that older TypeScript per-file deployment hashes match it byte-for-byte.

## Trade-offs

Wunderflats is relevance sorted. Smaller page budgets can delay discovery on deeper pages. The completion checks above do not prove unchanged recall or a specific CPU/billing saving. No slow-polling policy was applied to other sources. A source-specific long-run comparison requires subsequent real observations, not synthetic successful applications or backdated listings.
