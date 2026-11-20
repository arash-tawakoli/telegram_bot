#!/usr/bin/env node
// Live check that the price-range sweep reaches every listing the ImmoScout24 MCP reports.
// Read-only: about 130-250 MCP search calls plus one map call, no database.
//   node scripts/verify-immoscout-coverage.mjs [hamburg|berlin|sh | source id 1|72|69] [Wohnung]
// Exits 1 when coverage is below 100% or any leaf was incomplete.
import { callTool, scoutRegion, normalizeImmoScoutEntry } from "../src/immoscout-source.js";
import { sweepLeaves, MCP_PAGE_SIZE } from "../src/immoscout-sweep.js";

const REGIONS = { hamburg: 1, berlin: 72, sh: 69, "schleswig-holstein": 69 };
const regionArg = String(process.argv[2] || "hamburg").toLowerCase();
const type = process.argv[3] || "Wohnung";
const source = { id: REGIONS[regionArg] ?? Number(regionArg), family: "immoscout24" };
const region = scoutRegion(source);
const base = `${type === "Wohnung" ? "Wohnung mieten" : type} in ${region}`;
const search = query => callTool("property_search_de", query);
const started = Date.now();

const totalStart = (await search(base)).total;
// No per-invocation budget here: walk the whole market in one go, however many calls it takes.
const sweep = await sweepLeaves({ search, base, maxCalls: Infinity, deadline: Infinity });
const totalEnd = (await search(base)).total;
const ids = new Set([...sweep.entries.values()].map(entry => normalizeImmoScoutEntry(entry, source.id, type)?.identity).filter(Boolean));
const rawIds = new Set(sweep.entries.keys());
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const coverage = totalStart ? rawIds.size / totalStart : 0;
const incomplete = sweep.leaves.filter(leaf => !leaf.complete);

console.log(JSON.stringify({
  source_id: source.id, query: base, mcp_total_start: totalStart, mcp_total_end: totalEnd, found: rawIds.size,
  normalized: ids.size, coverage: `${(coverage * 100).toFixed(2)}%`, calls: sweep.calls + 2,
  leaves: sweep.leaves.length, incomplete_leaves: incomplete.length, errors: sweep.errors,
  truncated: sweep.truncated, seconds: Number(seconds), page_size: MCP_PAGE_SIZE,
}));
for (const leaf of incomplete.slice(0, 10)) console.log("incomplete leaf", JSON.stringify(leaf));
const ok = (rawIds.size === totalStart || rawIds.size === totalEnd) && sweep.complete;
console.log(ok ? "OK: 100% of the MCP total was found" : "FAIL: coverage below 100%");
process.exit(ok ? 0 : 1);
