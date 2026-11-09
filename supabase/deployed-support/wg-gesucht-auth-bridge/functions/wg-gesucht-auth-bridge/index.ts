import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { completePlatformConnectFlow } from "../_shared/platform-auth-flow.ts";
import { deleteConnection, encryptCredentials, getConnection } from "../application-worker/credentials.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SERVICE_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const HOME = "https://www.wg-gesucht.de";
// WG-Gesucht's web session API expects the same client headers as its own
// website.  Without these headers the login endpoints answer with a generic
// 400, which the connect page can only show as "Verbindung konnte nicht
// abgeschlossen werden".
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CLIENT_ID = "wg_desktop_website";
const enc = new TextEncoder();
const dec = new TextDecoder();

const clean = (value: unknown, max = 500) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const b64 = (bytes: Uint8Array) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const emailOk = (value: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value, 320));

async function secret(name: string) {
  const { data, error } = await db.rpc("get_bot_secret", { secret_name: name });
  if (error || !data) throw Error("configuration_unavailable");
  return String(data);
}

async function internalOk(request: Request) {
  return request.headers.get("x-internal-secret") === await secret("internal_worker_secret");
}

async function key() {
  const raw = unb64(await secret("application_credential_key_v1"));
  if (raw.length !== 32) throw Error("configuration_unavailable");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function seal(value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode("wg-gesucht:mfa:v1") }, await key(), enc.encode(JSON.stringify(value))));
  return `${b64(iv)}.${b64(cipher)}`;
}

async function unseal(value: unknown) {
  const parts = String(value || "").split(".");
  if (parts.length !== 2 || parts.some((part) => !part || part.length > 30000)) throw Error("mfa_expired");
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(parts[0]), additionalData: enc.encode("wg-gesucht:mfa:v1") }, await key(), unb64(parts[1]));
    return JSON.parse(dec.decode(plain));
  } catch { throw Error("mfa_expired"); }
}

type Cookie = { name: string; value: string; domain: string; path: string; expires?: string };
class CookieJar {
  cookies = new Map<string, Cookie>();
  add(headers: Headers) {
    const values = typeof (headers as any).getSetCookie === "function" ? (headers as any).getSetCookie() : this.split(headers.get("set-cookie") || "");
    for (const raw of values) {
      const first = String(raw).split(";")[0];
      const index = first.indexOf("=");
      if (index <= 0) continue;
      const name = clean(first.slice(0, index), 100);
      const value = first.slice(index + 1).trim();
      if (!name || !value || name.length > 100 || value.length > 12000) continue;
      const attrs = new Map(String(raw).split(";").slice(1).map((part) => { const i = part.indexOf("="); return [part.slice(0, i < 0 ? part.length : i).trim().toLowerCase(), i < 0 ? "" : part.slice(i + 1).trim()]; }));
      const domain = clean(attrs.get("domain") || ".wg-gesucht.de", 120).toLowerCase();
      if (!(domain === "wg-gesucht.de" || domain.endsWith(".wg-gesucht.de"))) continue;
      if (value === "" || /max-age=0/i.test(String(raw))) this.cookies.delete(name);
      else this.cookies.set(name, { name, value, domain, path: attrs.get("path") || "/", expires: attrs.get("expires") });
    }
  }
  private split(value: string) { return value ? value.split(/,(?=\s*[^;,=]+=[^;,]*)/) : []; }
  header() { return [...this.cookies.values()].map((cookie) => `${cookie.name}=${cookie.value}`).join("; "); }
  export() { return [...this.cookies.values()]; }
  import(values: unknown) { for (const value of Array.isArray(values) ? values : []) { const name = clean((value as any)?.name, 100), token = String((value as any)?.value || ""), domain = clean((value as any)?.domain || ".wg-gesucht.de", 120).toLowerCase(); if (name && token && (domain === "wg-gesucht.de" || domain.endsWith(".wg-gesucht.de"))) this.cookies.set(name, { name, value: token.slice(0, 12000), domain, path: clean((value as any)?.path, 120) || "/", expires: clean((value as any)?.expires, 120) || undefined }); } }
}

async function flowByState(stateValue: unknown, consumed = false) {
  const state = clean(stateValue, 120);
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(state)) throw Error("auth_flow_expired");
  let query = db.from("platform_auth_flows").select("*").eq("state", state).eq("provider", "wg_gesucht");
  if (!consumed) query = query.is("consumed_at", null).gt("expires_at", new Date().toISOString());
  else query = query.gt("created_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
  const { data, error } = await query.maybeSingle();
  if (error || !data) throw Error("auth_flow_expired");
  const { data: user } = await db.from("bot_users").select("is_active").eq("id", data.user_id).maybeSingle();
  if (!user?.is_active) throw Error("auth_flow_expired");
  return data;
}

