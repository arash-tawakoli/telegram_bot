import centralTokenWorker from "./immoscout-central-token.js";
import { encryptProviderCredentials } from "./provider-credentials.js";

const PROVIDERS = new Set(["immoscout24", "immowelt", "immomio"]);
const IMMOMIO_GQL = "https://gql-ps.immomio.com/tenant/graphql";
const IMMOMIO_TENANT = "https://tenant.immomio.com";
const IMMOMIO_REDIRECT = "https://tenant.immomio.com/de/auth/login";
const IMMOMIO_CLIENT = "immomio-oidc-web";
const IMMOMIO_REALM = "immomio";
const IMMOMIO_BASE = "https://sso.immomio.com/auth";
const SCOUT_ISSUER = "https://login.immobilienscout24.de/oauth2/aus1227au6oBg6hGH417";
const SCOUT_AUTHORIZE = `${SCOUT_ISSUER}/v1/authorize`;
const SCOUT_TOKEN = `${SCOUT_ISSUER}/v1/token`;
const SCOUT_USERINFO = `${SCOUT_ISSUER}/v1/userinfo`;
const SCOUT_AUTHN = "https://login.immobilienscout24.de/api/v1/authn";
const SCOUT_CLIENT = "is24-android-de";
const SCOUT_REDIRECT = "immobilienscout24.de:/loginCallback";
const SCOUT_SCOPE = "openid profile offline_access";
const SCOUT_UA = "okta-oauth2-kotlin/2.0.3 Android/34";
const enc = new TextEncoder();
const dec = new TextDecoder();

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function clean(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function validEmail(value) {
  const email = clean(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
function b64(bytes) { let value = ""; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value); }
function unb64(value) { return Uint8Array.from(atob(String(value || "")), (character) => character.charCodeAt(0)); }
function b64url(bytes) { return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function unb64url(value) { return unb64(String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value).length / 4) * 4, "=")); }
function randomToken(size = 32) { return b64url(crypto.getRandomValues(new Uint8Array(size))); }
async function challenge(value) { return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)))); }
function json(body, status = 200, extra = {}) { return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } }); }
function ticket(value) { const state = String(value || ""); if (!/^[A-Za-z0-9_-]{20,100}$/.test(state)) throw new Error("invalid_ticket"); return state; }
function parseContext(value) { try { return value && typeof value === "object" ? value : JSON.parse(value || "{}"); } catch { return {}; } }
function profileValue(row, key) { const profile = parseContext(row?.profile); return row?.[key] ?? profile?.[key] ?? null; }

async function flowFor(sql, value, allowConsumed = false) {
  const state = ticket(value);
  if (state.startsWith("cfcentral_")) return { state, central: true, provider: "immoscout24", context: { central_account: true }, return_target: "telegram" };
  const rows = allowConsumed
    ? await sql`SELECT id,participant_id,provider,state,code_verifier,origin,return_target,context,created_at,expires_at,consumed_at FROM provider_auth_flows WHERE state=${state} AND expires_at>CURRENT_TIMESTAMP LIMIT 1`
    : await sql`SELECT id,participant_id,provider,state,code_verifier,origin,return_target,context,created_at,expires_at,consumed_at FROM provider_auth_flows WHERE state=${state} AND expires_at>CURRENT_TIMESTAMP AND consumed_at IS NULL LIMIT 1`;
  const flow = rows[0];
  if (!flow) throw new Error("auth_flow_expired");
  if (!PROVIDERS.has(String(flow.provider))) throw new Error("provider_unsupported");
  const participant = (await sql`SELECT id,status,first_name,last_name,telegram_user_id,telegram_chat_id FROM participants WHERE id=${flow.participant_id} LIMIT 1`)[0];
  if (!participant || participant.status !== "active") throw new Error("auth_flow_expired");
  return { ...flow, context: parseContext(flow.context), participant };
}

