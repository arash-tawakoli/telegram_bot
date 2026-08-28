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
const COVERAGE_STRATEGY = "profile_price_room_slices_v2";
const MCP_CONCURRENCY = 8;
const MCP_TIMEOUT_MS = 9000;
const MAX_COVERAGE_JOBS = 18;
const TARGET_TOTAL_JOBS = 24;

const ALLOWED_TYPES = ["Wohnung", "Haus", "WG", "Tauschwohnung"] as const;
type PropertyType = typeof ALLOWED_TYPES[number];
type Source = { id: number; name: string; warmed_up: boolean; consecutive_failures: number };
type Profile = { id: string; user_id: string; property_types: string[] | null; max_warm_rent: number | null; min_rooms: number | null; min_area_sqm: number | null; districts: string[] | null; location_mode: string | null; boroughs: string[] | null; neighborhoods: string[] | null; furnished_preference: string | null; wbs_only: boolean | null; move_in_from: string | null };
type SearchJob = { query: string; profileIds: string[]; kind: "profile" | "coverage"; slice: string };
type ListingCandidate = { key: string; url: string; title: string; address: string | null; district: string | null; postal: string | null; rooms: number | null; area: number | null; propertyType: string; image: string | null; raw: Record<string, unknown> };
type PriceBand = { min: number | null; max: number | null; label: string };
type RoomSlice = { clause: string; label: string; min: number; max: number | null };
type Discovery = { exactProfiles: Set<string>; coverageProfiles: Set<string> };

type JobPlan = {
  jobs: SearchJob[];
  profileQueryCount: number;
  coverageQueryCount: number;
  coverageCandidateCount: number;
  coverageTrimmed: boolean;
};

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
      headers: { "content-type": "application/json", "accept": "application/json, text/event-stream", "user-agent": "TraumWohnungHamburgBot/9.0 (+https://traumwohnunghamburg.de)", "mcp-protocol-version": MCP_PROTOCOL },
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
  const init = await mcpPost({ jsonrpc: "2.0", id: `init-${crypto.randomUUID()}`, method: "initialize", params: { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: "traumwohnung-hamburg", version: "9.0.0" } } });
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

