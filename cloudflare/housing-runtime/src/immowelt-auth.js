import { credentialKeyBytes } from "./provider-credentials.js";

const START = "https://signin.immowelt.de/?target=portal&path=%2F";
const AUTH = "https://signin.immowelt.de";
const REFRESH = AUTH + "/refresh";
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36";
const enc = new TextEncoder();
const dec = new TextDecoder();

function clean(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function b64(bytes) { let out = ""; for (const byte of bytes) out += String.fromCharCode(byte); return btoa(out); }
function unb64(value) { return Uint8Array.from(atob(String(value || "")), (character) => character.charCodeAt(0)); }
function b64url(bytes) { return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function unb64url(value) { return unb64(String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value).length / 4) * 4, "=")); }
function cookieKey(cookie) { return cookie.domain + "|" + cookie.path + "|" + cookie.name; }
function allowedUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error("provider_contract_unverified"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !(host === "immowelt.de" || host.endsWith(".immowelt.de"))) throw new Error("provider_contract_unverified");
  return url;
}
function defaultPath(path) {
  if (!path || path[0] !== "/" || path === "/") return "/";
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "/" : path.slice(0, slash + 1);
}
function cookieMatches(cookie, urlValue) {
  const url = new URL(urlValue), rawDomain = String(cookie.domain || "").toLowerCase();
  const domain = rawDomain.replace(/^\./, "");
  const hostOnly = cookie.hostOnly === true || (cookie.hostOnly == null && !rawDomain.startsWith("."));
  const domainOk = hostOnly ? url.hostname.toLowerCase() === domain
    : url.hostname.toLowerCase() === domain || url.hostname.toLowerCase().endsWith("." + domain);
  const expiry = Number(cookie.expires);
  return domainOk && (!cookie.secure || url.protocol === "https:") &&
    (!Number.isFinite(expiry) || expiry < 0 || expiry > Date.now() / 1000) &&
    url.pathname.startsWith(String(cookie.path || "/"));
}
function cookiesForUrl(cookies, urlValue) {
  return (Array.isArray(cookies) ? cookies : []).filter((cookie) => cookieMatches(cookie, urlValue))
    .sort((a, b) => String(b.path || "/").length - String(a.path || "/").length);
}
function cookieValue(cookies, name, urlValue = "https://www.immowelt.de/") {
  return String(cookiesForUrl(cookies, urlValue).find((cookie) => cookie.name === name)?.value || "");
}
function cookieHeader(cookies, urlValue) {
  return cookiesForUrl(cookies, urlValue).map((cookie) => String(cookie.name) + "=" + String(cookie.value)).join("; ");
}
function cookieJar(cookies) {
  const jar = new Map();
  for (const source of Array.isArray(cookies) ? cookies : []) {
    const rawDomain = String(source.domain || "").toLowerCase();
    const cookie = { ...source, domain: rawDomain.replace(/^\./, ""),
      hostOnly: source.hostOnly === true || (source.hostOnly == null && !rawDomain.startsWith(".")) };
    if (cookie.name && cookie.domain) jar.set(cookieKey(cookie), cookie);
  }
  return jar;
}
function sessionCookies(jar) {
  return [...jar.values()].filter((cookie) => {
    const domain = String(cookie.domain || "").toLowerCase().replace(/^\./, "");
    const expiry = Number(cookie.expires);
    return (domain === "immowelt.de" || domain.endsWith(".immowelt.de")) &&
      (!Number.isFinite(expiry) || expiry < 0 || expiry > Date.now() / 1000);
  }).map((cookie) => ({
    name: clean(cookie.name, 240), value: String(cookie.value || "").slice(0, 12000),
    domain: cookie.hostOnly ? cookie.domain : "." + cookie.domain, path: clean(cookie.path, 500) || "/",
    expires: Number.isFinite(Number(cookie.expires)) ? Number(cookie.expires) : -1,
    httpOnly: cookie.httpOnly === true, secure: cookie.secure !== false,
    sameSite: clean(cookie.sameSite, 40) || undefined,
  })).filter((cookie) => cookie.name && cookie.value);
}
function tokenExpiry(cookies) {
  const value = Number(cookieValue(cookies, "oauth.access.expiration"));
  return Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : null;
}
function setCookies(headers, urlValue, jar) {
  const url = new URL(urlValue);
  let lines = [];
  try { lines = headers.getSetCookie?.() || []; } catch {}
  if (!lines.length) {
    const single = headers.get("set-cookie");
    if (single) lines = [single];
  }
  for (const line of lines) {
    const parts = String(line || "").split(";").map((part) => part.trim()).filter(Boolean);
    const first = parts.shift() || "", equal = first.indexOf("=");
    if (equal <= 0) continue;
    const cookie = { name: first.slice(0, equal).trim(), value: first.slice(equal + 1),
      domain: url.hostname.toLowerCase(), path: defaultPath(url.pathname),
      expires: -1, httpOnly: false, secure: false, hostOnly: true };
    let maxAge = null;
    for (const part of parts) {
      const index = part.indexOf("="), key = (index < 0 ? part : part.slice(0, index)).trim().toLowerCase();
      const value = index < 0 ? "" : part.slice(index + 1).trim();
      if (key === "domain" && value) { cookie.domain = value.replace(/^\./, "").toLowerCase(); cookie.hostOnly = false; }
      else if (key === "path" && value) cookie.path = value;
      else if (key === "max-age") maxAge = Number(value);
      else if (key === "expires") { const parsed = Date.parse(value); if (Number.isFinite(parsed)) cookie.expires = Math.floor(parsed / 1000); }
      else if (key === "httponly") cookie.httpOnly = true;
      else if (key === "secure") cookie.secure = true;
      else if (key === "samesite" && value) cookie.sameSite = value[0].toUpperCase() + value.slice(1).toLowerCase();
    }
    if (maxAge !== null && Number.isFinite(maxAge)) cookie.expires = maxAge <= 0 ? 0 : Math.floor(Date.now() / 1000 + maxAge);
    const key = cookieKey(cookie);
    if (cookie.expires === 0 || !cookie.value) jar.delete(key); else jar.set(key, cookie);
  }
}
async function request(urlValue, init, jar, userAgent = UA) {
  const url = allowedUrl(urlValue), headers = new Headers(init.headers || {});
  const cookie = cookieHeader([...jar.values()], url.href);
  if (cookie) headers.set("cookie", cookie);
  headers.set("user-agent", userAgent);
  headers.set("accept-language", "de-DE,de;q=0.9,en;q=0.8");
  let response;
  try {
    response = await fetch(url.href, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(25_000) });
  } catch { throw new Error("temporary_network_error"); }
  setCookies(response.headers, url.href, jar);
  return response;
}
function decodeHtml(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}
function attr(tag, name) {
  const match = tag.match(new RegExp("\\b" + name + "\\s*=\\s*[\"']([^\"']*)[\"']", "i"));
  return match ? decodeHtml(match[1]) : null;
}
function primaryForm(html) {
  const form = String(html).match(/<form[^>]*data-form-primary=["']true["'][^>]*>[\s\S]*?<\/form>/i)?.[0] ||
    String(html).match(/<form[^>]*>[\s\S]*?<\/form>/i)?.[0];
  if (!form) return null;
  const open = form.match(/^<form[^>]*>/i)?.[0] || "";
  return { html: form, action: attr(open, "action") };
}
function formInputs(form) {
  const values = {};
  for (const match of String(form).matchAll(/<input[^>]*>/gi)) {
    const name = attr(match[0], "name");
    if (name) values[name] = attr(match[0], "value") || "";
  }
  return values;
}
function hasCredentialForm(html) {
  const form = primaryForm(html)?.html || "";
  return /name=["']username["']/i.test(form) && /name=["']password["']/i.test(form);
}
function codeField(html) {
  const form = primaryForm(html)?.html || "";
  for (const match of form.matchAll(/<input[^>]*>/gi)) {
    const name = attr(match[0], "name") || "", type = (attr(match[0], "type") || "text").toLowerCase();
    if (type === "hidden" || ["username", "password", "state"].includes(name)) continue;
    if (/code|otp|passcode|token|mfa/i.test(name) || /one-time-code/i.test(match[0])) return name;
  }
  return null;
}
function challengeType(html) {
  const text = clean(String(html).replace(/<[^>]+>/g, " "), 10000).toLowerCase();
  if (/authenticator|totp/.test(text)) return "token:software:totp";
  if (/sms|mobilfunk|telefonnummer/.test(text)) return "sms";
  if (/e-?mail|email/.test(text)) return "email";
  return "code";
}
function factorLabel(type) {
  return type === "email" ? "Code per E-Mail" : type === "sms" ? "Code per SMS" :
    type === "token:software:totp" ? "Authenticator-App" : "Bestätigungscode";
}
function isHumanCheck(html) {
  return /captcha|verify you are human|ich bin kein roboter|sicherheitsüberprüfung/i.test(clean(String(html).replace(/<[^>]+>/g, " "), 10000));
}
function isDeviceConfirmation(html) {
  const text = clean(String(html).replace(/<[^>]+>/g, " "), 10000).toLowerCase();
  return /(bestätige|confirm|verify).{0,80}(e-?mail|gerät|device)|(e-?mail|gerät|device).{0,80}(bestätige|confirm|verify)/.test(text) && !codeField(html);
}
async function sealMfa(env, value) {
  const key = await crypto.subtle.importKey("raw", credentialKeyBytes(env.APPLICATION_CREDENTIAL_KEY || env.CENTRAL_TOKEN_ENCRYPTION_KEY), { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode("immowelt:mfa:v1") }, key, enc.encode(JSON.stringify(value))));
  return b64url(iv) + "." + b64url(cipher);
}
async function openMfa(env, value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 2) throw new Error("mfa_expired");
  try {
    const key = await crypto.subtle.importKey("raw", credentialKeyBytes(env.APPLICATION_CREDENTIAL_KEY || env.CENTRAL_TOKEN_ENCRYPTION_KEY), { name: "AES-GCM" }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(parts[0]), additionalData: enc.encode("immowelt:mfa:v1") }, key, unb64url(parts[1]));
    const data = JSON.parse(dec.decode(plain));
    if (!data?.exp || Date.now() > Number(data.exp)) throw new Error("mfa_expired");
    return data;
  } catch (error) { if (error?.message === "mfa_expired") throw error; throw new Error("mfa_expired"); }
}
function checkMfaFlow(data, flow) {
  if (data.flowState !== flow.state || String(data.participantId) !== String(flow.participant_id)) throw new Error("mfa_expired");
}
async function mfaResult(env, flow, email, url, html, jar) {
  const field = codeField(html);
  if (!field) {
    if (isDeviceConfirmation(html)) throw new Error("device_confirmation_required");
    throw new Error("provider_interactive_challenge");
  }
  const form = primaryForm(html);
  if (!form) throw new Error("provider_contract_unverified");
  const type = challengeType(html);
  const ticket = await sealMfa(env, {
    v: 1, exp: Date.now() + 10 * 60_000, flowState: flow.state,
    participantId: String(flow.participant_id), email, url, hidden: formInputs(form.html),
    codeField: field, type, cookies: [...jar.values()],
  });
  return { status: "mfa_required", authenticated: false, mfaRequired: true, codeDispatched: true,
    mfaTicket: ticket, factors: [{ id: "immowelt_code", type, label: factorLabel(type) }] };
}
function loginSuccess(email, jar) {
  const cookies = sessionCookies(jar);
  if (!cookies.length || !cookieValue(cookies, "oauth.access.token")) throw new Error("provider_completion_failed");
  return { status: "connected", authenticated: true, accountHint: email, passwordStored: false,
    session: { cookies, userAgent: UA } };
}
async function settle(env, flow, email, startUrl, initialResponse, jar, afterCredential) {
  let url = allowedUrl(startUrl), response = initialResponse;
  for (let hop = 0; hop < 12; hop++) {
    if (response.status === 429) throw new Error("account_temporarily_locked");
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("provider_contract_unverified");
      url = allowedUrl(new URL(location, url).href);
      response = await request(url.href, { method: "GET", headers: { accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8" } }, jar);
      continue;
    }
    const html = await response.text().catch(() => "");
    const host = url.hostname.toLowerCase();
    if (host === "signin.immowelt.de") {
      if (isHumanCheck(html)) throw new Error("human_verification_required");
      if (codeField(html) || isDeviceConfirmation(html)) return mfaResult(env, flow, email, url.href, html, jar);
      if (hasCredentialForm(html)) {
        if (afterCredential) throw new Error("login_failed");
        throw new Error("provider_contract_unverified");
      }
      throw new Error("provider_interactive_challenge");
    }
    if (host === "immowelt.de" || host.endsWith(".immowelt.de")) return loginSuccess(email, jar);
    throw new Error("provider_contract_unverified");
  }
  throw new Error("provider_contract_unverified");
}
async function initTransaction() {
  const jar = new Map();
  const first = await request(START, { method: "GET", headers: { accept: "text/html,application/xhtml+xml" } }, jar);
  const location = first.headers.get("location");
  if (!location) throw new Error("provider_contract_unverified");
  const loginUrl = allowedUrl(new URL(location, START).href).href;
  if (new URL(loginUrl).hostname !== "signin.immowelt.de") throw new Error("provider_contract_unverified");
  const response = await request(loginUrl, { method: "GET", headers: { accept: "text/html,application/xhtml+xml" } }, jar);
  const html = await response.text().catch(() => "");
  if (!response.ok || !hasCredentialForm(html)) throw new Error("provider_contract_unverified");
  const form = primaryForm(html);
  if (!form) throw new Error("provider_contract_unverified");
  return { jar, loginUrl, form };
}
export async function loginImmowelt(env, flow, emailValue, passwordValue) {
  if (flow.provider !== "immowelt" || flow.context?.central_account !== true) throw new Error("provider_unsupported");
  const email = clean(emailValue, 320).toLowerCase(), password = String(passwordValue || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 1024) throw new Error("login_failed");
  const tx = await initTransaction(), fields = formInputs(tx.form.html);
  fields.username = email;
  fields.password = password;
  const target = tx.form.action ? new URL(tx.form.action, tx.loginUrl) : new URL(tx.loginUrl);
  if (target.hostname.toLowerCase() !== "signin.immowelt.de") throw new Error("provider_contract_unverified");
  const response = await request(target.href, {
    method: "POST",
    headers: { accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "content-type": "application/x-www-form-urlencoded", origin: AUTH, referer: tx.loginUrl },
    body: new URLSearchParams(fields),
  }, tx.jar);
  return settle(env, flow, email, target.href, response, tx.jar, true);
}
export async function startImmoweltMfa(env, ticket, flow) {
  const data = await openMfa(env, ticket);
  checkMfaFlow(data, flow);
  return { status: "mfa_code_required", authenticated: false, mfaRequired: true, codeDispatched: true,
    mfaTicket: String(ticket), factors: [{ id: "immowelt_code", type: data.type, label: factorLabel(data.type) }] };
}
export async function verifyImmoweltMfa(env, ticket, flow, factorId, passCode) {
  if (String(factorId || "") !== "immowelt_code") throw new Error("mfa_factor_unsupported");
  const code = String(passCode || "").trim();
  if (!/^[A-Za-z0-9-]{4,16}$/.test(code)) throw new Error("mfa_invalid_code");
  const data = await openMfa(env, ticket);
  checkMfaFlow(data, flow);
  const jar = cookieJar(data.cookies), fields = { ...(data.hidden || {}) };
  fields[String(data.codeField || "code")] = code;
  const url = allowedUrl(data.url);
  if (url.hostname !== "signin.immowelt.de") throw new Error("mfa_expired");
  const response = await request(url.href, {
    method: "POST",
    headers: { accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "content-type": "application/x-www-form-urlencoded", origin: AUTH, referer: url.href },
    body: new URLSearchParams(fields),
  }, jar);
  try { return await settle(env, flow, String(data.email), url.href, response, jar, false); }
  catch (error) {
    if (["provider_interactive_challenge", "login_failed"].includes(String(error?.message || error))) throw new Error("mfa_invalid_code");
    throw error;
  }
}
export async function refreshImmoweltCookies(credentials, force = false) {
  let cookies = Array.isArray(credentials?.cookies) ? credentials.cookies : [];
  const userAgent = String(credentials?.userAgent || UA);
  let token = cookieValue(cookies, "oauth.access.token");
  const expiration = Number(cookieValue(cookies, "oauth.access.expiration"));
  const fresh = !!token && (!Number.isFinite(expiration) || expiration > Date.now() / 1000 + 60);
  if (fresh && !force) return { ...credentials, cookies, userAgent, expires_at: tokenExpiry(cookies) };
  const jar = cookieJar(cookies);
  let url = REFRESH, response = null;
  for (let hop = 0; hop < 8; hop++) {
    response = await request(url, { method: "GET", headers: { accept: "*/*",
      origin: "https://www.immowelt.de", referer: "https://www.immowelt.de/" } }, jar, userAgent);
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (!location) throw new Error("temporary_network_error");
    url = allowedUrl(new URL(location, url).href).href;
  }
  if (!response?.ok) throw new Error(response?.status === 401 || response?.status === 403 ? "needs_login" : "temporary_network_error");
  cookies = sessionCookies(jar);
  token = cookieValue(cookies, "oauth.access.token");
  if (!token) throw new Error("needs_login");
  return { ...credentials, cookies, userAgent, expires_at: tokenExpiry(cookies) };
}