export async function issueProviderAuthFlow(sql, participantId, provider, origin = "coach", returnTarget = "coach", context = {}) {
  if (!PROVIDERS.has(String(provider))) throw new Error("provider_unsupported");
  const participant = (await sql`SELECT id,status FROM participants WHERE id=${participantId} LIMIT 1`)[0];
  if (!participant || participant.status !== "active") throw new Error("participant_forbidden");
  await sql`DELETE FROM provider_auth_flows WHERE participant_id=${participantId} AND provider=${provider} AND consumed_at IS NULL`;
  const state = randomToken(32);
  const verifier = randomToken(48);
  const expires = new Date(Date.now() + 30 * 60_000).toISOString();
  await sql`
    INSERT INTO provider_auth_flows (id,participant_id,provider,state,code_verifier,origin,return_target,context,expires_at)
    VALUES (${crypto.randomUUID()},${participantId},${provider},${state},${verifier},${origin},${returnTarget},${JSON.stringify(context)},${expires})
  `;
  await sql`
    INSERT INTO provider_connections (id,participant_id,provider,status)
    VALUES (${crypto.randomUUID()},${participantId},${provider},'pending')
    ON CONFLICT (participant_id,provider) DO UPDATE SET status='pending',updated_at=CURRENT_TIMESTAMP
  `;
  return { state, expiresAt: expires };
}

async function participantInfo(sql, flow) {
  if (flow.central) return { participantLabel: "NexaLabs · zentraler ImmoScout24-Zugang", profileEmail: null, accountHint: "arash@nexalabs.de" };
  const row = (await sql`
    SELECT p.first_name,p.last_name,ap.profile,pc.account_hint
      FROM participants p
      LEFT JOIN applicant_profiles ap ON ap.participant_id=p.id
      LEFT JOIN provider_connections pc ON pc.participant_id=p.id AND pc.provider=${flow.provider}
     WHERE p.id=${flow.participant_id}
     LIMIT 1
  `)[0] || {};
  const first = clean(profileValue(row, "first_name") || row.first_name, 80);
  const last = clean(profileValue(row, "last_name") || row.last_name, 80);
  return {
    participantLabel: [first, last ? `${last[0]}.` : ""].filter(Boolean).join(" ") || "Teilnehmer",
    profileEmail: validEmail(profileValue(row, "email")),
    accountHint: validEmail(row.account_hint),
  };
}

