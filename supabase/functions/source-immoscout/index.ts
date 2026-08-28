import "jsr:@supabase/functions-js@2.4.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const ADMIN_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SOURCE_ID = 1;
const MCP_URL = "https://app.chatgpt.immobilienscout24.de/v2/mcp";
const MCP_PROTOCOL = "2025-06-18";
const MCP_LABEL = "ImmoScout24 official ChatGPT MCP property_search";
const COVERAGE_STRATEGY = "adaptive_inventory_snapshots_v1";
const FAST_SENTINEL_QUERY = "Wohnungen zur Miete in Hamburg, neueste Inserate";
const MCP_CONCURRENCY = 8;
const MCP_TIMEOUT_MS = 9000;
const MCP_RESULT_CAP = 25;
const INVENTORY_BATCH = 24;
const MAX_PARTITION_DEPTH = 6;

const ALLOWED_TYPES = ["Wohnung", "Haus", "WG", "Tauschwohnung"] as const;
type PropertyType = typeof ALLOWED_TYPES[number];
type Source = { id: number; name: string; warmed_up: boolean; consecutive_failures: number };
type Profile = { id: string; user_id: string; property_types: string[] | null; max_warm_rent: number | null; min_rooms: number | null; min_area_sqm: number | null; districts: string[] | null; location_mode: string | null; boroughs: string[] | null; neighborhoods: string[] | null; furnished_preference: string | null; wbs_only: boolean | null; move_in_from: string | null };
type SearchJob = { query: string; profileIds: string[]; sentinel: boolean; lane: "fast" | "inventory"; partition?: InventoryPartition };
type ListingCandidate = { key: string; url: string; title: string; address: string | null; district: string | null; postal: string | null; rooms: number | null; area: number | null; propertyType: string; image: string | null; raw: Record<string, unknown> };
type Discovery = { exactProfiles: Set<string>; fast: boolean; inventory: boolean };
type InventoryPartition = { id: string; run_id: string; parent_id: string | null; partition_key: string; location_kind: "city" | "borough" | "neighborhood"; location_name: string; property_type: PropertyType; min_price: number | string | null; max_price: number | string | null; depth: number; attempts: number };
type SearchResult = { job: SearchJob; entries: any[]; total: number | null };

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    if (typeof e.message === "string" && e.message) return e.message;
    try { return JSON.stringify(error); } catch { return String(error); }
  }
  return String(error);
}

async function secret(name: string): Promise<string> {
  const { data, error } = await db.rpc("get_bot_secret", { secret_name: name });
  if (error || !data) throw new Error(error?.message || `secret ${name} unavailable`);
  return String(data);
}

function num(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/\s/g, "").replace(/[^\d.,-]/g, "");
  if (!normalized) return null;
  let s = normalized;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function propertyType(text: string): string {
  if (/tauschwohnung|wohnungstausch|tausche/i.test(text)) return "Tauschwohnung";
  if (/\bwg\b|wg-zimmer|zimmer zur miete/i.test(text)) return "WG";
  if (/\bhaus\b|reihenhaus|einfamilienhaus|doppelhaus|villa/i.test(text)) return "Haus";
  return "Wohnung";
}

