// Production Edge Function is deployed in Supabase as source-immoscout-rolling.
// Architecture: MCP newest sentinel first, persistent adaptive inventory run, max 8 partitions per invocation,
// MCP concurrency 4, price subdivision for saturated result-cap partitions, immediate insert of genuinely new listings,
// inventory membership and stable-snapshot finalization.
// IMPORTANT: keep source-immoscout-fast scheduled until rolling coverage validation passes.
export {};
