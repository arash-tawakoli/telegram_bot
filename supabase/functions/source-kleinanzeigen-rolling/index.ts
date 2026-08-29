// Production Edge Function is deployed in Supabase as source-kleinanzeigen-rolling.
// Architecture: newest-first frontier across all 7 Hamburg districts, then bounded round-robin deep pages,
// persistent source_scan_state checkpoint, source_scan_members cycle membership, write-only-on-change listings,
// and 2/5/15 minute circuit-breaker backoff on source errors.
// IMPORTANT: keep source-kleinanzeigen-fast scheduled until this worker passes full-cycle coverage validation.
export {};