function photoUrl(entry: any): string | null {
  const raw = Array.isArray(entry?.titlePictureUrls) ? entry.titlePictureUrls[0] : null;
  const href = firstString(raw?.href, raw?.url, entry?.titlePictureUrl, entry?.imageUrl);
  if (!href || !/^https?:\/\//i.test(href)) return null;
  return href.replace(/%WIDTH%/g, "1200").replace(/%HEIGHT%/g, "800");
}

function normalizeEntry(entry: any, query: string): ListingCandidate | null {
  if (!entry || typeof entry !== "object") return null;
  const key = firstString(entry.exposedId, entry.exposeId, entry.realEstateId, entry.id);
  if (!key) return null;
  const url = firstString(entry.exposeUrl, entry.url) || `https://www.immobilienscout24.de/expose/${encodeURIComponent(key)}`;
  const addressObj = entry.address && typeof entry.address === "object" ? entry.address : {};
  const postal = firstString(addressObj.postcode, addressObj.postalCode, entry.postcode, entry.postalCode);
  const city = firstString(addressObj.city, entry.city) || "Hamburg";
  const district = firstString(addressObj.quarter, addressObj.district, entry.quarter, entry.district);
  const street = firstString(addressObj.street, entry.street);
  const houseNumber = firstString(addressObj.houseNumber, entry.houseNumber);
  const streetLine = street ? `${street}${houseNumber ? ` ${houseNumber}` : ""}` : null;
  const address = streetLine ? `${streetLine}, ${postal ? `${postal} ` : ""}${city}` : null;
  const title = firstString(entry.title, entry.headline, entry.name) || `ImmobilienScout24 Expose ${key}`;
  const type = propertyType(`${firstString(entry.propertyType, entry.realEstateType, entry.type) || ""} ${title}`);
  const price = entry.price && typeof entry.price === "object" ? entry.price : null;
  return {
    key, url, title, address, district, postal,
    rooms: num(entry.rooms ?? entry.numberOfRooms ?? entry.roomCount),
    area: num(entry.size ?? entry.livingSpace ?? entry.area),
    propertyType: type,
    image: photoUrl(entry),
    raw: { parser: "immoscout24_official_chatgpt_mcp", mcp_query: query, price: price || entry.price || null, address: entry.address || null, entry },
  };
}

function candidateScore(item: ListingCandidate): number {
  return (item.image ? 4 : 0) + (item.address ? 3 : 0) + (item.postal ? 2 : 0) + (item.rooms != null ? 1 : 0) + (item.area != null ? 1 : 0);
}

function parseMcpResponse(body: string): any {
  const trimmed = body.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed);
  const events: any[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try { events.push(JSON.parse(data)); } catch { }
  }
  return events.at(-1) || null;
}