function buildQuery(profile: Profile): string {
  const parts: string[] = [];
  const types = typesForProfile(profile);
  parts.push(types.join(" oder "), "zur Miete", `in ${locationText(profile)}`);
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

function priceBands(maxRent: number | null): PriceBand[] {
  const max = maxRent != null && Number(maxRent) > 0 ? Math.round(Number(maxRent)) : null;
  if (max != null && max <= 1500) return [{ min: null, max, label: `bis-${max}` }];
  const bands: PriceBand[] = [{ min: null, max: 1500, label: "bis-1500" }];
  if (max == null || max > 1500) bands.push({ min: 1501, max: max != null && max <= 2500 ? max : 2500, label: `1501-${max != null && max <= 2500 ? max : 2500}` });
  if (max == null || max > 2500) bands.push({ min: 2501, max: max != null && max <= 5000 ? max : 5000, label: `2501-${max != null && max <= 5000 ? max : 5000}` });
  if (max == null || max > 5000) bands.push({ min: 5001, max, label: max == null ? "5001-plus" : `5001-${max}` });
  return bands.filter((b) => b.max == null || b.min == null || b.min <= b.max);
}

function roomSlices(minRooms: number | null): RoomSlice[] {
  const min = minRooms != null ? Number(minRooms) : 0;
  const standard: RoomSlice[] = [
    { clause: "genau 1 Zimmer", label: "1z", min: 1, max: 1 },
    { clause: "genau 2 Zimmer", label: "2z", min: 2, max: 2 },
    { clause: "genau 3 Zimmer", label: "3z", min: 3, max: 3 },
    { clause: "mindestens 4 Zimmer", label: "4z-plus", min: 4, max: null },
  ];
  if (min > 4) return [{ clause: `mindestens ${min} Zimmer`, label: `${min}z-plus`, min, max: null }];
  return standard.filter((s) => s.max == null ? s.min >= Math.ceil(min) || s.min <= min : s.max >= min);
}

function typePhrase(type: PropertyType): string {
  if (type === "WG") return "WG-Zimmer zur Miete";
  if (type === "Tauschwohnung") return "Tauschwohnung";
  return `${type} zur Miete`;
}

function buildCoverageQuery(profile: Profile, type: PropertyType, band: PriceBand, room: RoomSlice | null): string {
  const parts = [typePhrase(type), `in ${locationText(profile)}`];
  if (band.min != null && band.max != null) parts.push(`zwischen ${band.min} und ${band.max} Euro monatlich`);
  else if (band.max != null) parts.push(`maximal ${band.max} Euro monatlich`);
  else if (band.min != null) parts.push(`ab ${band.min} Euro monatlich`);
  if (room) parts.push(room.clause);
  else if (profile.min_rooms != null && Number(profile.min_rooms) > 0) parts.push(`mindestens ${Number(profile.min_rooms)} Zimmer`);
  if (profile.min_area_sqm != null && Number(profile.min_area_sqm) > 0) parts.push(`mindestens ${Number(profile.min_area_sqm)} Quadratmeter`);
  if (profile.wbs_only) parts.push("WBS erforderlich");
  if (profile.furnished_preference === "yes") parts.push("moebliert");
  if (profile.furnished_preference === "no") parts.push("unmoebliert");
  if (profile.move_in_from) parts.push(`verfuegbar ab ${profile.move_in_from}`);
  parts.push("neueste Inserate");
  return parts.join(", ");
}

function addJob(target: Map<string, { ids: Set<string>; kind: "profile" | "coverage"; slice: string }>, query: string, profileId: string, kind: "profile" | "coverage", slice: string) {
  const existing = target.get(query);
  if (existing) {
    existing.ids.add(profileId);
    if (kind === "profile") existing.kind = "profile";
    return;
  }
  target.set(query, { ids: new Set([profileId]), kind, slice });
}

async function loadJobs(): Promise<JobPlan> {
  const { data: users, error: usersError } = await db.from("bot_users").select("id").eq("is_active", true);
  if (usersError) throw new Error(`bot_users: ${errorText(usersError)}`);
  const activeUsers = new Set((users || []).map((row: any) => String(row.id)));
  const { data: profileRows, error: profilesError } = await db.from("search_profiles").select("id,user_id,property_types,max_warm_rent,min_rooms,min_area_sqm,districts,location_mode,boroughs,neighborhoods,furnished_preference,wbs_only,move_in_from").eq("is_active", true);
  if (profilesError) throw new Error(`search_profiles: ${errorText(profilesError)}`);
  const profiles = ((profileRows || []) as Profile[]).filter((p) => activeUsers.has(String(p.user_id))).sort((a, b) => Number(a.max_warm_rent ?? 1e9) - Number(b.max_warm_rent ?? 1e9));

  const profileJobs = new Map<string, { ids: Set<string>; kind: "profile" | "coverage"; slice: string }>();
  const coverageJobs = new Map<string, { ids: Set<string>; kind: "profile" | "coverage"; slice: string }>();
  for (const profile of profiles) {
    addJob(profileJobs, buildQuery(profile), String(profile.id), "profile", "exact-profile");
    for (const type of typesForProfile(profile)) {
      for (const band of priceBands(profile.max_warm_rent)) {
        const rooms = type === "Wohnung" ? roomSlices(profile.min_rooms) : [null];
        for (const room of rooms) {
          const slice = `${type}:${band.label}:${room?.label || "all-rooms"}`;
          addJob(coverageJobs, buildCoverageQuery(profile, type, band, room), String(profile.id), "coverage", slice);
        }
      }
    }
  }

  if (!profileJobs.size) {
    profileJobs.set("Wohnungen zur Miete in Hamburg, neueste Inserate", { ids: new Set(), kind: "profile", slice: "fallback" });
  }
  for (const query of profileJobs.keys()) coverageJobs.delete(query);

  const profileList: SearchJob[] = [...profileJobs.entries()].map(([query, v]) => ({ query, profileIds: [...v.ids], kind: "profile", slice: v.slice }));
  const coverageCandidateList: SearchJob[] = [...coverageJobs.entries()].map(([query, v]) => ({ query, profileIds: [...v.ids], kind: "coverage", slice: v.slice }));
  const coverageLimit = Math.max(0, Math.min(MAX_COVERAGE_JOBS, TARGET_TOTAL_JOBS - profileList.length));
  const coverageList = coverageCandidateList.slice(0, coverageLimit);
  return {
    jobs: [...profileList, ...coverageList],
    profileQueryCount: profileList.length,
    coverageQueryCount: coverageList.length,
    coverageCandidateCount: coverageCandidateList.length,
    coverageTrimmed: coverageList.length < coverageCandidateList.length,
  };
}

function extractResult(json: any): { entries: any[]; total: number | null } {
  const structured = json?.result?.structuredContent || json?.result?.structured_content || {};
  return { entries: Array.isArray(structured.entries) ? structured.entries : [], total: num(structured.total) };
}

async function searchJob(job: SearchJob) {
  const json = await mcpPost({ jsonrpc: "2.0", id: `search-${crypto.randomUUID()}`, method: "tools/call", params: { name: "property_search", arguments: { query: job.query } } });
  return { job, ...extractResult(json) };
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

async function hadCoverageSuccess(): Promise<boolean> {
  const { data, error } = await db.from("crawl_runs").select("id").eq("source_id", SOURCE_ID).eq("success", true).contains("metadata", { coverage_strategy: COVERAGE_STRATEGY }).limit(1);
  if (error) throw new Error(`coverage crawl_runs lookup: ${errorText(error)}`);
  return Boolean(data?.length);
}

async function queueNewListings(rows: any[], discovery: Map<string, Discovery>, skipAll: boolean, coverageWarmup: boolean): Promise<{ queued: number; warmupSuppressed: number }> {
  if (skipAll || !rows.length) return { queued: 0, warmupSuppressed: 0 };
  let queued = 0, warmupSuppressed = 0;
  for (const listing of rows) {
    const d = discovery.get(String(listing.source_listing_key));
    if (!d) continue;
    const profileIds = new Set([...d.exactProfiles, ...d.coverageProfiles]);
    for (const profileId of profileIds) {
      if (coverageWarmup && !d.exactProfiles.has(profileId)) {
        warmupSuppressed++;
        continue;
      }
      const { error } = await db.from("delivery_events").insert({ profile_id: profileId, listing_id: listing.id, dedupe_key: listing.cross_source_hash || `${SOURCE_ID}:${listing.source_listing_key}`, status: "pending", delivery_format: "photo_card" });
      if (!error) queued++;
      else if (error.code !== "23505") throw new Error(`delivery_events: ${errorText(error)}`);
    }
  }
  return { queued, warmupSuppressed };
}

async function run(source: Source) {
  const startedAt = new Date().toISOString();
  const { data: runRow, error: runInsertError } = await db.from("crawl_runs").insert({ source_id: SOURCE_ID, started_at: startedAt }).select("id").single();
  if (runInsertError) throw new Error(`crawl_runs insert: ${errorText(runInsertError)}`);
  const runId = runRow.id;
  try {
    const [connectorHadSuccess, coverageHadSuccess, plan] = await Promise.all([hadMcpSuccess(), hadCoverageSuccess(), loadJobs()]);
    await initializeMcp();
    const items = new Map<string, ListingCandidate>();
    const discovery = new Map<string, Discovery>();
    const errors: string[] = [];
    let totalReported = 0, totalSeen = false, successfulQueries = 0;
    for (let i = 0; i < plan.jobs.length; i += MCP_CONCURRENCY) {
      const settled = await Promise.allSettled(plan.jobs.slice(i, i + MCP_CONCURRENCY).map(searchJob));
      for (const result of settled) {
        if (result.status === "rejected") { errors.push(errorText(result.reason)); continue; }
        successfulQueries++;
        if (result.value.total != null) { totalReported += result.value.total; totalSeen = true; }
        for (const entry of result.value.entries) {
          const candidate = normalizeEntry(entry, result.value.job.query);
          if (!candidate) continue;
          const previous = items.get(candidate.key);
          if (!previous || candidateScore(candidate) > candidateScore(previous)) items.set(candidate.key, candidate);
          if (!discovery.has(candidate.key)) discovery.set(candidate.key, { exactProfiles: new Set(), coverageProfiles: new Set() });
          const bucket = result.value.job.kind === "profile" ? discovery.get(candidate.key)!.exactProfiles : discovery.get(candidate.key)!.coverageProfiles;
          for (const profileId of result.value.job.profileIds) bucket.add(profileId);
        }
      }
    }
    if (!items.size) throw new Error(errors.length ? errors.join(" | ") : "ImmoScout MCP returned no usable listings");

    const coverageWarmup = !coverageHadSuccess;
    const keys = [...items.keys()];
    const { data: existing, error: existingError } = await db.from("listings").select("source_listing_key,enrichment_delivery_eligible").eq("source_id", SOURCE_ID).in("source_listing_key", keys);
    if (existingError) throw new Error(`listings lookup: ${errorText(existingError)}`);
    const oldEligibility = new Map((existing || []).map((row: any) => [String(row.source_listing_key), Boolean(row.enrichment_delivery_eligible)]));
    const oldKeys = new Set(oldEligibility.keys());

    const normalized: any[] = [];
    let coverageWarmupBackfilled = 0;
    for (const item of items.values()) {
      const d = discovery.get(item.key);
      const row: any = { source_id: SOURCE_ID, source_listing_key: item.key, external_id: item.key, canonical_url: item.url, title: item.title, address: item.address, district: item.district, postal_code: item.postal, city: "Hamburg", warm_rent: null, cold_rent: null, rooms: item.rooms, area_sqm: item.area, property_type: item.propertyType, image_url: item.image, cross_source_hash: await sha256(`${item.key}|${item.postal || ""}|${item.rooms ?? ""}|${item.area ?? ""}`), raw: { ...item.raw, coverage_strategy: COVERAGE_STRATEGY, discovered_by_exact_profile: Boolean(d?.exactProfiles.size), discovered_by_coverage: Boolean(d?.coverageProfiles.size) }, last_seen_at: new Date().toISOString(), is_active: true };
      if (oldKeys.has(item.key)) {
        row.enrichment_delivery_eligible = oldEligibility.get(item.key) ?? true;
      } else if (coverageWarmup && !d?.exactProfiles.size && d?.coverageProfiles.size) {
        row.enrichment_delivery_eligible = false;
        coverageWarmupBackfilled++;
      } else {
        row.enrichment_delivery_eligible = true;
      }
      normalized.push(row);
    }
    const { error: upsertError } = await db.from("listings").upsert(normalized, { onConflict: "source_id,source_listing_key" });
    if (upsertError) throw new Error(`listings upsert: ${errorText(upsertError)}`);
    const newKeys = keys.filter((key) => !oldKeys.has(key));
    let newRows: any[] = [];
    if (newKeys.length) {
      const { data, error } = await db.from("listings").select("id,source_listing_key,cross_source_hash").eq("source_id", SOURCE_ID).in("source_listing_key", newKeys);
      if (error) throw new Error(`new listings lookup: ${errorText(error)}`);
      newRows = data || [];
    }
    const connectorWarmup = !connectorHadSuccess;
    const queueResult = await queueNewListings(newRows, discovery, connectorWarmup || !source.warmed_up, coverageWarmup);
    const finishedAt = new Date().toISOString();
    const { error: sourceUpdateError } = await db.from("sources").update({ warmed_up: true, last_success_at: finishedAt, last_error_at: null, consecutive_failures: 0, updated_at: finishedAt }).eq("id", SOURCE_ID);
    if (sourceUpdateError) throw new Error(`sources update: ${errorText(sourceUpdateError)}`);
    const metadata = {
      queued: queueResult.queued,
      coverage_warmup_suppressed: queueResult.warmupSuppressed,
      coverage_warmup_backfilled: coverageWarmupBackfilled,
      mcp_endpoint: MCP_URL,
      mcp_query_count: plan.jobs.length,
      mcp_profile_query_count: plan.profileQueryCount,
      mcp_coverage_query_count: plan.coverageQueryCount,
      mcp_coverage_candidate_count: plan.coverageCandidateCount,
      mcp_coverage_trimmed: plan.coverageTrimmed,
      mcp_successful_queries: successfulQueries,
      mcp_failed_queries: errors.length,
      mcp_total_reported_sum: totalSeen ? totalReported : null,
      unique_candidates: items.size,
      coverage_strategy: COVERAGE_STRATEGY,
      coverage_warmup: coverageWarmup,
      connector_errors: errors,
      connector_warmup_skipped: connectorWarmup,
      delivery_path: "delivery_events -> notification-dispatcher -> Telegram sendPhoto",
    };
    const { error: runUpdateError } = await db.from("crawl_runs").update({ finished_at: finishedAt, success: true, connector_priority: 1, connector_label: MCP_LABEL, fetched_count: items.size, inserted_count: newKeys.length, metadata }).eq("id", runId);
    if (runUpdateError) throw new Error(`crawl_runs update: ${errorText(runUpdateError)}`);
    return { ok: true, connector: 1, label: MCP_LABEL, fetched: items.size, new: newKeys.length, queued: queueResult.queued, warmup_suppressed: queueResult.warmupSuppressed, warmup_backfilled: coverageWarmupBackfilled, queries: plan.jobs.length, profile_queries: plan.profileQueryCount, coverage_queries: plan.coverageQueryCount, coverage_candidates: plan.coverageCandidateCount, coverage_trimmed: plan.coverageTrimmed, total_reported_sum: totalSeen ? totalReported : null, coverage_warmup: coverageWarmup, connector_warmup_skipped: connectorWarmup, errors };
  } catch (error) {
    const message = errorText(error);
    const finishedAt = new Date().toISOString();
    await db.from("sources").update({ last_error_at: finishedAt, consecutive_failures: (source.consecutive_failures || 0) + 1, updated_at: finishedAt }).eq("id", SOURCE_ID);
    await db.from("crawl_runs").update({ finished_at: finishedAt, success: false, error_message: message }).eq("id", runId);
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