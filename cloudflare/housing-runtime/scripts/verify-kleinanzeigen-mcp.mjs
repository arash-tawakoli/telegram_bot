#!/usr/bin/env node
// Live 1:1 check of the Kleinanzeigen source against the MCP and the website.
// Read-only: three MCP calls plus six public website search pages.
//   node scripts/verify-kleinanzeigen-mcp.mjs
// 1. Every listing the MCP returns is accounted for exactly once, in order
//    (stored, or skipped with a reason), and stored facts equal the MCP's.
// 2. Each query resolves to the plain category + Hamburg search, the same
//    search as the website page /s-…/hamburg/c<category>l9409.
// 3. No ad that Kleinanzeigen itself lists as a "Gesuch" is stored.
import { fetchKleinanzeigenSource, KLEINANZEIGEN_QUERIES } from "../src/kleinanzeigen-source.js";

const HAMBURG = "9409";
const WEB = { 203: "s-wohnung-mieten", 205: "s-haus-mieten", 199: "s-auf-zeit-wg" };
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const failures = [], notes = [];
const fail = (message) => failures.push(message);

// Record the raw MCP answers and replay the very same answers to the adapter.
const recorded = new Map();
const recordingFetch = async (url, init) => {
  const response = await fetch(url, init);
  const text = await response.text();
  recorded.set(JSON.parse(init.body).params.arguments.searchCriteria, text);
  return new Response(text, { status: response.status, headers: response.headers });
};
const run = await fetchKleinanzeigenSource({ id: 2 }, recordingFetch);
const stored = new Map(run.nodes.map((node) => [node.identity, node]));

async function webIds(path) {
  const response = await fetch(`https://www.kleinanzeigen.de/${path}`, { headers: { "user-agent": UA, "accept-language": "de-DE" } });
  if (!response.ok) return null;
  return new Set([...(await response.text()).matchAll(/<article[^>]*data-adid="(\d+)"/g)].map((m) => m[1]));
}

for (const query of KLEINANZEIGEN_QUERIES) {
  const raw = recorded.get(query.criteria);
  const data = JSON.parse(raw.trimStart().startsWith("{") ? raw : raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("")).result.structuredContent;
  const rawIds = data.listings.map((l) => String(l.id));
  const outcomes = run.outcomes.filter((o) => o.categoryId === query.categoryId);
  const label = `${query.property_type} (${query.categoryId})`;

  // 1. One outcome per MCP listing, same ids, same order.
  if (JSON.stringify(outcomes.map((o) => o.id)) !== JSON.stringify(rawIds)) fail(`${label}: outcomes do not match the MCP listings 1:1`);
  for (const listing of data.listings) {
    const node = stored.get(String(listing.id));
    if (!node || node.facts.property_type !== query.property_type) continue;
    if (node.canonical_url !== `https://www.kleinanzeigen.de${new URL(listing.url).pathname}`) fail(`${label}: ${listing.id} URL differs`);
    if (node.facts.cold_rent !== (listing.priceEuros > 1 ? listing.priceEuros : null)) fail(`${label}: ${listing.id} price differs`);
  }

  // 2. The query is the plain category search for Hamburg, nothing narrower.
  const params = new URL(data.searchUrlList).searchParams;
  for (const key of ["utm_source", "utm_medium", "utm_campaign"]) params.delete(key);
  const expected = `categoryId=${query.categoryId}&locationId=${HAMBURG}`;
  if (params.toString() !== expected) fail(`${label}: MCP search is "${params}", expected "${expected}"`);

  // 3. Kleinanzeigen's own split into offers and wanted ads.
  const offers = await webIds(`${WEB[query.categoryId]}/hamburg/c${query.categoryId}l${HAMBURG}`);
  const wanted = await webIds(`${WEB[query.categoryId]}/hamburg/anzeige:gesuche/c${query.categoryId}l${HAMBURG}`);
  console.log(`\n${label}: MCP returned ${rawIds.length} of ${data.totalResults}, search ${params}`);
  for (const outcome of outcomes) {
    const web = !offers || !wanted ? "website unreachable" : wanted.has(outcome.id) ? "website: Gesuch" : offers.has(outcome.id) ? "website: Angebot" : "website: not on page 1";
    console.log(`  ${outcome.id}  ${outcome.outcome.padEnd(10)} ${web}`);
    if (outcome.outcome === "stored" && wanted?.has(outcome.id)) fail(`${label}: ${outcome.id} is a Gesuch on the website but was stored`);
    if (outcome.outcome === "wanted_ad" && offers?.has(outcome.id)) notes.push(`${outcome.id} is listed as an Angebot but reads as a request (${stored.get(outcome.id)?.facts.title ?? "skipped"})`);
  }
}

if (notes.length) console.log(`\nSkipped although listed as Angebot (text reads as a request):\n  ${notes.join("\n  ")}`);
if (failures.length) {
  console.error(`\nFAIL\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`\nOK: ${run.fetched} MCP listings, ${run.nodes.length} stored, ${run.skipped} skipped, all accounted for 1:1.`);
