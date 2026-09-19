# Pending crawl-budget rollout

Status: tested in the repository; not deployed to Supabase.

Preserve source-worker v72 semantics and all fast-lane queries. This change reduces ImmoScout coverage to one partition, prevents same-batch fast records being overwritten by coverage, bounds Wunderflats deep pagination to eight pages and preserves complete-cycle state.

Expected request budgets (not billing measurements): Scout normal queries 14 to 8, plus two MCP handshake requests in both cases. Wunderflats first page plus at most eight deep pages per run. No Kleinanzeigen polling change.

Trade-off: catalogue/full-inventory sweeps take more runs. Wunderflats is relevance-sorted, so deeper-page discovery may be later. Verify cursor progression, completion and new-offer recall; do not present this as latency-neutral.

Rollout requires the complete source-worker bundle, its deno.json/import map and all relative dependencies, preserving existing custom internal authentication. Do not use partial-file deployment or replace the complete bundle with an unauthenticated loader. Verify the published function version, dry run, normal queue progress and error/latency counters before marking production complete. Update recorded deployment hashes only after measuring the deployed files.