async function mcpPost(payload: unknown): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
  try {
    const response = await fetch(MCP_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json, text/event-stream", "user-agent": "TraumWohnungHamburgBot/10.0 (+https://traumwohnunghamburg.de)", "mcp-protocol-version": MCP_PROTOCOL },
      body: JSON.stringify(payload), signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${body.slice(0, 500)}`);
    const parsed = parseMcpResponse(body);
    if (parsed?.error) throw new Error(parsed.error.message || JSON.stringify(parsed.error));
    return parsed;
  } finally { clearTimeout(timer); }
}

async function initializeMcp(): Promise<void> {
  const init = await mcpPost({ jsonrpc: "2.0", id: `init-${crypto.randomUUID()}`, method: "initialize", params: { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: "traumwohnung-hamburg", version: "10.0.0" } } });
  if (!firstString(init?.result?.protocolVersion)) throw new Error("ImmoScout MCP initialize returned no protocol version");
  await mcpPost({ jsonrpc: "2.0", method: "notifications/initialized" });
}

function locationText(profile: Profile): string {
  if (profile.location_mode === "neighborhoods" && profile.neighborhoods?.length) return profile.neighborhoods.map((x) => `Hamburg-${x}`).join(" oder ");
  if (profile.location_mode === "boroughs" && profile.boroughs?.length) return profile.boroughs.map((x) => `Hamburg-${x}`).join(" oder ");
  const legacy = (profile.districts || []).filter((x) => x && x.toLowerCase() !== "ganz hamburg");
  if (legacy.length) return legacy.map((x) => `Hamburg-${x}`).join(" oder ");
  return "Hamburg";
}

function typesForProfile(profile: Profile): PropertyType[] {
  const source = (profile.property_types || []).filter((x): x is PropertyType => ALLOWED_TYPES.includes(x as PropertyType));
  return source.length ? [...new Set(source)] : ["Wohnung"];
}

function buildProfileQuery(profile: Profile): string {
  const parts: string[] = [];
  parts.push(typesForProfile(profile).join(" oder "), "zur Miete", `in ${locationText(profile)}`);
  if (profile.max_warm_rent != null) parts.push(`maximal ${Math.round(Number(profile.max_warm_rent))} Euro monatlich`);
  if (profile.min_rooms != null && Number(profile.min_rooms) > 0) parts.push(`mindestens ${Number(profile.min_rooms)} Zimmer`);
  if (profile.min_area_sqm != null && Number(profile.min_area_sqm) > 0) parts.push(`mindestens ${Number(profile.min_area_sqm)} Quadratmeter`);
  if (profile.wbs_only) parts.push("WBS erforderlich");
  if (profile.furnished_preference === "yes") parts.push("moebliert");
  if (profile.furnished_preference === "no") parts.push("unmoebliert");
  if (profile.move_in_from) parts.push(`verfuegbar ab ${profile.move_in_from}`);
  parts.push("neueste Inserate");
  return parts.join(", ");
}

function typePhrase(type: PropertyType): string {
  if (type === "WG") return "WG-Zimmer zur Miete";
  if (type === "Tauschwohnung") return "Tauschwohnung";
  return `${type} zur Miete`;
}

function buildPartitionQuery(partition: InventoryPartition): string {
  const where = partition.location_kind === "city" ? "Hamburg" : `Hamburg-${partition.location_name}`;
  const parts = [typePhrase(partition.property_type), `in ${where}`];
  const min = num(partition.min_price);
  const max = num(partition.max_price);
  if (min != null && max != null) parts.push(`zwischen ${Math.round(min)} und ${Math.round(max)} Euro monatlich`);
  else if (max != null) parts.push(`maximal ${Math.round(max)} Euro monatlich`);
  else if (min != null) parts.push(`ab ${Math.round(min)} Euro monatlich`);
  parts.push("neueste Inserate");
  return parts.join(", ");
}

async function loadFastJobs(): Promise<SearchJob[]> {
  const { data: users, error: usersError } = await db.from("bot_users").select("id").eq("is_active", true);
  if (usersError) throw new Error(`bot_users: ${errorText(usersError)}`);
  const activeUsers = new Set((users || []).map((row: any) => String(row.id)));
  const { data: profileRows, error: profilesError } = await db.from("search_profiles").select("id,user_id,property_types,max_warm_rent,min_rooms,min_area_sqm,districts,location_mode,boroughs,neighborhoods,furnished_preference,wbs_only,move_in_from").eq("is_active", true);
  if (profilesError) throw new Error(`search_profiles: ${errorText(profilesError)}`);
  const profiles = ((profileRows || []) as Profile[]).filter((p) => activeUsers.has(String(p.user_id)));
  const map = new Map<string, { ids: Set<string>; sentinel: boolean }>();
  for (const profile of profiles) {
    const query = buildProfileQuery(profile);
    const current = map.get(query) || { ids: new Set<string>(), sentinel: query === FAST_SENTINEL_QUERY };
    current.ids.add(String(profile.id));
    map.set(query, current);
  }
  const sentinel = map.get(FAST_SENTINEL_QUERY) || { ids: new Set<string>(), sentinel: true };
  sentinel.sentinel = true;
  map.set(FAST_SENTINEL_QUERY, sentinel);
  return [...map.entries()].map(([query, v]) => ({ query, profileIds: [...v.ids], sentinel: v.sentinel, lane: "fast" as const }));
}

function extractResult(json: any): { entries: any[]; total: number | null } {
  const structured = json?.result?.structuredContent || json?.result?.structured_content || {};
  return { entries: Array.isArray(structured.entries) ? structured.entries : [], total: num(structured.total) };
}

async function searchJob(job: SearchJob): Promise<SearchResult> {
  const json = await mcpPost({ jsonrpc: "2.0", id: `search-${crypto.randomUUID()}`, method: "tools/call", params: { name: "property_search", arguments: { query: job.query } } });
  return { job, ...extractResult(json) };
}

async function searchMany(jobs: SearchJob[]): Promise<{ results: SearchResult[]; errors: string[] }> {
  const results: SearchResult[] = [];
  const errors: string[] = [];
  for (let i = 0; i < jobs.length; i += MCP_CONCURRENCY) {
    const settled = await Promise.allSettled(jobs.slice(i, i + MCP_CONCURRENCY).map(searchJob));
    for (const result of settled) {
      if (result.status === "rejected") errors.push(errorText(result.reason));
      else results.push(result.value);
    }
  }
  return { results, errors };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function hadMcpSuccess(): Promise<boolean> {
  const { data, error } = await db.from("crawl_runs").select("id").eq("source_id", SOURCE_ID).eq("success", true).eq("connector_label", MCP_LABEL).limit(1);
  if (error) throw new Error(`crawl_runs lookup: ${errorText(error)}`);
  return Boolean(data?.length);
}

async function hadStableInventory(): Promise<boolean> {
  const { data, error } = await db.from("immoscout_inventory_runs").select("id").eq("status", "complete").eq("crawl_complete", true).eq("snapshot_stable", true).limit(1);
  if (error) throw new Error(`inventory baseline lookup: ${errorText(error)}`);
  return Boolean(data?.length);
}

function mergeCandidate(items: Map<string, ListingCandidate>, discovery: Map<string, Discovery>, candidate: ListingCandidate, job: SearchJob) {
  const previous = items.get(candidate.key);
  if (!previous || candidateScore(candidate) > candidateScore(previous)) items.set(candidate.key, candidate);
  const d = discovery.get(candidate.key) || { exactProfiles: new Set<string>(), fast: false, inventory: false };
  if (job.lane === "fast") d.fast = true;
  if (job.lane === "inventory") d.inventory = true;
  for (const profileId of job.profileIds) d.exactProfiles.add(profileId);
  discovery.set(candidate.key, d);
}

async function existingEligibility(keys: string[]): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  for (let i = 0; i < keys.length; i += 150) {
    const { data, error } = await db.from("listings").select("source_listing_key,enrichment_delivery_eligible").eq("source_id", SOURCE_ID).in("source_listing_key", keys.slice(i, i + 150));
    if (error) throw new Error(`listings lookup: ${errorText(error)}`);
    for (const row of data || []) result.set(String(row.source_listing_key), Boolean(row.enrichment_delivery_eligible));
  }
  return result;
}

async function queueNewExactListings(newKeys: string[], discovery: Map<string, Discovery>, skipAll: boolean): Promise<number> {
  if (skipAll || !newKeys.length) return 0;
  let queued = 0;
  for (let i = 0; i < newKeys.length; i += 150) {
    const { data, error } = await db.from("listings").select("id,source_listing_key,cross_source_hash").eq("source_id", SOURCE_ID).in("source_listing_key", newKeys.slice(i, i + 150));
    if (error) throw new Error(`new listings lookup: ${errorText(error)}`);
    for (const listing of data || []) {
      const d = discovery.get(String(listing.source_listing_key));
      if (!d?.exactProfiles.size) continue;
      for (const profileId of d.exactProfiles) {
        const { error: insertError } = await db.from("delivery_events").insert({ profile_id: profileId, listing_id: listing.id, dedupe_key: listing.cross_source_hash || `${SOURCE_ID}:${listing.source_listing_key}`, status: "pending", delivery_format: "photo_card" });
        if (!insertError) queued++;
        else if (insertError.code !== "23505") throw new Error(`delivery_events: ${errorText(insertError)}`);
      }
    }
  }
  return queued;
}

async function ingest(items: Map<string, ListingCandidate>, discovery: Map<string, Discovery>, source: Source, baselineComplete: boolean, connectorHadSuccess: boolean): Promise<{ newKeys: string[]; queued: number }> {
  if (!items.size) return { newKeys: [], queued: 0 };
  const keys = [...items.keys()];
  const oldEligibility = await existingEligibility(keys);
  const oldKeys = new Set(oldEligibility.keys());
  const rows: any[] = [];
  for (const item of items.values()) {
    const d = discovery.get(item.key) || { exactProfiles: new Set<string>(), fast: false, inventory: false };
    const historicalCoverageOnly = !oldKeys.has(item.key) && d.inventory && !d.fast && !d.exactProfiles.size && !baselineComplete;
    rows.push({
      source_id: SOURCE_ID,
      source_listing_key: item.key,
      external_id: item.key,
      canonical_url: item.url,
      title: item.title,
      address: item.address,
      district: item.district,
      postal_code: item.postal,
      city: "Hamburg",
      warm_rent: null,
      cold_rent: null,
      rooms: item.rooms,
      area_sqm: item.area,
      property_type: item.propertyType,
      image_url: item.image,
      cross_source_hash: await sha256(`${item.key}|${item.postal || ""}|${item.rooms ?? ""}|${item.area ?? ""}`),
      raw: { ...item.raw, coverage_strategy: COVERAGE_STRATEGY, discovery_lane: d.fast ? "fast" : "inventory", discovered_by_exact_profile: Boolean(d.exactProfiles.size), discovered_by_coverage: d.inventory },
      last_seen_at: new Date().toISOString(),
      is_active: true,
      enrichment_delivery_eligible: oldKeys.has(item.key) ? (oldEligibility.get(item.key) ?? true) : !historicalCoverageOnly,
    });
  }
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await db.from("listings").upsert(rows.slice(i, i + 100), { onConflict: "source_id,source_listing_key" });
    if (error) throw new Error(`listings upsert: ${errorText(error)}`);
  }
  const newKeys = keys.filter((key) => !oldKeys.has(key));
  const queued = await queueNewExactListings(newKeys, discovery, !connectorHadSuccess || !source.warmed_up);
  return { newKeys, queued };
}

async function addInventoryMembers(runId: string, entries: { external_id: string; property_type: string | null }[]) {
  if (!entries.length) return;
  const unique = new Map<string, { run_id: string; external_id: string; property_type: string | null }>();
  for (const entry of entries) unique.set(entry.external_id, { run_id: runId, ...entry });
  const rows = [...unique.values()];
  for (let i = 0; i < rows.length; i += 250) {
    const { error } = await db.from("immoscout_inventory_members").upsert(rows.slice(i, i + 250), { onConflict: "run_id,external_id" });
    if (error) throw new Error(`inventory members: ${errorText(error)}`);
  }
}

function priceChildren(partition: InventoryPartition): { min: number | null; max: number | null; label: string }[] {
  if (partition.depth >= MAX_PARTITION_DEPTH) return [];
  const min = num(partition.min_price);
  const max = num(partition.max_price);
  if (min == null && max == null) {
    return [
      { min: null, max: 750, label: "le750" },
      { min: 750, max: 1000, label: "750-1000" },
      { min: 1000, max: 1250, label: "1000-1250" },
      { min: 1250, max: 1500, label: "1250-1500" },
      { min: 1500, max: 2000, label: "1500-2000" },
      { min: 2000, max: 3000, label: "2000-3000" },
      { min: 3000, max: 5000, label: "3000-5000" },
      { min: 5000, max: null, label: "ge5000" },
    ];
  }
  if (min == null && max != null) {
    if (max <= 100) return [];
    const mid = Math.round(max / 2);
    return [{ min: null, max: mid, label: `le${mid}` }, { min: mid, max, label: `${mid}-${Math.round(max)}` }];
  }
  if (min != null && max == null) {
    const mid = Math.round(min + 2500);
    return [{ min, max: mid, label: `${Math.round(min)}-${mid}` }, { min: mid, max: null, label: `ge${mid}` }];
  }
  if (min != null && max != null) {
    if (max - min <= 50) return [];
    const mid = Math.round((min + max) / 2);
    return [{ min, max: mid, label: `${Math.round(min)}-${mid}` }, { min: mid, max, label: `${mid}-${Math.round(max)}` }];
  }
  return [];
}

async function finishPartition(partition: InventoryPartition, result: SearchResult | null, error: string | null) {
  if (error) {
    const terminal = Number(partition.attempts || 0) >= 3;
    const { error: updateError } = await db.from("immoscout_inventory_partitions").update({ status: terminal ? "error" : "queued", last_error: error.slice(0, 1000), finished_at: terminal ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", partition.id);
    if (updateError) throw new Error(`partition retry: ${errorText(updateError)}`);
    return { status: terminal ? "error" : "queued", children: 0 };
  }
  if (!result) throw new Error("partition result missing");
  const saturated = result.total != null ? result.total > result.entries.length : result.entries.length >= MCP_RESULT_CAP;
  if (saturated) {
    const children = priceChildren(partition);
    if (children.length) {
      const childRows = children.map((child) => ({
        run_id: partition.run_id,
        parent_id: partition.id,
        partition_key: `${partition.partition_key}:d${partition.depth + 1}:${child.label}`,
        location_kind: partition.location_kind,
        location_name: partition.location_name,
        property_type: partition.property_type,
        min_price: child.min,
        max_price: child.max,
        depth: partition.depth + 1,
        status: "queued",
      }));
      const { error: childError } = await db.from("immoscout_inventory_partitions").upsert(childRows, { onConflict: "run_id,partition_key", ignoreDuplicates: true });
      if (childError) throw new Error(`partition children: ${errorText(childError)}`);
      const { error: updateError } = await db.from("immoscout_inventory_partitions").update({ status: "split", result_count: result.entries.length, reported_total: result.total, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", partition.id);
      if (updateError) throw new Error(`partition split: ${errorText(updateError)}`);
      return { status: "split", children: childRows.length };
    }
    const { error: updateError } = await db.from("immoscout_inventory_partitions").update({ status: "saturated", result_count: result.entries.length, reported_total: result.total, finished_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: "result cap remained saturated at maximum partition depth" }).eq("id", partition.id);
    if (updateError) throw new Error(`partition saturated: ${errorText(updateError)}`);
    return { status: "saturated", children: 0 };
  }
  const { error: updateError } = await db.from("immoscout_inventory_partitions").update({ status: "done", result_count: result.entries.length, reported_total: result.total, finished_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null }).eq("id", partition.id);
  if (updateError) throw new Error(`partition done: ${errorText(updateError)}`);
  return { status: "done", children: 0 };
}

async function inventoryStatus(runId: string): Promise<Record<string, number>> {
  const { data, error } = await db.from("immoscout_inventory_partitions").select("status").eq("run_id", runId);
  if (error) throw new Error(`inventory status: ${errorText(error)}`);
  const counts: Record<string, number> = { queued: 0, processing: 0, done: 0, split: 0, saturated: 0, error: 0 };
  for (const row of data || []) counts[String(row.status)] = (counts[String(row.status)] || 0) + 1;
  return counts;
}

async function run(source: Source) {
  const startedAt = new Date().toISOString();
  const { data: runRow, error: runInsertError } = await db.from("crawl_runs").insert({ source_id: SOURCE_ID, started_at: startedAt }).select("id").single();
  if (runInsertError) throw new Error(`crawl_runs insert: ${errorText(runInsertError)}`);
  const crawlRunId = String(runRow.id);
  try {
    const [connectorHadSuccess, baselineComplete, fastJobs] = await Promise.all([hadMcpSuccess(), hadStableInventory(), loadFastJobs()]);
    await initializeMcp();

    const fastSearch = await searchMany(fastJobs);
    const fastItems = new Map<string, ListingCandidate>();
    const discovery = new Map<string, Discovery>();
    let startReportedTotal: number | null = null;
    for (const result of fastSearch.results) {
      if (result.job.sentinel) startReportedTotal = result.total;
      for (const entry of result.entries) {
        const candidate = normalizeEntry(entry, result.job.query);
        if (candidate) mergeCandidate(fastItems, discovery, candidate, result.job);
      }
    }
    if (!fastItems.size && fastSearch.errors.length === fastJobs.length) throw new Error(fastSearch.errors.join(" | "));

    const fastIngest = await ingest(fastItems, discovery, source, baselineComplete, connectorHadSuccess);

    const { data: inventoryRunIdRaw, error: startError } = await db.rpc("start_immoscout_inventory", { p_start_total: startReportedTotal, p_catchup_of: null });
    if (startError || !inventoryRunIdRaw) throw new Error(`start inventory: ${errorText(startError || "no run id")}`);
    const inventoryRunId = String(inventoryRunIdRaw);
    await addInventoryMembers(inventoryRunId, [...fastItems.values()].map((item) => ({ external_id: item.key, property_type: item.propertyType })));

    const { data: claimedRaw, error: claimError } = await db.rpc("claim_immoscout_inventory_partitions", { p_run_id: inventoryRunId, p_qty: INVENTORY_BATCH });
    if (claimError) throw new Error(`claim inventory: ${errorText(claimError)}`);
    const claimed = (claimedRaw || []) as InventoryPartition[];
    const inventoryJobs: SearchJob[] = claimed.map((partition) => ({ query: buildPartitionQuery(partition), profileIds: [], sentinel: false, lane: "inventory", partition }));
    const inventorySearch = await searchMany(inventoryJobs);
    const resultByPartition = new Map<string, SearchResult>();
    for (const result of inventorySearch.results) if (result.job.partition) resultByPartition.set(result.job.partition.id, result);

    const inventoryItems = new Map<string, ListingCandidate>();
    let splitChildren = 0;
    const inventoryErrors: string[] = [];
    for (const partition of claimed) {
      const result = resultByPartition.get(partition.id) || null;
      if (!result) {
        const message = inventorySearch.errors.shift() || "inventory search failed";
        inventoryErrors.push(message);
        await finishPartition(partition, null, message);
        continue;
      }
      const members: { external_id: string; property_type: string | null }[] = [];
      for (const entry of result.entries) {
        const candidate = normalizeEntry(entry, result.job.query);
        if (!candidate) continue;
        mergeCandidate(inventoryItems, discovery, candidate, result.job);
        members.push({ external_id: candidate.key, property_type: partition.property_type });
      }
      await addInventoryMembers(inventoryRunId, members);
      const outcome = await finishPartition(partition, result, null);
      splitChildren += outcome.children;
    }

    const inventoryIngest = await ingest(inventoryItems, discovery, source, baselineComplete, connectorHadSuccess);
    let statusCounts = await inventoryStatus(inventoryRunId);
    let finalization: any = null;
    let catchupRunId: string | null = null;

    if ((statusCounts.queued || 0) === 0 && (statusCounts.processing || 0) === 0) {
      const endJob: SearchJob = { query: FAST_SENTINEL_QUERY, profileIds: [], sentinel: true, lane: "fast" };
      let endReportedTotal: number | null = null;
      try {
        const endResult = await searchJob(endJob);
        endReportedTotal = endResult.total;
        const endItems = new Map<string, ListingCandidate>();
        const endDiscovery = new Map<string, Discovery>();
        for (const entry of endResult.entries) {
          const candidate = normalizeEntry(entry, endResult.job.query);
          if (candidate) mergeCandidate(endItems, endDiscovery, candidate, endResult.job);
        }
        await addInventoryMembers(inventoryRunId, [...endItems.values()].map((item) => ({ external_id: item.key, property_type: item.propertyType })));
        await ingest(endItems, endDiscovery, source, baselineComplete, connectorHadSuccess);
      } catch (error) {
        inventoryErrors.push(`end sentinel: ${errorText(error)}`);
      }

      const { data, error: finalizeError } = await db.rpc("finalize_immoscout_inventory", { p_run_id: inventoryRunId, p_end_total: endReportedTotal });
      if (finalizeError) throw new Error(`finalize inventory: ${errorText(finalizeError)}`);
      finalization = data;
      if (finalization?.status === "unstable") {
        const { data: catchup, error: catchupError } = await db.rpc("start_immoscout_inventory", { p_start_total: endReportedTotal, p_catchup_of: inventoryRunId });
        if (catchupError) throw new Error(`start catchup inventory: ${errorText(catchupError)}`);
        catchupRunId = catchup ? String(catchup) : null;
      }
      await db.rpc("prune_immoscout_inventory", { p_keep_days: 7 });
      statusCounts = await inventoryStatus(inventoryRunId);
    }

    const needsContinuation = finalization == null || Boolean(catchupRunId);
    let continuationJobId: string | null = null;
    if (needsContinuation) {
      const { data: continuation, error: continuationError } = await db.rpc("enqueue_immoscout_inventory_continuation");
      if (continuationError) inventoryErrors.push(`continuation queue: ${errorText(continuationError)}`);
      else continuationJobId = continuation ? String(continuation) : null;
    }

    const finishedAt = new Date().toISOString();
    const { error: sourceUpdateError } = await db.from("sources").update({ warmed_up: true, last_success_at: finishedAt, last_error_at: null, consecutive_failures: 0, updated_at: finishedAt }).eq("id", SOURCE_ID);
    if (sourceUpdateError) throw new Error(`sources update: ${errorText(sourceUpdateError)}`);

    const allKeys = new Set([...fastItems.keys(), ...inventoryItems.keys()]);
    const allNew = new Set([...fastIngest.newKeys, ...inventoryIngest.newKeys]);
    const metadata = {
      architecture: "fast_lane_plus_persistent_adaptive_inventory",
      coverage_strategy: COVERAGE_STRATEGY,
      mcp_endpoint: MCP_URL,
      mcp_profile_query_count: fastJobs.filter((x) => x.profileIds.length > 0).length,
      fast_query_count: fastJobs.length,
      fast_errors: fastSearch.errors,
      fast_reported_total: startReportedTotal,
      inventory_run_id: inventoryRunId,
      inventory_partition_claimed: claimed.length,
      inventory_split_children: splitChildren,
      inventory_status: statusCounts,
      inventory_errors: inventoryErrors,
      crawl_complete: Boolean(finalization?.crawl_complete),
      snapshot_stable: Boolean(finalization?.snapshot_stable),
      coverage_ratio: finalization?.coverage_ratio ?? null,
      enumerated_unique: finalization?.enumerated_unique ?? null,
      catchup_run_id: catchupRunId,
      continuation_job_id: continuationJobId,
      unique_candidates_this_invocation: allKeys.size,
      baseline_complete_before_run: baselineComplete,
      direct_exact_delivery_queued: fastIngest.queued + inventoryIngest.queued,
      delivery_path: "listings -> enrichment -> matches/outbox -> notification-dispatcher",
    };
    const { error: runUpdateError } = await db.from("crawl_runs").update({ finished_at: finishedAt, success: true, connector_priority: 1, connector_label: MCP_LABEL, fetched_count: allKeys.size, inserted_count: allNew.size, metadata }).eq("id", crawlRunId);
    if (runUpdateError) throw new Error(`crawl_runs update: ${errorText(runUpdateError)}`);

    return {
      ok: true,
      connector: 1,
      label: MCP_LABEL,
      fast_fetched: fastItems.size,
      fast_new: fastIngest.newKeys.length,
      inventory_run_id: inventoryRunId,
      inventory_claimed: claimed.length,
      inventory_fetched: inventoryItems.size,
      inventory_new: inventoryIngest.newKeys.length,
      inventory_status: statusCounts,
      finalization,
      catchup_run_id: catchupRunId,
      continuation_job_id: continuationJobId,
      errors: [...fastSearch.errors, ...inventoryErrors],
    };
  } catch (error) {
    const message = errorText(error);
    const finishedAt = new Date().toISOString();
    await db.from("sources").update({ last_error_at: finishedAt, consecutive_failures: (source.consecutive_failures || 0) + 1, updated_at: finishedAt }).eq("id", SOURCE_ID);
    await db.from("crawl_runs").update({ finished_at: finishedAt, success: false, error_message: message, metadata: { coverage_strategy: COVERAGE_STRATEGY, crawl_complete: false, snapshot_stable: false } }).eq("id", crawlRunId);
    return { ok: false, error: message };
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    if ((req.headers.get("x-internal-secret") || "") !== await secret("internal_worker_secret")) return new Response("unauthorized", { status: 401 });
    const { data: source, error } = await db.from("sources").select("id,name,warmed_up,consecutive_failures").eq("id", SOURCE_ID).single();
    if (error) throw new Error(`source lookup: ${errorText(error)}`);
    return Response.json(await run(source as Source));
  } catch (error) {
    return Response.json({ ok: false, error: errorText(error) }, { status: 500 });
  }
});