async function resolveSso(email) {
  const query = "query sso($email: String, $redirectUri: String!, $loginMethod: String) { sso(input: { email: $email redirectUri: $redirectUri loginMethod: $loginMethod }) { baseUrl clientId realm } }";
  let response;
  try {
    response = await fetch(IMMOMIO_GQL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", origin: IMMOMIO_TENANT, referer: `${IMMOMIO_TENANT}/` },
      body: JSON.stringify({ query, variables: { email, redirectUri: IMMOMIO_REDIRECT, loginMethod: "DEFAULT" } }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch { throw new Error("temporary_network_error"); }
  const body = await response.json().catch(() => null);
  const sso = body?.data?.sso;
  if (!response.ok || body?.errors?.length || !sso || String(sso.clientId) !== IMMOMIO_CLIENT || String(sso.realm) !== IMMOMIO_REALM) throw new Error("provider_contract_unverified");
  return { baseUrl: IMMOMIO_BASE, realm: IMMOMIO_REALM, clientId: IMMOMIO_CLIENT };
}

async function immomioUrl(flow, emailValue) {
  const email = validEmail(emailValue);
  if (!email) throw new Error("provider_email_required");
  const cfg = await resolveSso(email);
  const url = new URL(`${cfg.baseUrl}/realms/${cfg.realm}/protocol/openid-connect/auth`);
  const values = { client_id: cfg.clientId, redirect_uri: IMMOMIO_REDIRECT, response_type: "code", response_mode: "query", scope: "openid profile email", state: flow.state, code_challenge: await challenge(flow.code_verifier), code_challenge_method: "S256", login_hint: email, prompt: "login" };
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
  return url.href;
}

function callbackUrl(value, state) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { throw new Error("invalid_callback_url"); }
  if (url.origin !== "https://tenant.immomio.com" || url.pathname !== "/de/auth/login" || url.searchParams.get("state") !== state || !url.searchParams.get("code")) throw new Error("invalid_callback_url");
  return url;
}
async function completeFlow(sql, flow, env, encrypted, accountHint, expiresAt = null) {
  const claim = await sql.unsafe("UPDATE provider_auth_flows SET consumed_at=CURRENT_TIMESTAMP WHERE id=? AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP", [flow.id]);
  if (!claim.count) throw new Error("auth_flow_expired");
  await sql.unsafe(
    "UPDATE provider_connections SET status='connected',ciphertext=?,iv=?,key_version=?,account_hint=?,expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE participant_id=? AND provider=?",
    [encrypted.ciphertext, encrypted.iv, encrypted.key_version, accountHint || null, expiresAt, flow.participant_id, flow.provider],
  );
  if (flow.origin === "telegram" && flow.participant_id && env.TELEGRAM_BOT_TOKEN) {
    const participant = (await sql`SELECT telegram_chat_id,first_name,last_name FROM participants WHERE id=${flow.participant_id} LIMIT 1`)[0];
    if (participant?.telegram_chat_id) {
      const label = flow.provider === "immomio" ? "Immomio" : flow.provider === "immowelt" ? "Immowelt" : "ImmoScout24";
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: participant.telegram_chat_id, parse_mode: "HTML", text: `✅ <b>${label} verbunden</b>\n\nDein Konto wurde erfolgreich verbunden.` }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {});
    }
  }
  return { status: "connected", authenticated: true, accountHint: accountHint || null };
}

function immoweltSession(value) {
  const cookies = Array.isArray(value?.cookies) ? value.cookies : [];
  if (!cookies.length || cookies.length > 100) throw new Error("provider_completion_failed");
  const safe = cookies.map((row) => {
    const domain = clean(row?.domain, 320).toLowerCase();
    if (!row?.name || !row?.value || !(domain === "immowelt.de" || domain.endsWith(".immowelt.de") || domain === "signin.immowelt.de")) return null;
    return { name: clean(row.name, 240), value: String(row.value).slice(0, 12_000), domain, path: clean(row.path, 500) || "/", expires: Number.isFinite(Number(row.expires)) ? Number(row.expires) : -1, httpOnly: row.httpOnly === true, secure: row.secure !== false, sameSite: clean(row.sameSite, 40) || undefined };
  }).filter(Boolean);
  if (!safe.length) throw new Error("provider_completion_failed");
  return { cookies: safe, userAgent: clean(value?.userAgent, 500) || "TraumWohnungHamburg/1.0" };
}

async function completeSession(sql, env, flow, value, accountHint) {
  if (flow.provider !== "immowelt") throw new Error("provider_unsupported");
  const session = immoweltSession(value);
  const hint = validEmail(accountHint);
  if (accountHint && !hint) throw new Error("provider_completion_failed");
  const encrypted = await encryptProviderCredentials(env, session, flow.participant_id, "immowelt");
  return completeFlow(sql, flow, env, encrypted, hint, null);
}

