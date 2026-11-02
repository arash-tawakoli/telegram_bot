import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SERVICE_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const MCP_URL = "https://mcp.indeed.com/chatgpt/mcp";
const CLIENT_ID_URL = "https://login.traumwohnunghamburg.de/.well-known/indeed-mcp-client.json";
const REDIRECT_URI = "https://login.traumwohnunghamburg.de/connect/indeed-mcp/callback";
const enc = new TextEncoder();
const dec = new TextDecoder();
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}
function fail(code: string, message: string, status = 502): never {
  throw Object.assign(new Error(message), { code, status });
}
function clean(value: unknown, max = 500): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function b64url(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw);
}
function unb64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}
async function digestUrl(value: string): Promise<string> {
  return b64url(await digest(value));
}
function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
function indeedUrl(value: unknown): URL | null {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "indeed.com" || host.endsWith(".indeed.com")) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}
function resourceUrl(value: unknown): URL | null {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname.toLowerCase() === "mcp.indeed.com" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}
function bearer(req: Request): string {
  return String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}
async function currentMember(req: Request) {
  const token = bearer(req);
  if (!token) fail("unauthorized", "Bitte melde dich erneut im Coach-Portal an.", 401);
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth?.user?.id) fail("unauthorized", "Die Coach-Anmeldung ist abgelaufen. Bitte melde dich erneut an.", 401);
  const { data: member, error } = await db.from("coaching_members")
    .select("id,workspace_id,display_name,role,is_active,is_super_admin")
    .eq("auth_user_id", auth.user.id).maybeSingle();
  if (error || !member?.id || member.is_active !== true) fail("coach_forbidden", "Für die Jobsuche ist eine aktive Coach-Anmeldung erforderlich.", 403);
  if (member.is_super_admin !== true) fail("admin_required", "Die Indeed-MCP-Verbindung ist nur für den Super-Admin freigegeben.", 403);
  const { data: workspace, error: workspaceError } = await db.from("coaching_workspaces")
    .select("is_active,operations_paused").eq("id", member.workspace_id).maybeSingle();
  if (workspaceError || !workspace?.is_active || workspace.operations_paused) fail("workspace_unavailable", "Der Arbeitsbereich ist derzeit nicht verfügbar.", 403);
  return { member, token };
}
async function secret(name: string): Promise<string> {
  const { data, error } = await db.rpc("get_bot_secret", { secret_name: name });
  if (error || !data) fail("configuration_unavailable", "Die verschlüsselte Indeed-Verbindung ist noch nicht konfiguriert.", 503);
  return String(data);
}
async function optionalSecret(name: string): Promise<string | null> {
  const { data, error } = await db.rpc("get_bot_secret", { secret_name: name });
  if (error) fail("configuration_storage_unavailable", "Die Indeed-Konfiguration konnte nicht aus dem Secret Vault gelesen werden.", 503);
  return data == null || String(data) === "" ? null : String(data);
}
async function encrypt(workspaceId: string, value: unknown) {
  const raw = unb64(await secret("application_credential_key_v1"));
  if (raw.length !== 32) fail("configuration_unavailable", "Der Verschlüsselungsschlüssel ist ungültig.", 503);
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = enc.encode(JSON.stringify(value));
  const aad = enc.encode(workspaceId + ":indeed_mcp:v1");
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, plain));
  return { credential_ciphertext: b64(cipher), credential_iv: b64(iv), key_version: 1 };
}
async function decrypt(workspaceId: string, row: any) {
  if (!row?.credential_ciphertext || !row?.credential_iv) return null;
  const raw = unb64(await secret("application_credential_key_v1"));
  if (raw.length !== 32) fail("configuration_unavailable", "Der Verschlüsselungsschlüssel ist ungültig.", 503);
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({
    name: "AES-GCM", iv: unb64(String(row.credential_iv)),
    additionalData: enc.encode(workspaceId + ":indeed_mcp:v" + String(Number(row.key_version) || 1))
  }, key, unb64(String(row.credential_ciphertext)));
  return JSON.parse(dec.decode(plain));
}
function parseResourceMetadataUrl(challenge: string): string {
  const match = challenge.match(/resource_metadata\s*=\s*"([^"]+)"/i) || challenge.match(/resource_metadata\s*=\s*([^,\s]+)/i);
  if (!match) return "";
  try {
    const url = new URL(match[1].replace(/^"|"$/g, ""));
    return resourceUrl(url.href) ? url.href : "";
  } catch {
    return "";
  }
}
async function getJson(url: string): Promise<any | null> {
  const safe = indeedUrl(url) || resourceUrl(url);
  if (!safe) return null;
  try {
    const response = await fetch(safe.href, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}
function wellKnown(issuer: string, name: string): string {
  const url = new URL(issuer);
  const path = url.pathname.replace(/\/+$/g, "");
  return url.origin + "/.well-known/" + name + path;
}
async function discoverAuth() {
  let challengeHeader = "";
  try {
    const response = await fetch(MCP_URL, {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "NexaLabs Coach Portal", version: "1.0.0" } } }),
      signal: AbortSignal.timeout(10000)
    });
    challengeHeader = response.headers.get("www-authenticate") || "";
    if (response.ok) fail("indeed_mcp_public_endpoint", "Der Indeed-MCP-Endpunkt antwortet ohne OAuth-Challenge. Die Verbindung kann nicht sicher automatisch eingerichtet werden.", 409);
  } catch (error) {
    if ((error as any)?.code) throw error;
  }
  const fallbackResources = [
    parseResourceMetadataUrl(challengeHeader),
    "https://mcp.indeed.com/.well-known/oauth-protected-resource/chatgpt/mcp",
    "https://mcp.indeed.com/.well-known/oauth-protected-resource",
    "https://mcp.indeed.com/chatgpt/.well-known/oauth-protected-resource"
  ].filter(Boolean);
  let resourceMetadata: any = null;
  for (const url of [...new Set(fallbackResources)]) {
    try {
      const parsed = new URL(url);
      if (!resourceUrl(parsed.origin + parsed.pathname)) continue;
      const response = await fetch(parsed.href, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (data && typeof data === "object") { resourceMetadata = data; break; }
      }
    } catch {}
  }
  if (!resourceMetadata) fail("indeed_mcp_auth_discovery_failed", "Indeed hat keine auswertbaren OAuth-Ressourceninformationen geliefert. Der MCP-Endpunkt muss den Client für diese SaaS freigeben.", 502);
  const resource = String(resourceMetadata.resource || MCP_URL);
  if (resource !== MCP_URL) fail("indeed_mcp_resource_mismatch", "Die OAuth-Ressource stimmt nicht mit dem offiziellen Indeed-MCP-Endpunkt überein.", 502);
  const issuers = Array.isArray(resourceMetadata.authorization_servers) ? resourceMetadata.authorization_servers : [];
  const issuer = issuers.map(String).find(value => !!indeedUrl(value));
  if (!issuer) fail("indeed_mcp_auth_discovery_failed", "Indeed hat keinen gültigen OAuth-Aussteller veröffentlicht.", 502);
  const candidates = [
    wellKnown(issuer, "oauth-authorization-server"),
    wellKnown(issuer, "openid-configuration"),
    new URL(".well-known/oauth-authorization-server", issuer.endsWith("/") ? issuer : issuer + "/").href,
    new URL(".well-known/openid-configuration", issuer.endsWith("/") ? issuer : issuer + "/").href
  ];
  let metadata: any = null;
  for (const url of [...new Set(candidates)]) {
    metadata = await getJson(url);
    if (metadata?.authorization_endpoint && metadata?.token_endpoint) break;
    metadata = null;
  }
  if (!metadata) fail("indeed_mcp_auth_discovery_failed", "Der Indeed-OAuth-Aussteller hat keine gültigen Autorisierungs- und Token-Endpunkte veröffentlicht.", 502);
  const authorizationEndpoint = indeedUrl(metadata.authorization_endpoint);
  const tokenEndpoint = indeedUrl(metadata.token_endpoint);
  if (!authorizationEndpoint || !tokenEndpoint) fail("indeed_mcp_auth_discovery_failed", "Indeed hat unsichere oder nicht unterstützte OAuth-Endpunkte veröffentlicht.", 502);
  const supported = Array.isArray(resourceMetadata.scopes_supported) ? resourceMetadata.scopes_supported.map(String) : [];
  const challengeScope = (challengeHeader.match(/scope\s*=\s*"([^"]+)"/i) || [])[1] || "";
  const scope = challengeScope || supported.filter(value => /job|search|read|openid|email|offline_access/i.test(value)).join(" ");
  let clientId = CLIENT_ID_URL;
  if (metadata.client_id_metadata_document_supported !== true && metadata.registration_endpoint) {
    const registrationEndpoint = indeedUrl(metadata.registration_endpoint);
    if (!registrationEndpoint) fail("indeed_mcp_client_registration_failed", "Indeed hat einen nicht unterstützten Client-Registrierungsendpunkt veröffentlicht.", 502);
    const registration = await fetch(registrationEndpoint.href, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "NexaLabs Coach Portal",
        client_uri: "https://intern.traumwohnunghamburg.de/",
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        ...(scope ? { scope } : {})
      }),
      signal: AbortSignal.timeout(15000)
    });
    const registrationData = await registration.json().catch(() => null);
    if (!registration.ok || !registrationData?.client_id || registrationData.token_endpoint_auth_method && registrationData.token_endpoint_auth_method !== "none") {
      fail("indeed_mcp_client_registration_failed", "Indeed hat die Registrierung dieses SaaS-MCP-Clients abgelehnt.", 502);
    }
    clientId = String(registrationData.client_id);
  } else if (metadata.client_id_metadata_document_supported === false && !metadata.registration_endpoint) {
    fail("indeed_mcp_client_registration_unsupported", "Indeed unterstützt weder Client-Metadaten-Dokumente noch eine Registrierung für diesen MCP-Endpunkt.", 502);
  }
  return {
    issuer: String(metadata.issuer || issuer),
    requiresIss: metadata.authorization_response_iss_parameter_supported === true,
    authorizationEndpoint: authorizationEndpoint.href,
    tokenEndpoint: tokenEndpoint.href,
    resource,
    scope,
    clientId
  };
}
async function currentConnection(workspaceId: string) {
  const { data, error } = await db.from("coaching_indeed_mcp_connections").select("*").eq("workspace_id", workspaceId).maybeSingle();
  if (error) fail("indeed_mcp_storage_unavailable", "Der Status der Indeed-Verbindung konnte nicht gelesen werden.", 503);
  return data;
}
async function statusAction(req: Request) {
  const { member } = await currentMember(req);
  if (publicTestMode()) {
    return {
      ok: true,
      provider: "indeed",
      mode: "public_test",
      authMode: "public_web",
      status: "public_test",
      mcpConnected: false,
      workspaceConnectionRequired: false,
      personalLoginRequired: false,
      publicTestMode: true,
      workspaceId: member.workspace_id
    };
  }
  const connection = await currentConnection(member.workspace_id);
  const mcpConnected = connection?.status === "connected" && Boolean(connection.credential_ciphertext && connection.credential_iv);
  return {
    ok: true,
    provider: "indeed",
    mode: "official_mcp",
    authMode: "workspace_oauth",
    status: mcpConnected ? "connected" : String(connection?.status || "disconnected"),
    mcpConnected,
    workspaceConnectionRequired: !mcpConnected,
    personalLoginRequired: false,
    publicTestMode: false
  };
}
async function configureAction(req: Request, body: any) {
  await currentMember(req);
  const clientId = clean(body?.clientId, 256);
  const clientSecret = String(body?.clientSecret || "").trim();
  if (clientId.length < 8 || clientSecret.length < 8 || clientSecret.length > 2048) {
    fail("indeed_app_credentials_invalid", "Bitte prüfe Client-ID und Client-Secret aus der Indeed Partner Console.", 400);
  }
  const { error } = await db.rpc("set_indeed_partner_credentials", {
    p_client_id: clientId,
    p_client_secret: clientSecret
  });
  if (error) {
    console.warn("indeed_app_credentials_store_failed");
    fail("indeed_app_credentials_store_failed", "Die Indeed-App-Zugangsdaten konnten nicht sicher gespeichert werden.", 503);
  }
  return {
    ok: true,
    provider: "indeed",
    mode: "official_partner_api",
    authMode: "server_credentials",
    appCredentialsConfigured: true,
    personalLoginRequired: false
  };
}
async function startAction(req: Request) {
  const { member } = await currentMember(req);
  const discovered = await discoverAuth();
  const state = randomToken(32);
  const verifier = randomToken(48);
  const codeChallenge = b64url(await digest(verifier));
  const stateHash = await digestUrl(state);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error: cleanupError } = await db.from("coaching_indeed_mcp_auth_flows").delete().lt("expires_at", new Date().toISOString());
  if (cleanupError) console.warn("indeed_mcp_expired_flow_cleanup_failed");
  const { error } = await db.from("coaching_indeed_mcp_auth_flows").insert({
    state_hash: stateHash, workspace_id: member.workspace_id, member_id: member.id,
    code_verifier: verifier, authorization_endpoint: discovered.authorizationEndpoint,
    token_endpoint: discovered.tokenEndpoint, issuer: discovered.issuer, requires_iss: discovered.requiresIss,
    resource: discovered.resource, scope: discovered.scope || null, client_id: discovered.clientId,
    token_endpoint_auth_method: "none", expires_at: expiresAt
  });
  if (error) fail("indeed_mcp_flow_create_failed", "Der sichere Indeed-Verbindungsablauf konnte nicht angelegt werden.", 503);
  const auth = new URL(discovered.authorizationEndpoint);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", discovered.clientId);
  auth.searchParams.set("redirect_uri", REDIRECT_URI);
  auth.searchParams.set("state", state);
  auth.searchParams.set("code_challenge", codeChallenge);
  auth.searchParams.set("code_challenge_method", "S256");
  auth.searchParams.set("resource", discovered.resource);
  if (discovered.scope) auth.searchParams.set("scope", discovered.scope);
  return { ok: true, url: auth.href, expiresAt, provider: "indeed", mode: "official_mcp" };
}
async function readMcpResponse(response: Response) {
  const text = await response.text();
  let payload: any = null;
  if (/text\/event-stream/i.test(response.headers.get("content-type") || "")) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
      if (!data || data === "[DONE]") continue;
      try { payload = JSON.parse(data); } catch {}
    }
  } else {
    try { payload = JSON.parse(text); } catch {}
  }
  return payload;
}
async function mcpPost(token: string, id: number | null, method: string, params: unknown, sessionId = "", protocolVersion = "2025-03-26") {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream", "content-type": "application/json",
    authorization: "Bearer " + token, "mcp-protocol-version": protocolVersion
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const requestBody: any = { jsonrpc: "2.0", method, params };
  if (id !== null) requestBody.id = id;
  const response = await fetch(MCP_URL, {
    method: "POST", headers, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(25000)
  });
  if (response.status === 401 || response.status === 403) fail("indeed_mcp_unauthorized", "Indeed hat das MCP-Zugriffstoken abgelehnt. Bitte die Verbindung erneut herstellen.", 401);
  if (id === null && (response.status === 202 || response.status === 204)) return { result: null, sessionId: response.headers.get("mcp-session-id") || sessionId, protocolVersion };
  if (!response.ok) fail("indeed_mcp_request_failed", "Der offizielle Indeed-MCP-Endpunkt antwortet mit HTTP " + response.status + ".", 502);
  const payload = await readMcpResponse(response);
  if (id === null && !payload) return { result: null, sessionId: response.headers.get("mcp-session-id") || sessionId, protocolVersion };
  if (!payload || typeof payload !== "object") fail("indeed_mcp_invalid_response", "Indeed hat keine gültige MCP-Antwort geliefert.", 502);
  if (payload.error) fail("indeed_mcp_tool_error", clean(payload.error.message || payload.error.code || "Indeed-MCP-Aufruf fehlgeschlagen.", 300), 502);
  return { result: payload.result, sessionId: response.headers.get("mcp-session-id") || sessionId, protocolVersion: payload.result?.protocolVersion || protocolVersion };
}
async function initializeMcp(token: string) {
  const init = await mcpPost(token, 1, "initialize", {
    protocolVersion: "2025-03-26", capabilities: {},
    clientInfo: { name: "NexaLabs Coach Portal", version: "1.0.0" }
  });
  const version = String(init.protocolVersion || "2025-03-26");
  await mcpPost(token, null, "notifications/initialized", {}, init.sessionId, version);
  return { sessionId: init.sessionId, protocolVersion: version };
}
function parseToolPayload(result: any): any {
  if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  if (result?.data && typeof result.data === "object") return result.data;
  if (Array.isArray(result?.content)) {
    for (const item of result.content) {
      if (typeof item?.text !== "string") continue;
      const text = item.text.trim().replace(/^\u0060\u0060\u0060(?:json)?\s*/i, "").replace(/\s*\u0060\u0060\u0060$/i, "");
      try { return JSON.parse(text); } catch {}
    }
  }
  return result;
}
function findJobArray(value: any, depth = 0): any[] | null {
  if (depth > 5 || value == null) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return value;
    if (value.some(item => item && typeof item === "object" && (item.title || item.jobTitle || item.job_title || item.jobKey || item.jobId || item.job_id))) return value;
    for (const item of value) { const found = findJobArray(item, depth + 1); if (found) return found; }
    return null;
  }
  if (typeof value !== "object") return null;
  const preferred = ["jobs", "results", "jobListings", "job_listings", "listings", "items", "data", "jobResults", "job_results", "searchResults", "search_results"];
  for (const key of preferred) if (key in value) { const found = findJobArray(value[key], depth + 1); if (found) return found; }
  for (const key of Object.keys(value)) { const found = findJobArray(value[key], depth + 1); if (found) return found; }
  return null;
}
function resultUrl(job: any): string {
  const raw = job?.url || job?.jobUrl || job?.job_url || job?.viewJobUrl || job?.view_job_url || job?.link || job?.applyUrl || job?.apply_url;
  const safe = indeedUrl(raw);
  if (safe) return safe.href;
  const id = clean(job?.jobKey || job?.job_key || job?.jobId || job?.job_id || job?.id, 180);
  return id ? "https://de.indeed.com/viewjob?jk=" + encodeURIComponent(id) : "";
}
function normalizeJob(job: any) {
  const title = clean(job?.title || job?.jobTitle || job?.job_title || job?.name, 180);
  const url = resultUrl(job);
  if (!title || !url) return null;
  const place = job?.location || job?.locations || job?.jobLocation || job?.job_location || "";
  const location = Array.isArray(place) ? place.map((item: any) => typeof item === "string" ? item : item?.displayName || item?.name || item?.city).filter(Boolean).join(", ") : typeof place === "object" ? clean(place.displayName || place.name || place.city || place.address, 180) : clean(place, 180);
  const rawDescription = job?.description || job?.snippet || job?.summary || job?.jobDescription || "";
  const description = clean(String(rawDescription).replace(/<[^>]*>/g, " "), 1200);
  const key = clean(job?.jrtk || job?.jobKey || job?.job_key || job?.jobId || job?.job_id || job?.id || url, 180);
  const ratingValue = job?.company_rating ?? job?.companyRating ?? null;
  const companyRating = Number.isFinite(Number(ratingValue)) && ratingValue !== null && ratingValue !== "" ? Number(ratingValue) : null;
  const postedDate = clean(job?.posted_date || job?.postedDate || job?.publishedAt || job?.published_at || job?.datePosted || job?.date_posted || job?.postedDate || "", 60);
  return {
    id: key, jrtk: key,
    title,
    company: clean(job?.company || job?.companyName || job?.company_name || job?.employer || job?.employerName, 180),
    location,
    salary: clean(job?.salary || job?.salaryText || job?.salary_text || job?.compensation, 180),
    job_type: clean(job?.job_type || job?.jobType || job?.employmentType, 100) || null,
    work_settings: clean(job?.work_settings || job?.workSettings || job?.workSetting, 120) || null,
    company_rating: companyRating,
    sponsored: job?.sponsored === true,
    advertiser_name: clean(job?.advertiser_name || job?.advertiserName, 180) || null,
    posted_date: postedDate || null,
    publishedAt: postedDate,
    startDate: clean(job?.startDate || job?.start_date, 60),
    snippet: description.slice(0, 500),
    description,
    url,
    source: "indeed",
    quickApply: job?.quickApply === true || job?.quick_apply === true
  };
}
function mcpArgs(tool: any, filters: any, page: number) {
  const schema = tool?.inputSchema || tool?.input_schema || {};
  const properties = schema?.properties && typeof schema.properties === "object" ? schema.properties : {};
  const keys = Object.keys(properties);
  const args: Record<string, unknown> = {};
  const set = (names: string[], value: unknown) => {
    const key = names.find(name => keys.includes(name));
    if (!key || value === undefined || value === null || value === "") return;
    const type = properties[key]?.type;
    if ((type === "integer" || type === "number") && typeof value === "string" && value.trim() !== "") args[key] = Number(value);
    else args[key] = value;
  };
  const radiusKm = Number(filters.radius || 25);
  const radiusMiles = radiusKm <= 0 ? undefined : Math.max(1, Math.round(radiusKm / 1.609344));
  const jobTypes: Record<string, string> = { fulltime: "fulltime", parttime: "parttime", contract: "contract", internship: "internship", temporary: "temporary" };
  const experience: Record<string, string> = { entry_level: "entry", mid_level: "mid", senior_level: "senior" };
  const education: Record<string, string> = { hauptschule: "high_school", mittlere_reife: "high_school", vocational: "associate", bachelor: "bachelor", master: "master", phd: "phd" };
  set(["search", "query", "keywords", "job_title", "search_query"], filters.keywords);
  set(["location", "city", "where"], filters.location);
  set(["country_code", "countryCode", "country"], "DE");
  set(["job_type", "jobType", "employment_type"], jobTypes[String(filters.employment || "")]);
  set(["remote_only", "remoteOnly"], filters.work_setting === "remote" ? true : undefined);
  set(["radius", "radius_miles", "radiusMiles"], radiusMiles);
  set(["min_salary", "minimum_salary", "minSalary"], Number(filters.salary_min) > 0 && (!filters.salary_type || filters.salary_type === "yearly") ? Number(filters.salary_min) : undefined);
  set(["experience_level", "experienceLevel"], experience[String(filters.experience || "")]);
  set(["education", "education_level", "educationLevel"], education[String(Array.isArray(filters.education) ? filters.education[0] : filters.education || "")]);
  set(["page", "page_number", "pageNumber"], page > 1 ? page : undefined);
  set(["sort", "sort_by", "sortBy"], filters.sort && filters.sort !== "relevance" ? filters.sort : undefined);
  set(["date_posted", "datePosted", "published_since", "fromage"], filters.date && filters.date !== "any" ? filters.date : undefined);
  set(["quick_apply", "quickApply"], filters.quick_apply ? true : undefined);
  set(["employer", "company"], filters.employer || undefined);
  set(["industry", "industries"], Array.isArray(filters.industry) && filters.industry.length ? (properties.industries?.type === "array" ? filters.industry : filters.industry[0]) : undefined);
  set(["source", "job_source"], filters.source && filters.source !== "any" ? filters.source : undefined);
  set(["work_setting", "workSetting"], filters.work_setting && filters.work_setting !== "any" ? filters.work_setting : undefined);
  return { args, properties: keys };
}
async function executeSearch(token: string, filters: any, page: number) {
  const session = await initializeMcp(token);
  const listed = await mcpPost(token, 2, "tools/list", {}, session.sessionId, session.protocolVersion);
  const tools = Array.isArray(listed.result?.tools) ? listed.result.tools : [];
  const tool = tools.find((item: any) => /(^|[_-])search[_-]?jobs?$/i.test(String(item.name || ""))) || tools.find((item: any) => /search.*job|job.*search/i.test(String(item.name || "")));
  if (!tool) fail("indeed_mcp_search_tool_missing", "Indeed-MCP hat kein Suchwerkzeug für Stellenangebote veröffentlicht. Verfügbare Werkzeuge: " + tools.map((item: any) => clean(item.name, 80)).join(", "), 502);
  const mapped = mcpArgs(tool, filters, page);
  const call = await mcpPost(token, 3, "tools/call", { name: tool.name, arguments: mapped.args }, session.sessionId, session.protocolVersion);
  if (call.result?.isError === true) {
    const text = Array.isArray(call.result?.content) ? call.result.content.map((item: any) => clean(item?.text, 240)).filter(Boolean).join(" ") : "";
    fail("indeed_mcp_search_failed", text || "Indeed-MCP hat die Jobsuche abgelehnt.", 502);
  }
  const payload = parseToolPayload(call.result);
  const jobs = findJobArray(payload);
  if (!jobs) fail("indeed_mcp_unstructured_response", "Indeed-MCP hat geantwortet, aber keine strukturierte Stellenliste geliefert. Das Antwortformat muss anhand der freigegebenen Tool-Spezifikation angepasst werden.", 502);
  const results = jobs.map(normalizeJob).filter(Boolean);
  const totalValue = payload?.total ?? payload?.totalResults ?? payload?.total_results ?? payload?.resultCount ?? payload?.result_count;
  const total = Number.isFinite(Number(totalValue)) && totalValue !== "" && totalValue != null ? Number(totalValue) : null;
  const hasMore = payload?.hasMore === true || payload?.has_more === true || (total !== null && total > page * results.length && results.length > 0);
  const passed = new Set(Object.keys(mapped.args));
  const unsupportedFilters: string[] = [];
  if (filters.quick_apply && !passed.has("quick_apply") && !passed.has("quickApply")) unsupportedFilters.push("Schnellbewerbung");
  if (filters.date && filters.date !== "any" && !["date_posted","datePosted","published_since","fromage"].some(key => passed.has(key))) unsupportedFilters.push("Veröffentlichungsdatum");
  if ((filters.work_setting === "hybrid" || filters.work_setting === "onsite") && !passed.has("work_setting") && !passed.has("workSetting")) unsupportedFilters.push("Arbeitsmodell");
  if (filters.work_setting === "remote" && !passed.has("remote_only") && !passed.has("remoteOnly")) unsupportedFilters.push("Homeoffice");
  if (filters.apply_filters?.length) unsupportedFilters.push("Jobs für alle");
  if (filters.industry?.length && !passed.has("industry") && !passed.has("industries")) unsupportedFilters.push("Branche");
  if (filters.employer && !passed.has("employer") && !passed.has("company")) unsupportedFilters.push("Arbeitgeber");
  if (filters.source && filters.source !== "any" && !passed.has("source") && !passed.has("job_source")) unsupportedFilters.push("Stellenquelle");
  if (filters.sort && filters.sort !== "relevance" && !["sort","sort_by","sortBy"].some(key => passed.has(key))) unsupportedFilters.push("Sortierung");
  if (filters.employment && !passed.has("job_type") && !passed.has("jobType") && !passed.has("employment_type")) unsupportedFilters.push("Anstellungsart");
  if (filters.experience && !passed.has("experience_level") && !passed.has("experienceLevel")) unsupportedFilters.push("Erfahrung");
  if (filters.education?.length && !passed.has("education") && !passed.has("education_level") && !passed.has("educationLevel")) unsupportedFilters.push("Bildungsgrad");
  if (Number(filters.salary_min) > 0 && !passed.has("min_salary") && !passed.has("minimum_salary") && !passed.has("minSalary")) unsupportedFilters.push("Mindestgehalt");
  if (results.length === 0 && total !== 0) fail("indeed_mcp_empty_results", "Indeed-MCP hat keine auswertbaren Stellenkarten zurückgegeben. Verfügbare Felder: " + Object.keys(payload || {}).join(", "), 502);
  return { ok: true, provider: "indeed", mode: "official_mcp", authMode: "user_oauth", personalLoginRequired: true, page, pageSize: results.length, resultsShown: results.length, totalAvailable: total, totalApproximate: total === null ? String(results.length) : String(total), search: clean(filters.keywords, 120), location: clean(filters.location, 120), total, results, jobs: results, hasMore, sourceUrl: MCP_URL, unsupportedFilters };
}
async function refreshCredentials(workspaceId: string, credentials: any) {
  if (Date.parse(String(credentials?.expires_at || "")) > Date.now() + 60000) return credentials;
  if (!credentials?.refresh_token) {
    await db.from("coaching_indeed_mcp_connections").update({ status: "error", last_error: "reauthorization_required", updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId);
    fail("indeed_mcp_reconnect_required", "Die Indeed-MCP-Verbindung ist abgelaufen. Bitte Indeed erneut verbinden.", 401);
  }
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: String(credentials.refresh_token), client_id: String(credentials.client_id), resource: MCP_URL });
  if (credentials.scope) body.set("scope", String(credentials.scope));
  const response = await fetch(String(credentials.token_endpoint), {
    method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body, signal: AbortSignal.timeout(15000)
  });
  const token = await response.json().catch(() => null);
  if (!response.ok || !token?.access_token) {
    await db.from("coaching_indeed_mcp_connections").update({ status: "error", last_error: "token_refresh_failed", updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId);
    fail("indeed_mcp_reconnect_required", "Indeed konnte die Verbindung nicht erneuern. Bitte Indeed erneut verbinden.", 401);
  }
  const next = {
    ...credentials, access_token: String(token.access_token),
    refresh_token: token.refresh_token ? String(token.refresh_token) : credentials.refresh_token,
    token_type: String(token.token_type || "Bearer"), scope: String(token.scope || credentials.scope || ""),
    expires_at: new Date(Date.now() + Math.max(60, Number(token.expires_in || 3600)) * 1000).toISOString()
  };
  const encrypted = await encrypt(workspaceId, next);
  await db.from("coaching_indeed_mcp_connections").update({ ...encrypted, status: "connected", expires_at: next.expires_at, last_error: null, updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId);
  return next;
}
async function indeedApplicationToken() {
  const [clientId, clientSecret] = await Promise.all([
    optionalSecret("indeed_client_id"),
    optionalSecret("indeed_client_secret")
  ]);
  if (!clientId || !clientSecret) {
    fail(
      "indeed_app_credentials_missing",
      "Die Indeed-Partner-API ist noch nicht konfiguriert. Hinterlege Client-ID und Client-Secret aus der Indeed Partner Console im angezeigten Konfigurationsfeld. Eine persönliche Indeed-Anmeldung ist nicht erforderlich.",
      503
    );
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "employer_access"
  });
  let response: Response;
  try {
    response = await fetch("https://apis.indeed.com/oauth/v2/tokens", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        authorization: "Basic " + btoa(clientId + ":" + clientSecret)
      },
      body,
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    fail("indeed_app_auth_unavailable", "Indeed konnte die serverseitige App-Anmeldung nicht erreichen.", 503);
  }
  const token = await response.json().catch(() => null);
  if (!response.ok || !token?.access_token) {
    const error = clean(token?.error, 80);
    console.warn("indeed_app_token_failed", response.status, error);
    if (error === "invalid_client") {
      fail("indeed_app_credentials_rejected", "Indeed hat Client-ID oder Client-Secret abgelehnt. Prüfe die Zugangsdaten in der Partner Console.", 503);
    }
    if (error === "invalid_grant" || error === "unsupported_grant_type") {
      fail("indeed_client_credentials_disabled", "Indeed akzeptiert den Client-Credentials-Zugriff nicht. Prüfe in der Partner Console, ob Client credentials für diese App aktiviert sind.", 503);
    }
    fail("indeed_app_auth_unavailable", "Indeed hat die serverseitige App-Anmeldung abgelehnt. Prüfe die App-Freigabe und die OAuth-Einstellungen.", 503);
  }
  return { accessToken: String(token.access_token), expiresIn: Math.max(60, Number(token.expires_in || 3600)) };
}
function publicTestMode() {
  const value = String(Deno.env.get("INDEED_PUBLIC_TEST_MODE") || "true").trim().toLowerCase();
  return !["false", "0", "off", "disabled"].includes(value);
}
function indeedSearchUrl(filters: any, page = 1) {
  const params = new URLSearchParams({
    q: String(filters.keywords || ""),
    l: String(filters.location || ""),
    radius: String(filters.radius || 25)
  });
  const employment = String(filters.employment || "");
  if (["permanent", "fulltime", "parttime", "contract", "temporary", "internship"].includes(employment)) params.set("jt", employment);
  if (filters.sort === "date") params.set("sort", "date");
  if (filters.date && filters.date !== "any") params.set("fromage", String(filters.date));
  if (page > 1) params.set("start", String((page - 1) * 10));
  return "https://de.indeed.com/jobs?" + params.toString();
}
function decodeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}
function htmlText(value: unknown, max = 500): string {
  return clean(decodeHtml(String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")), max);
}
function publicIndeedJob(block: string, id: string): any | null {
  const title = htmlText(
    block.match(new RegExp(`<span[^>]*id="jobTitle-${id}"[^>]*>([\\s\\S]*?)<\/span>`, "i"))?.[1]
      || block.match(/<span[^>]*title="([^"]+)"[^>]*id="jobTitle-/i)?.[1],
    180
  );
  const company = htmlText(block.match(/data-testid="company-name"[^>]*>([\s\S]*?)<\/span>/i)?.[1], 180);
  const location = htmlText(block.match(/data-testid="text-location"[^>]*>([\s\S]*?)<\/div>/i)?.[1], 180);
  const snippet = htmlText(block.match(/data-testid="belowJobSnippet"[\s\S]*?<li[^>]*>([\s\S]*?)<\/li>/i)?.[1], 500);
  if (!id || !title) return null;
  const text = htmlText(block, 1000);
  const salary = text.match(/(?:€|EUR)\s?[\d.,]+(?:\s*[-–]\s*[\d.,]+)?(?:\s*(?:pro Jahr|pro Stunde|im Monat))?/i)?.[0] || "";
  const jobType = ["Vollzeit", "Teilzeit", "Befristet", "Praktikum", "Werkstudent"].find(value => text.includes(value)) || "";
  return {
    id,
    jrtk: id,
    title,
    company,
    location,
    salary: clean(salary, 180),
    job_type: jobType || null,
    work_settings: null,
    company_rating: null,
    sponsored: /\bsponTapItem\b/i.test(block),
    advertiser_name: company || null,
    posted_date: null,
    publishedAt: null,
    snippet,
    description: snippet,
    url: "https://de.indeed.com/viewjob?jk=" + encodeURIComponent(id),
    source: "indeed",
    quickApply: /Schnellbewerbung|quick.?apply|Apply now|Direkt bewerben/i.test(block)
  };
}
function parsePublicIndeedJobs(html: string): any[] {
  const jobs: any[] = [];
  const seen = new Set<string>();
  const cardPattern = /<div\s+class="cardOutline[^">]*\bresult\s+job_([A-Za-z0-9_-]+)[^">]*">[\s\S]*?(?=<div\s+class="cardOutline[^">]*\bresult\s+job_|<\/ol>)/gi;
  for (const match of html.matchAll(cardPattern)) {
    const id = String(match[1] || "");
    if (!id || seen.has(id)) continue;
    const job = publicIndeedJob(String(match[0] || ""), id);
    if (job) {
      seen.add(id);
      jobs.push(job);
    }
  }
  return jobs;
}
function publicIndeedResult(filters: any, page: number, html: string, sourceUrl: string) {
  if (!html || html.length > 2500000) fail("indeed_public_search_unavailable", "Die öffentliche Indeed-Testsuche hat eine ungültige Antwort geliefert.", 503);
  if (/Just a moment|Verify you are human|unusual traffic|robot check|captcha/i.test(html)) {
    fail("indeed_public_search_blocked", "Indeed hat die öffentliche Testsuche für diesen Abruf vorübergehend blockiert.", 503);
  }
  const results = parsePublicIndeedJobs(html);
  const totalMatch = html.match(/"totalJobCount"\s*:\s*(\d+)/i) || html.match(/"uniqueJobsCount"\s*:\s*(\d+)/i);
  const totalValue = totalMatch ? Number(totalMatch[1]) : null;
  const total = Number.isFinite(totalValue) ? totalValue : results.length;
  const unsupportedFilters: string[] = [];
  if (filters.quick_apply) unsupportedFilters.push("Schnellbewerbung");
  if (filters.work_setting && filters.work_setting !== "any") unsupportedFilters.push("Arbeitsmodell");
  if (filters.apply_filters?.length) unsupportedFilters.push("Jobs für alle");
  if (filters.industry?.length) unsupportedFilters.push("Branche");
  if (filters.employer) unsupportedFilters.push("Arbeitgeber");
  if (filters.source && filters.source !== "any") unsupportedFilters.push("Stellenquelle");
  if (filters.experience && filters.experience !== "any") unsupportedFilters.push("Erfahrung");
  if (filters.education?.length) unsupportedFilters.push("Bildungsgrad");
  if (Number(filters.salary_min) > 0) unsupportedFilters.push("Mindestgehalt");
  const hasMore = /<link[^>]+rel="next"/i.test(html) || /data-testid="pagination-page-next"/i.test(html);
  if (results.length === 0 && total > 0) fail("indeed_public_search_unparsed", "Indeed meldet Treffer, aber das öffentliche Ergebnisformat konnte nicht gelesen werden.", 502);
  return {
    ok: true,
    provider: "indeed",
    mode: "public_test",
    authMode: "public_web",
    personalLoginRequired: false,
    workspaceConnectionRequired: false,
    publicTestMode: true,
    page,
    pageSize: results.length,
    resultsShown: results.length,
    totalAvailable: total,
    totalApproximate: String(total),
    search: clean(filters.keywords, 120),
    location: clean(filters.location, 120),
    total,
    results,
    jobs: results,
    hasMore,
    sourceUrl,
    unsupportedFilters
  };
}
async function searchPublicIndeed(filters: any, page: number, htmlOverride?: string) {
  if (page < 1 || page > 10) fail("indeed_page_not_supported", "Die öffentliche Indeed-Testsuche unterstützt maximal zehn Seiten.", 400);
  const sourceUrl = indeedSearchUrl(filters, page);
  let html = typeof htmlOverride === "string" && htmlOverride ? htmlOverride : "";
  if (!html) {
    let response: Response;
    try {
      response = await fetch(sourceUrl, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "de-DE,de;q=0.9",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      console.warn("indeed_public_fetch_failed", JSON.stringify({ name: String((error as any)?.name || ""), message: String((error as any)?.message || "").slice(0, 180) }));
      fail("indeed_public_search_unavailable", "Die öffentliche Indeed-Testsuche ist momentan nicht erreichbar.", 503);
    }
    if (!response.ok) {
      console.warn("indeed_public_response_failed", response.status);
      fail("indeed_public_search_unavailable", "Indeed antwortet mit HTTP " + response.status + ".", 503);
    }
    html = await response.text();
  }
  return publicIndeedResult(filters, page, html, sourceUrl);
}
function normalizeGraphqlJob(job: any, filters: any) {
  const title = clean(job?.title || job?.jobTitle || job?.job_title, 180);
  if (!title) return null;
  const key = clean(job?.key || job?.jobKey || job?.jobId || job?.jrtk, 180);
  const place = job?.location || job?.locations || {};
  const location = Array.isArray(place)
    ? place.map((value: any) => typeof value === "string" ? value : value?.displayName || value?.name || value?.city).filter(Boolean).join(", ")
    : [place?.city, place?.admin1Code || place?.region].filter(Boolean).map((value: any) => clean(value, 100)).join(", ") || clean(place?.displayName || place?.name || filters.location, 180);
  const url = indeedUrl(job?.url || job?.jobUrl || job?.job_url) ? String(job.url || job.jobUrl || job.job_url) : key ? "https://de.indeed.com/viewjob?jk=" + encodeURIComponent(key) : indeedSearchUrl(filters);
  const rawDescription = job?.description?.html || job?.description?.text || job?.description || job?.snippet || "";
  const description = clean(String(rawDescription).replace(/<[^>]*>/g, " "), 1200);
  const salary = clean(job?.salary?.formatted || job?.salary?.text || job?.salaryText || job?.salary_text || job?.compensation || job?.salary, 180);
  const jobType = clean(job?.job_type || job?.jobType || job?.employmentType || "", 100);
  const workSettings = clean(job?.work_settings || job?.workSettings || job?.workSetting || "", 120);
  const ratingValue = job?.company_rating ?? job?.companyRating ?? null;
  const companyRating = Number.isFinite(Number(ratingValue)) && ratingValue !== null && ratingValue !== "" ? Number(ratingValue) : null;
  const sponsored = job?.sponsored === true;
  const advertiserName = clean(job?.advertiser_name || job?.advertiserName || "", 180);
  const postedDate = clean(job?.posted_date || job?.postedDate || job?.dateOnIndeed || job?.datePosted || "", 60);
  return {
    id: key || title + "|" + location,
    jrtk: key || null,
    title,
    company: clean(job?.company || job?.companyName || job?.sourceEmployerName || job?.employer?.name || "", 180),
    location,
    salary,
    job_type: jobType || null,
    work_settings: workSettings || null,
    company_rating: companyRating,
    sponsored,
    advertiser_name: advertiserName || null,
    posted_date: postedDate || null,
    description,
    publishedAt: postedDate,
    snippet: description.slice(0, 500),
    url,
    source: "indeed",
    quickApply: job?.quickApply === true || job?.quick_apply === true
  };
}
async function searchIndeedGraphql(accessToken: string, filters: any, page: number) {
  const radiusKm = Number(filters.radius || 25);
  const radiusMiles = radiusKm <= 0 ? 25 : Math.max(1, Math.round(radiusKm / 1.609344));
  const limit = 10;
  const variables = { what: String(filters.keywords || ""), where: String(filters.location || ""), radius: radiusMiles, limit };
  const detailedQuery = "query SearchJobs($what: String!, $where: String!, $radius: Int!, $limit: Int!) { " +
    "jobSearch(location: { radius: $radius, radiusUnit: MILES, where: $where }, what: $what, limit: $limit) { " +
    "results { job { key title sourceEmployerName dateOnIndeed description { html } location { city admin1Code } } } } }";
  const basicQuery = "query SearchJobs($what: String!, $where: String!, $radius: Int!, $limit: Int!) { " +
    "jobSearch(location: { radius: $radius, radiusUnit: MILES, where: $where }, what: $what, limit: $limit) { " +
    "results { job { title sourceEmployerName } } } }";
  async function requestGraphql(query: string) {
    const response = await fetch("https://apis.indeed.com/graphql", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", authorization: "Bearer " + accessToken },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20000)
    });
    const data = await response.json().catch(() => null);
    return { response, data };
  }
  let { response, data } = await requestGraphql(detailedQuery);
  let errors = Array.isArray(data?.errors) ? data.errors.map((item: any) => clean(item?.message, 240)).filter(Boolean) : [];
  const accessDenied = errors.some((message: string) => /job-retrieval-service|does not have access|forbidden|unauthorized|not authorized/i.test(message));
  if (accessDenied) fail("indeed_job_search_access_required", "Indeed hat die serverseitige Jobsuche für diese App noch nicht freigegeben (job-retrieval-service). Die Suche braucht keine persönliche Anmeldung, aber Indeed muss den API-Zugang für die App aktivieren.", 503);
  if ((!response.ok || errors.length) && errors.length) {
    const basic = await requestGraphql(basicQuery);
    response = basic.response;
    data = basic.data;
    errors = Array.isArray(data?.errors) ? data.errors.map((item: any) => clean(item?.message, 240)).filter(Boolean) : [];
  }
  if (!response.ok || !data || errors.length) {
    const accessDeniedAgain = errors.some((message: string) => /job-retrieval-service|does not have access|forbidden|unauthorized|not authorized/i.test(message));
    if (accessDeniedAgain) fail("indeed_job_search_access_required", "Indeed hat die serverseitige Jobsuche für diese App noch nicht freigegeben (job-retrieval-service). Die Suche braucht keine persönliche Anmeldung, aber Indeed muss den API-Zugang für die App aktivieren.", 503);
    fail("indeed_job_search_failed", errors.join(" ") || "Die offizielle Indeed-Jobsuche lieferte keine gültige Antwort.", 502);
  }
  const raw = data?.data?.jobSearch?.results;
  if (!Array.isArray(raw)) fail("indeed_job_search_invalid_response", "Indeed hat keine auswertbare Stellenliste zurückgegeben.", 502);
  const results = raw.map((item: any) => normalizeGraphqlJob(item?.job || item, filters)).filter(Boolean);
  const unique = new Map<string, any>();
  for (const job of results) unique.set(String(job.id), job);
  const normalized = [...unique.values()];
  const totalValue = data?.data?.jobSearch?.totalCount ?? data?.data?.jobSearch?.total;
  const total = Number.isFinite(Number(totalValue)) && totalValue != null ? Number(totalValue) : null;
  const unsupportedFilters: string[] = [];
  if (filters.quick_apply) unsupportedFilters.push("Schnellbewerbung");
  if (filters.date && filters.date !== "any") unsupportedFilters.push("Veröffentlichungsdatum");
  if (filters.work_setting && filters.work_setting !== "any" && filters.work_setting !== "remote") unsupportedFilters.push("Arbeitsmodell");
  if (filters.apply_filters?.length) unsupportedFilters.push("Jobs für alle");
  if (filters.industry?.length) unsupportedFilters.push("Branche");
  if (filters.employer) unsupportedFilters.push("Arbeitgeber");
  if (filters.source && filters.source !== "any") unsupportedFilters.push("Stellenquelle");
  if (filters.sort && filters.sort !== "relevance") unsupportedFilters.push("Sortierung");
  if (filters.employment && !["fulltime","parttime","contract","internship","temporary"].includes(String(filters.employment))) unsupportedFilters.push("Anstellungsart");
  if (filters.experience) unsupportedFilters.push("Erfahrung");
  if (filters.education?.length) unsupportedFilters.push("Bildungsgrad");
  if (Number(filters.salary_min) > 0) unsupportedFilters.push("Mindestgehalt");
  if (page > 1) fail("indeed_page_not_supported", "Die offizielle Indeed-Suche unterstützt in diesem Abruf noch keine Seitennavigation. Starte die Suche erneut, um die ersten Treffer zu laden.", 400);
  const totalAvailable = total === null ? normalized.length : total;
  return {
    ok: true, provider: "indeed", mode: "official_partner_api", authMode: "server_credentials",
    personalLoginRequired: false, page, pageSize: normalized.length,
    resultsShown: normalized.length, totalAvailable,
    totalApproximate: total === null ? String(normalized.length) : String(total),
    search: clean(filters.keywords, 120), location: clean(filters.location, 120),
    total: totalAvailable, results: normalized, jobs: normalized, hasMore: false,
    sourceUrl: indeedSearchUrl(filters), unsupportedFilters
  };
}
async function searchAction(req: Request, body: any) {
  const { member } = await currentMember(req);
  const filters = body?.filters && typeof body.filters === "object" ? body.filters : {};
  if (!clean(filters.keywords || filters.search, 120)) fail("query_required", "Bitte gib Suchbegriffe ein.", 400);
  if (!clean(filters.location, 120)) fail("location_required", "Bitte gib einen Ort ein.", 400);
  const page = Number.isInteger(Number(body.page)) && Number(body.page) >= 1 && Number(body.page) <= 10 ? Number(body.page) : 1;
  const publicHtml = typeof body.publicHtml === "string" && body.publicHtml.length <= 2500000 ? body.publicHtml : undefined;
  if (publicTestMode()) return searchPublicIndeed(filters, page, publicHtml);
  const connection = await currentConnection(member.workspace_id);
  if (connection?.status !== "connected" || !connection.credential_ciphertext || !connection.credential_iv) {
    fail("indeed_mcp_not_connected", "Für den offiziellen Indeed-MCP muss ein Coach oder Administrator die Workspace-Verbindung einmalig herstellen. Im öffentlichen Testmodus ist kein Indeed-Login erforderlich.", 409);
  }
  const credentials = await decrypt(member.workspace_id, connection);
  if (!credentials?.access_token) fail("indeed_mcp_reconnect_required", "Die Indeed-MCP-Verbindung muss erneut hergestellt werden.", 401);
  const fresh = await refreshCredentials(member.workspace_id, credentials);
  const result = await executeSearch(fresh.access_token, filters, page);
  return {
    ...result,
    mode: "official_mcp",
    authMode: "workspace_oauth",
    personalLoginRequired: false,
    workspaceConnectionRequired: true,
    publicTestMode: false
  };
}
async function completeAction(body: any) {
  const state = clean(body.state, 120);
  const code = clean(body.code, 4096);
  const issuerValue = clean(body.iss, 1000);
  const oauthError = clean(body.error, 200);
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(state)) fail("invalid_state", "Der Indeed-Rücksprung enthält keinen gültigen Zustand.", 400);
  const stateHash = await digestUrl(state);
  const { data: flow, error } = await db.from("coaching_indeed_mcp_auth_flows").select("*").eq("state_hash", stateHash).maybeSingle();
  if (error || !flow || Date.parse(String(flow.expires_at)) <= Date.now()) {
    await db.from("coaching_indeed_mcp_auth_flows").delete().eq("state_hash", stateHash);
    fail("auth_flow_expired", "Der Indeed-Verbindungslink ist abgelaufen. Bitte erneut verbinden.", 410);
  }
  await db.from("coaching_indeed_mcp_auth_flows").delete().eq("state_hash", stateHash);
  if (oauthError) fail("oauth_login_failed", "Indeed hat die Anmeldung abgebrochen: " + oauthError, 400);
  if (!code) fail("invalid_callback", "Indeed hat keinen Autorisierungscode zurückgegeben.", 400);
  if (flow.requires_iss && issuerValue !== flow.issuer) fail("invalid_issuer", "Die Indeed-OAuth-Antwort stammt nicht vom erwarteten Aussteller.", 400);
  if (issuerValue && issuerValue !== flow.issuer) fail("invalid_issuer", "Die Indeed-OAuth-Antwort stammt nicht vom erwarteten Aussteller.", 400);
  const bodyForm = new URLSearchParams({
    grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI,
    client_id: String(flow.client_id), code_verifier: String(flow.code_verifier), resource: String(flow.resource)
  });
  if (flow.scope) bodyForm.set("scope", String(flow.scope));
  const response = await fetch(String(flow.token_endpoint), {
    method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: bodyForm, signal: AbortSignal.timeout(20000)
  });
  const token = await response.json().catch(() => null);
  if (!response.ok || !token?.access_token) {
    console.warn("indeed_mcp_token_exchange_failed", response.status);
    fail("token_exchange_failed", "Indeed hat den MCP-Autorisierungscode nicht akzeptiert. Prüfe, ob der offizielle Endpunkt externe SaaS-Clients zulässt.", 502);
  }
  const credentials = {
    access_token: String(token.access_token), refresh_token: token.refresh_token ? String(token.refresh_token) : null,
    token_type: String(token.token_type || "Bearer"), scope: String(token.scope || flow.scope || ""),
    expires_at: new Date(Date.now() + Math.max(60, Number(token.expires_in || 3600)) * 1000).toISOString(),
    client_id: String(flow.client_id), resource: String(flow.resource), token_endpoint: String(flow.token_endpoint),
    authorization_endpoint: String(flow.authorization_endpoint), issuer: String(flow.issuer || "")
  };
  const session = await initializeMcp(credentials.access_token);
  const tools = await mcpPost(credentials.access_token, 2, "tools/list", {}, session.sessionId, session.protocolVersion);
  if (!Array.isArray(tools.result?.tools) || !tools.result.tools.some((item: any) => /search.*job|job.*search/i.test(String(item.name || "")))) {
    fail("indeed_mcp_tools_unavailable", "Die Verbindung wurde authentifiziert, aber Indeed hat kein Suchwerkzeug für Stellenangebote freigegeben.", 502);
  }
  const encrypted = await encrypt(String(flow.workspace_id), credentials);
  const { error: saveError } = await db.from("coaching_indeed_mcp_connections").upsert({
    workspace_id: flow.workspace_id, status: "connected", ...encrypted, account_hint: null,
    expires_at: credentials.expires_at, last_error: null, connected_by: flow.member_id, updated_at: new Date().toISOString()
  }, { onConflict: "workspace_id" });
  if (saveError) fail("indeed_mcp_storage_unavailable", "Indeed wurde autorisiert, aber die verschlüsselte Verbindung konnte nicht gespeichert werden.", 503);
  return { ok: true, status: "connected", provider: "indeed", mode: "official_mcp" };
}
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  try {
    if (action === "complete") return json(await completeAction(body));
    if (action === "status") return json(await statusAction(req));
    if (action === "configure") return json(await configureAction(req, body));
    if (action === "start") return json(await startAction(req));
    if (action === "search") return json(await searchAction(req, body));
    if (action === "disconnect") {
      const { member } = await currentMember(req);
      const { error } = await db.from("coaching_indeed_mcp_connections").upsert({
        workspace_id: member.workspace_id, status: "disconnected", credential_ciphertext: null,
        credential_iv: null, key_version: 1, account_hint: null, expires_at: null,
        last_error: null, connected_by: member.id, updated_at: new Date().toISOString()
      }, { onConflict: "workspace_id" });
      if (error) fail("indeed_mcp_storage_unavailable", "Die Indeed-Verbindung konnte nicht getrennt werden.", 503);
      return json({ ok: true, status: "disconnected" });
    }
    fail("invalid_action", "Die Indeed-MCP-Aktion ist ungültig.", 400);
  } catch (error) {
    const code = String((error as any)?.code || "indeed_mcp_failed");
    const status = Number((error as any)?.status || 502);
    const message = clean((error as any)?.message || "Die Indeed-MCP-Anfrage ist fehlgeschlagen.", 500);
    console.warn("indeed_mcp_action_failed", JSON.stringify({ action, code, status }));
    return json({ ok: false, error: code, status, message }, status);
  }
});