async function providerFetch(jar: CookieJar, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("accept", "application/json, text/plain, */*");
  headers.set("user-agent", USER_AGENT);
  headers.set("origin", HOME);
  headers.set("referer", `${HOME}/?modal=sign_in`);
  headers.set("x-client-id", CLIENT_ID);
  headers.set("x-smp-client", "WG-Gesucht");
  // The official web client sends an empty anonymous user id before login.
  // Do not send a fabricated numeric id: WG-Gesucht rejects that request.
  headers.set("x-user-id", "");
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  const cookie = jar.header(); if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${HOME}${path}`, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(30000) });
  jar.add(response.headers);
  return response;
}

async function jsonBody(response: Response) { return response.json().catch(() => null); }
function invalidCredential(body: any) { const value = clean(body?.message || body?.error || body?.detail, 600).toLowerCase(); return /invalid|falsch|ungültig|password|passwort|nicht gefunden|exist/.test(value); }
function sessionFromJar(jar: CookieJar, email: string) { const cookies = jar.export(); if (!cookies.length) throw Error("provider_completion_failed"); return { cookies, userAgent: USER_AGENT, accountHint: email }; }

async function complete(flow: any, jar: CookieJar, email: string) {
  const session = sessionFromJar(jar, email);
  const encrypted = await encryptCredentials(db, String(flow.user_id), "wg_gesucht", session);
  await completePlatformConnectFlow(db, flow, { ...encrypted, account_hint: email, expires_at: null });
  return { status: "connected", authenticated: true, accountHint: email, passwordStored: false, sessionStoredEncrypted: true };
}

async function passwordLogin(state: unknown, emailValue: unknown, passwordValue: unknown) {
  const flow = await flowByState(state);
  const email = clean(emailValue, 320).toLowerCase();
  const password = String(passwordValue || "").slice(0, 1024);
  if (!emailOk(email) || !password) throw Error("login_failed");
  const jar = new CookieJar();
  await providerFetch(jar, "/?modal=sign_in", { method: "GET" });
  const pre = await providerFetch(jar, "/api/pre-sessions", { method: "POST", body: JSON.stringify({ email }) });
  if (pre.status === 202) throw Error("provider_account_not_found");
  const preBody = await jsonBody(pre);
  if (!pre.ok || invalidCredential(preBody)) throw Error("login_failed");
  const login = await providerFetch(jar, "/ajax/sessions.php?action=login", { method: "POST", body: JSON.stringify({ login_email_username: email, login_password: password, display_language: "de" }) });
  const body = await jsonBody(login);
  if (login.status === 202 || body?.token || body?.mfaRequired || body?.verification_required || /verification|bestätigung|code/i.test(clean(body?.detail || body?.message, 500))) {
    const token = clean(body?.token || body?.detail?.token || body?.data?.token, 300);
    if (!token) throw Error("mfa_challenge_failed");
    return { status: "mfa_required", authenticated: false, mfaRequired: true, mfaTicket: await seal({ state: flow.state, token, cookies: jar.export(), email }), factors: [{ id: "wg_code", type: "email", label: "Code per E-Mail" }] };
  }
  if (!login.ok || invalidCredential(body)) throw Error(login.status === 429 ? "account_temporarily_locked" : "login_failed");
  return complete(flow, jar, email);
}

async function mfaVerify(state: unknown, ticketValue: unknown, passCodeValue: unknown) {
  const data = await unseal(ticketValue), flow = await flowByState(state);
  if (String(data?.state) !== String(flow.state)) throw Error("mfa_expired");
  const code = clean(passCodeValue, 32);
  if (!/^\d{4,12}$/.test(code)) throw Error("mfa_invalid_code");
  const jar = new CookieJar(); jar.import(data.cookies);
  const response = await providerFetch(jar, "/ajax/sessions.php?action=verify_login", { method: "POST", body: JSON.stringify({ verification_code: code, token: clean(data.token, 300) }) });
  const body = await jsonBody(response);
  if (!response.ok || invalidCredential(body) || /invalid|expired|ungültig|abgelaufen/i.test(clean(body?.message || body?.error, 400))) throw Error(response.status === 429 ? "account_temporarily_locked" : "mfa_invalid_code");
  return complete(flow, jar, clean(data.email, 320).toLowerCase());
}

async function mfaStart(state: unknown, ticketValue: unknown) {
  const data = await unseal(ticketValue), flow = await flowByState(state);
  if (String(data?.state) !== String(flow.state)) throw Error("mfa_expired");
  const token = clean(data?.token, 300);
  if (!token) throw Error("mfa_challenge_failed");
  const jar = new CookieJar(); jar.import(data.cookies);
  // The official client exposes a resend action after the password step. It
  // is important to invoke the provider endpoint here; merely returning the
  // ticket leaves the user with a code form but no fresh code request.
  const response = await providerFetch(jar, "/api/auth-verifications/send-code", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    if (response.status === 429) throw Error("account_temporarily_locked");
    throw Error("mfa_challenge_failed");
  }
  return {
    status: "mfa_required",
    authenticated: false,
    mfaRequired: true,
    mfaTicket: await seal({ ...data, cookies: jar.export() }),
    factors: [{ id: "wg_code", type: "email", label: "Code per E-Mail" }],
    codeDispatched: true,
  };
}

async function check(userId: string) {
  const connection = await getConnection(db, userId, "wg_gesucht");
  if (!connection?.credentials?.cookies?.length) return { status: "needs_login", authenticated: false };
  const jar = new CookieJar(); jar.import(connection.credentials.cookies);
  let response: Response;
  try { response = await providerFetch(jar, "/meine-anzeigen.html", { method: "GET" }); }
  catch { return { status: "error", authenticated: null, error: "temporary_network_error" }; }
  const location = response.headers.get("location") || "";
  const needsLogin = response.status === 401 || response.status === 403 || /sign_in|login/i.test(location) || response.url.includes("modal=sign_in");
  if (needsLogin) {
    await markConnection(db, userId, "wg_gesucht", "needs_login", "session_rejected").catch(() => {});
    return { status: "needs_login", authenticated: false };
  }
  if (response.status === 429 || response.status >= 500) return { status: "error", authenticated: null, error: "provider_temporarily_unavailable", httpStatus: response.status };
  if (!response.ok) return { status: "error", authenticated: null, error: "session_check_unconfirmed", httpStatus: response.status };
  const encrypted = await encryptCredentials(db, userId, "wg_gesucht", { ...connection.credentials, cookies: jar.export(), userAgent: connection.credentials.userAgent || USER_AGENT });
  const { error } = await db.from("platform_connections").update({ ...encrypted, status: "connected", last_verified_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("provider", "wg_gesucht");
  if (error) throw Error("connection_refresh_save_failed");
  return { status: "connected", authenticated: true, sessionRefreshed: true, sessionStoredEncrypted: true };
}

async function handle(request: Request) {
  if (!(await internalOk(request))) return new Response("unauthorized", { status: 401 });
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  if (action === "health") return Response.json({ ok: true, provider: "wg_gesucht" });
  if (action === "password_login") return Response.json(await passwordLogin(body.state, body.email, body.password));
  if (action === "mfa_start") return Response.json(await mfaStart(body.state, body.mfaTicket));
  if (action === "mfa_verify") return Response.json(await mfaVerify(body.state, body.mfaTicket, body.passCode));
  if (action === "check") return Response.json(await check(clean(body.userId, 80)));
  if (action === "disconnect") { await deleteConnection(db, clean(body.userId, 80), "wg_gesucht"); return Response.json({ status: "disconnected" }); }
  throw Error("invalid_action");
}

Deno.serve(async (request) => {
  try { return await handle(request); }
  catch (error: any) {
    const code = String(error?.message || "wg_gesucht_auth_failed");
    const safe = new Set(["auth_flow_expired", "configuration_unavailable", "provider_account_not_found", "login_failed", "mfa_expired", "mfa_invalid_code", "mfa_challenge_failed", "provider_completion_failed", "account_temporarily_locked", "connection_read_failed", "disconnect_failed", "invalid_action"]);
    const status = code === "auth_flow_expired" || code === "mfa_expired" ? 410 : code === "provider_account_not_found" || code === "login_failed" || code === "mfa_invalid_code" ? 401 : code === "account_temporarily_locked" ? 423 : 503;
    return Response.json({ error: safe.has(code) ? code : "wg_gesucht_auth_failed" }, { status, headers: { "cache-control": "no-store" } });
  }
});