async function verifyImmomio(accessToken) {
  const query = "query currentUser { user { id email } }";
  const response = await fetch(IMMOMIO_GQL, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", origin: IMMOMIO_TENANT, referer: `${IMMOMIO_TENANT}/`, authorization: accessToken }, body: JSON.stringify({ query, variables: {} }), signal: AbortSignal.timeout(20_000) }).catch(() => null);
  const body = await response?.json().catch(() => null);
  const user = body?.data?.user;
  if (!response?.ok || body?.errors?.length || !user?.id) throw new Error("token_exchange_failed");
  return user;
}

async function completeImmomio(sql, env, flow, value) {
  const url = callbackUrl(value, flow.state);
  // The state-bound PKCE authorization was validated when the URL was issued.
  // The applicant profile email is not the operator account's login identity.
  const cfg = { baseUrl: IMMOMIO_BASE, realm: IMMOMIO_REALM, clientId: IMMOMIO_CLIENT };
  const response = await fetch(`${cfg.baseUrl}/realms/${cfg.realm}/protocol/openid-connect/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: url.searchParams.get("code"), redirect_uri: IMMOMIO_REDIRECT, code_verifier: String(flow.code_verifier), client_id: cfg.clientId }),
    signal: AbortSignal.timeout(25_000),
  }).catch(() => null);
  const token = await response?.json().catch(() => null);
  if (!response?.ok || !token?.access_token || !token?.refresh_token) throw new Error("token_exchange_failed");
  const user = await verifyImmomio(String(token.access_token));
  const accountHint = validEmail(user?.email);
  if (!accountHint) throw new Error("token_exchange_failed");
  const expiresAt = new Date(Date.now() + Math.max(60, Number(token.expires_in || 300)) * 1000).toISOString();
  const credentials = { access_token: String(token.access_token), refresh_token: String(token.refresh_token), id_token: token.id_token ? String(token.id_token) : undefined, expires_at: expiresAt, base_url: cfg.baseUrl, realm: cfg.realm, client_id: cfg.clientId, redirect_uri: IMMOMIO_REDIRECT };
  const encrypted = await encryptProviderCredentials(env, credentials, flow.participant_id, "immomio");
  return completeFlow(sql, flow, env, encrypted, accountHint, expiresAt);
}

async function immomioPasswordLogin(sql, env, flow, emailValue, passwordValue) {
  const email = validEmail(emailValue), password = String(passwordValue || "").slice(0, 1024);
  if (!email) throw new Error("provider_email_required");
  if (!password) throw new Error("login_failed");
  const cfg = await resolveSso(email);
  let response;
  try {
    response = await fetch(`${cfg.baseUrl}/realms/${cfg.realm}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "password", client_id: cfg.clientId, username: email, password, scope: "openid profile email" }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch { throw new Error("temporary_network_error"); }
  const token = await response.json().catch(() => null);
  if (!response.ok || !token?.access_token || !token?.refresh_token) {
    const description = clean(token?.error_description, 500).toLowerCase();
    const error = clean(token?.error, 120).toLowerCase();
    if (/otp|totp|one.?time|authenticator|two.?factor/.test(description)) throw new Error("provider_interactive_challenge");
    if (/temporar.*(disabled|locked)|account.*(disabled|locked)|too many.*(attempt|login)|brute.?force|locked out/.test(description)) throw new Error("account_temporarily_locked");
    if (error === "unsupported_grant_type" || /grant.?type.*(unsupported|not allowed|disabled)/.test(description)) throw new Error("provider_contract_unverified");
    if (response.status === 400 || response.status === 401 || error === "invalid_grant") throw new Error("login_failed");
    throw new Error("provider_contract_unverified");
  }
  const user = await verifyImmomio(String(token.access_token));
  const accountHint = validEmail(user?.email) || email;
  const expiresAt = new Date(Date.now() + Math.max(60, Number(token.expires_in || 300)) * 1000).toISOString();
  const credentials = { access_token: String(token.access_token), refresh_token: String(token.refresh_token), id_token: token.id_token ? String(token.id_token) : undefined, expires_at: expiresAt, base_url: cfg.baseUrl, realm: cfg.realm, client_id: cfg.clientId, redirect_uri: IMMOMIO_REDIRECT };
  const encrypted = await encryptProviderCredentials(env, credentials, flow.participant_id, "immomio");
  return completeFlow(sql, flow, env, encrypted, accountHint, expiresAt);
}

async function scoutRequest(url, options, errorCode) {
  let response;
  try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(25_000) }); } catch { throw new Error("temporary_network_error"); }
  const body = await response.json().catch(() => null);
  if (!body) throw new Error(errorCode);
  return { response, body };
}
async function scoutAuthn(email, password) {
  return scoutRequest(SCOUT_AUTHN, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", "user-agent": SCOUT_UA }, body: JSON.stringify({ username: email, password, options: { multiOptionalFactorEnroll: false, warnBeforePasswordExpired: false } }) }, "login_failed");
}
async function scoutVerifyFactor(factorId, stateToken, passCode) {
  if (!/^[A-Za-z0-9_-]{3,160}$/.test(factorId)) throw new Error("mfa_factor_unsupported");
  const payload = { stateToken, ...(passCode ? { passCode } : {}) };
  return scoutRequest(`${SCOUT_AUTHN}/factors/${encodeURIComponent(factorId)}/verify`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", "user-agent": SCOUT_UA }, body: JSON.stringify(payload) }, "mfa_challenge_failed");
}
function scoutFactors(body) {
  return (Array.isArray(body?._embedded?.factors) ? body._embedded.factors : []).filter((f) => ["token:software:totp", "sms", "call", "email"].includes(String(f?.factorType || "")) && /^[A-Za-z0-9_-]{3,160}$/.test(String(f?.id || ""))).map((f) => ({ id: String(f.id), type: String(f.factorType), label: String(f.factorType) === "token:software:totp" ? "Authenticator-App" : String(f.factorType) === "sms" ? "SMS-Code" : String(f.factorType) === "email" ? "E-Mail-Code" : "Telefon-Code" }));
}
async function sealScoutMfa(env, value) {
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(String(env.APPLICATION_CREDENTIAL_KEY || env.CENTRAL_TOKEN_ENCRYPTION_KEY).match(/.{2}/g), (part) => parseInt(part, 16)), { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode("immoscout:mfa:v1") }, key, enc.encode(JSON.stringify(value))));
  return `${b64url(iv)}.${b64url(cipher)}`;
}
async function openScoutMfa(env, value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 2) throw new Error("mfa_expired");
  try {
    const key = await crypto.subtle.importKey("raw", Uint8Array.from(String(env.APPLICATION_CREDENTIAL_KEY || env.CENTRAL_TOKEN_ENCRYPTION_KEY).match(/.{2}/g), (part) => parseInt(part, 16)), { name: "AES-GCM" }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(parts[0]), additionalData: enc.encode("immoscout:mfa:v1") }, key, unb64url(parts[1]));
    const data = JSON.parse(dec.decode(plain));
    if (!data?.exp || Date.now() > Number(data.exp)) throw new Error("mfa_expired");
    return data;
  } catch (error) { if (error?.message === "mfa_expired") throw error; throw new Error("mfa_expired"); }
}
function scoutCallback(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { throw new Error("invalid_callback_url"); }
  if (url.protocol !== "immobilienscout24.de:" || url.hostname || url.port || url.username || url.password || url.pathname !== "/loginCallback") throw new Error("invalid_callback_url");
  const fragment = new URLSearchParams(url.hash.replace(/^#/, "").replace(/^\?/, ""));
  return { state: fragment.get("state") || url.searchParams.get("state"), code: fragment.get("code") || url.searchParams.get("code"), error: fragment.get("error") || url.searchParams.get("error") };
}
async function scoutToken(payload) { return scoutRequest(SCOUT_TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": SCOUT_UA }, body: new URLSearchParams({ ...payload, client_id: SCOUT_CLIENT }) }, "token_exchange_failed"); }
async function scoutUserInfo(accessToken) { return scoutRequest(SCOUT_USERINFO, { headers: { accept: "application/json", authorization: `Bearer ${accessToken}`, "user-agent": SCOUT_UA } }, "userinfo_failed"); }
async function saveScout(sql, env, flow, email, sessionToken) {
  const params = { source: "myaccount", utm_medium: "app", utm_source: "android", utm_campaign: "sso_entrance", app_name: SCOUT_CLIENT, consent: "true", client_id: SCOUT_CLIENT, response_type: "code", response_mode: "query", redirect_uri: SCOUT_REDIRECT, scope: SCOUT_SCOPE, state: flow.state, nonce: crypto.randomUUID(), code_challenge: await challenge(flow.code_verifier), code_challenge_method: "S256", login_hint: email, sessionToken, prompt: "none" };
  const url = new URL(SCOUT_AUTHORIZE); for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let response; try { response = await fetch(url.href, { redirect: "manual", headers: { accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8", "user-agent": SCOUT_UA }, signal: AbortSignal.timeout(25_000) }); } catch { throw new Error("temporary_network_error"); }
  const location = response.headers.get("location"); if (!location) throw new Error("authorization_code_missing");
  const callback = scoutCallback(location); if (callback.state !== flow.state) throw new Error("invalid_callback_url"); if (callback.error) throw new Error("oauth_login_failed"); if (!callback.code) throw new Error("authorization_code_missing");
  const token = await scoutToken({ grant_type: "authorization_code", code: callback.code, redirect_uri: SCOUT_REDIRECT, code_verifier: flow.code_verifier });
  if (!token.response.ok || !token.body?.access_token) throw new Error("token_exchange_failed");
  if (!token.body?.refresh_token) throw new Error("refresh_token_missing");
  const info = await scoutUserInfo(String(token.body.access_token)); if (!info.response.ok || !info.body?.sub) throw new Error("userinfo_failed");
  const accountHint = validEmail(info.body?.email) || email;
  const expiresAt = new Date(Date.now() + Math.max(60, Number(token.body.expires_in || 3600)) * 1000).toISOString();
  const credentials = { access_token: String(token.body.access_token), refresh_token: String(token.body.refresh_token), id_token: token.body.id_token ? String(token.body.id_token) : null, expires_at: expiresAt, token_type: String(token.body.token_type || "Bearer"), scope: String(token.body.scope || SCOUT_SCOPE), client_id: SCOUT_CLIENT, redirect_uri: SCOUT_REDIRECT, issuer: SCOUT_ISSUER, sub: String(info.body.sub) };
  const encrypted = await encryptProviderCredentials(env, credentials, flow.participant_id, "immoscout24");
  return completeFlow(sql, flow, env, encrypted, accountHint, expiresAt);
}
async function exchangeScoutCode(sql, env, flow, code, emailFallback) {
  const token = await scoutToken({ grant_type: "authorization_code", code, redirect_uri: SCOUT_REDIRECT, code_verifier: flow.code_verifier });
  if (!token.response.ok || !token.body?.access_token) throw new Error("token_exchange_failed");
  if (!token.body?.refresh_token) throw new Error("refresh_token_missing");
  const info = await scoutUserInfo(String(token.body.access_token));
  if (!info.response.ok || !info.body?.sub) throw new Error("userinfo_failed");
  const accountHint = validEmail(info.body?.email) || emailFallback;
  const expiresAt = new Date(Date.now() + Math.max(60, Number(token.body.expires_in || 3600)) * 1000).toISOString();
  const credentials = { access_token: String(token.body.access_token), refresh_token: String(token.body.refresh_token), id_token: token.body.id_token ? String(token.body.id_token) : null, expires_at: expiresAt, token_type: String(token.body.token_type || "Bearer"), scope: String(token.body.scope || SCOUT_SCOPE), client_id: SCOUT_CLIENT, redirect_uri: SCOUT_REDIRECT, issuer: SCOUT_ISSUER, sub: String(info.body.sub) };
  const encrypted = await encryptProviderCredentials(env, credentials, flow.participant_id, "immoscout24");
  return completeFlow(sql, flow, env, encrypted, accountHint, expiresAt);
}
async function scoutPassword(sql, env, flow, emailValue, passwordValue) {
  const email = validEmail(emailValue), password = String(passwordValue || ""); if (!email || !password || password.length > 1024) throw new Error("login_failed");
  const auth = await scoutAuthn(email, password); const status = clean(auth.body?.status, 60).toUpperCase();
  if (["MFA_REQUIRED", "MFA_CHALLENGE"].includes(status)) {
    const factors = scoutFactors(auth.body), stateToken = String(auth.body?.stateToken || ""); if (!stateToken || !factors.length) throw new Error("mfa_factor_unsupported");
    return { status: "mfa_required", authenticated: false, mfaRequired: true, mfaTicket: await sealScoutMfa(env, { exp: Date.now() + 10 * 60_000, flowState: flow.state, participantId: flow.participant_id, email, stateToken, factors: factors.map(({ id, type }) => ({ id, type })) }), factors };
  }
  if (!auth.response.ok || status !== "SUCCESS" || !auth.body?.sessionToken) throw new Error("login_failed");
  return saveScout(sql, env, flow, email, String(auth.body.sessionToken));
}
async function scoutMfa(env, sql, value, factorId, passCode = null) {
  const ticketData = await openScoutMfa(env, value), allowed = (ticketData.factors || []).find((factor) => factor.id === String(factorId)); if (!allowed) throw new Error("mfa_factor_unsupported");
  if (allowed.type === "token:software:totp" && !passCode) return { status: "mfa_code_required", mfaRequired: true, mfaTicket: value, factorId: allowed.id, factorType: allowed.type };
  const result = await scoutVerifyFactor(allowed.id, String(ticketData.stateToken), passCode); const status = clean(result.body?.status, 60).toUpperCase();
  if (status === "SUCCESS" && result.body?.sessionToken) {
    const flow = await flowFor(sql, ticketData.flowState); return saveScout(sql, env, flow, String(ticketData.email), String(result.body.sessionToken));
  }
  if (result.response.status === 403 || String(result.body?.errorCode || "") === "E0000068") throw new Error("mfa_invalid_code");
  if (["MFA_CHALLENGE", "MFA_REQUIRED"].includes(status)) return { status: "mfa_code_required", mfaRequired: true, mfaTicket: await sealScoutMfa(env, { ...ticketData, exp: Date.now() + 10 * 60_000, stateToken: String(result.body?.stateToken || ticketData.stateToken) }), factorId: allowed.id, factorType: allowed.type };
  throw new Error("mfa_challenge_failed");
}

export async function centralCall(env, path, body = {}, method = "POST") {
  const request = new Request(`https://housing-runtime.internal${path}`, { method, headers: { authorization: `Bearer ${env.CENTRAL_API_SECRET || ""}`, "content-type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
  const response = await centralTokenWorker.fetch(request, { ...env, DB: env.HOUSING_DB, API_SECRET: env.CENTRAL_API_SECRET, TOKEN_ENCRYPTION_KEY: env.CENTRAL_TOKEN_ENCRYPTION_KEY });
  const data = await response.json().catch(() => null); if (!response.ok || !data) throw new Error(data?.error || "central_immoscout_unavailable"); return data;
}

async function action(sql, env, body) {
  const name = String(body.action || "");
  const flow = await flowFor(sql, body.ticket, name === "status");
  if (flow.central) {
    const path = { resolve: "/internal/resolve", status: "/internal/status", password_login: "/internal/password_login", mfa_start: "/internal/mfa_start", mfa_verify: "/internal/mfa_verify" }[name];
    if (!path) throw new Error("provider_unsupported");
    const result = await centralCall(env, path, name === "resolve" ? { state: flow.state, allow_consumed: false } : name === "status" ? {} : { state: flow.state, mfaTicket: body.mfaTicket, factorId: body.factorId, passCode: body.passCode, email: body.email, password: body.password }, name === "status" ? "GET" : "POST");
    if (name === "resolve") return { ok: true, provider: "immoscout24", mode: "credentials", centralAccount: true, accountHint: result.account_hint || "arash@nexalabs.de", participantLabel: "NexaLabs · zentraler ImmoScout24-Zugang", origin: "telegram", returnTarget: "telegram", expiresAt: result.expires_at };
    return result;
  }
  const info = await participantInfo(sql, flow);
  if (name === "resolve") return { ok: true, provider: flow.provider, mode: flow.provider === "immomio" ? "provider_web" : "credentials", accountHint: info.accountHint || info.profileEmail, participantLabel: info.participantLabel, origin: flow.origin, returnTarget: flow.return_target, expiresAt: flow.expires_at, ...(flow.provider === "immomio" ? { requiresManualCallback: true, callbackTransport: "provider-pkce" } : {}) };
  if (name === "provider_web") return { provider: flow.provider, url: await immomioUrl(flow, validEmail(body.email) || info.profileEmail) };
  if (name === "complete_session") return completeSession(sql, env, flow, body.session, body.accountHint);
  if (name === "complete_web") {
    if (flow.provider === "immomio") return completeImmomio(sql, env, flow, body.callbackUrl);
    if (flow.provider === "immoscout24") { const callback = scoutCallback(body.callbackUrl); if (callback.state !== flow.state || callback.error || !callback.code) throw new Error("invalid_callback_url"); return exchangeScoutCode(sql, env, flow, callback.code, info.profileEmail); }
    throw new Error("provider_unsupported");
  }
  if (name === "password_login") {
    if (flow.provider === "immomio") return immomioPasswordLogin(sql, env, flow, body.email, body.password);
    if (flow.provider === "immoscout24") return scoutPassword(sql, env, flow, body.email, body.password);
    throw new Error("provider_browser_required");
  }
  if (name === "mfa_start" || name === "mfa_verify") {
    if (flow.provider !== "immoscout24") throw new Error("provider_interactive_challenge");
    return scoutMfa(env, sql, body.mfaTicket, body.factorId, name === "mfa_verify" ? body.passCode : null);
  }
  if (name === "status") {
    const row = (await sql`SELECT status,account_hint,expires_at FROM provider_connections WHERE participant_id=${flow.participant_id} AND provider=${flow.provider} LIMIT 1`)[0];
    return { ok: true, provider: flow.provider, status: row?.status || "disconnected", connected: row?.status === "connected", accountHint: row?.account_hint || null, expiresAt: row?.expires_at || null };
  }
  throw new Error("invalid_action");
}

export async function handleProviderFacade(sql, request, env) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await request.json().catch(() => ({}));
  try { return json(await action(sql, env, body)); }
  catch (error) {
    const code = String(error?.message || "auth_facade_failed");
    console.error("housing_provider_facade_action_failed", code);
    const safe = new Set(["invalid_ticket", "auth_flow_expired", "provider_unsupported", "profile_email_required", "provider_contract_unverified", "temporary_network_error", "invalid_action", "invalid_callback_url", "provider_completion_failed", "token_exchange_failed", "login_failed", "account_temporarily_locked", "provider_interactive_challenge", "human_verification_required", "provider_email_required", "mfa_factor_unsupported", "mfa_invalid_code", "mfa_challenge_failed", "mfa_expired", "central_account_mismatch", "provider_browser_required"]);
    const status = code === "invalid_ticket" || code === "invalid_callback_url" ? 400 : code === "auth_flow_expired" || code === "mfa_expired" ? 410 : code === "account_temporarily_locked" ? 423 : code === "login_failed" || code === "mfa_invalid_code" ? 401 : code.startsWith("mfa_") || code === "provider_interactive_challenge" ? 409 : 503;
    return json({ error: safe.has(code) ? code : "auth_facade_failed" }, status);
  }
}
