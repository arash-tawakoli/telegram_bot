const ACCOUNT_EMAIL = "arash@nexalabs.de";
const ADMIN_IDS = new Set(["8538226539", "414638980"]);
const ISSUER = "https://login.immobilienscout24.de/oauth2/aus1227au6oBG6hGH417";
const AUTHORIZE = `${ISSUER}/v1/authorize`;
const TOKEN = `${ISSUER}/v1/token`;
const USERINFO = `${ISSUER}/v1/userinfo`;
const AUTHN = "https://login.immobilienscout24.de/api/v1/authn";
const CLIENT_ID = "is24-android-de";
const REDIRECT_URI = "immobilienscout24.de:/loginCallback";
const SCOPE = "openid profile email offline_access";
const UA = "okta-oauth2-kotlin/2.0.3 Android/34";
const CREDENTIAL_AAD = "nexalabs:immoscout:central:v1";
const FLOW_AAD = "nexalabs:immoscout:oauth-flow:v1";
const MFA_AAD = "nexalabs:immoscout:mfa:v1";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  },
});
const clean = (value, max = 320) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const enc = new TextEncoder();
const dec = new TextDecoder();
function b64(bytes) { let value = ""; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value); }
function unb64(value) { return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); }
function b64url(bytes) { return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function randomToken(size = 32) { return b64url(crypto.getRandomValues(new Uint8Array(size))); }
async function digest(value) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)))).map((b) => b.toString(16).padStart(2, "0")).join(""); }
function validEmail(value) { const email = clean(value, 320).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null; }
function validUserId(value) { const id = String(value || ""); return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null; }
function hexToBytes(value) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("invalid_encryption_key");
  return Uint8Array.from(value.match(/.{2}/g), (b) => parseInt(b, 16));
}
async function encryptionKey(env) {
  return crypto.subtle.importKey("raw", hexToBytes(env.TOKEN_ENCRYPTION_KEY || ""), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encrypt(value, env, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(env);
  const plaintext = enc.encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, plaintext));
  return { ciphertext: b64(ciphertext), iv: b64(iv) };
}
async function decrypt(ciphertext, iv, env, aad) {
  const key = await encryptionKey(env);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: enc.encode(aad) }, key, unb64(ciphertext));
  return JSON.parse(dec.decode(plaintext));
}
async function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
async function authorize(request, env) {
  const header = request.headers.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  return supplied.length > 0 && await sameSecret(supplied, env.API_SECRET);
}
async function bodyJson(request) {
  const text = await request.text();
  if (text.length > 32768) throw new Error("payload_too_large");
  try { return JSON.parse(text); } catch { throw new Error("invalid_json"); }
}
function callbackParts(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("invalid_callback_url"); }
  if (url.protocol !== "immobilienscout24.de:" || url.hostname || url.port || url.username || url.password || url.pathname !== "/loginCallback") throw new Error("invalid_callback_url");
  const fragment = new URLSearchParams(url.hash.replace(/^#/, "").replace(/^\?/, ""));
  return {
    state: fragment.get("state") || url.searchParams.get("state"),
    code: fragment.get("code") || url.searchParams.get("code"),
    error: fragment.get("error") || url.searchParams.get("error"),
  };
}
async function fetchJson(url, options, errorCode) {
  let response;
  try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(25000) }); }
  catch { throw new Error("temporary_network_error"); }
  const body = await response.json().catch(() => null);
  if (!body) throw new Error(errorCode || "provider_response_invalid");
  return { response, body };
}
async function authn(email, password) {
  return fetchJson(AUTHN, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ username: email, password, options: { multiOptionalFactorEnroll: false, warnBeforePasswordExpired: false } }),
  }, "login_failed");
}
async function verifyFactor(factorId, stateToken, passCode) {
  if (!/^[A-Za-z0-9_-]{3,160}$/.test(factorId)) throw new Error("mfa_factor_unsupported");
  const payload = { stateToken };
  if (passCode) payload.passCode = passCode;
  return fetchJson(`${AUTHN}/factors/${encodeURIComponent(factorId)}/verify`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify(payload),
  }, "mfa_challenge_failed");
}
function supportedFactors(body) {
  const factors = Array.isArray(body?._embedded?.factors) ? body._embedded.factors : [];
  return factors
    .filter((f) => ["token:software:totp", "sms", "call", "email"].includes(String(f?.factorType || "")) && /^[A-Za-z0-9_-]{3,160}$/.test(String(f?.id || "")))
    .map((f) => {
      const type = String(f.factorType);
      const label = type === "token:software:totp" ? "Authenticator-App"
        : type === "sms" ? (f?.profile?.phoneNumber ? `SMS an ${clean(f.profile.phoneNumber, 40)}` : "SMS-Code")
        : type === "call" ? (f?.profile?.phoneNumber ? `Anruf an ${clean(f.profile.phoneNumber, 40)}` : "Telefon-Code")
        : type === "email" ? "E-Mail-Code" : type;
      return { id: String(f.id), type, provider: clean(f.provider, 40), label };
    });
}
async function getFlow(env, state, allowConsumed = false) {
  const token = String(state || "");
  if (!/^cfcentral_[A-Za-z0-9_-]{40,80}$/.test(token)) throw new Error("invalid_state");
  const row = await env.DB.prepare(
    "SELECT state_hash,verifier_ciphertext,verifier_iv,admin_telegram_id,user_id,expires_at,consumed_at FROM oauth_flows WHERE state_hash=?"
  ).bind(await digest(token)).first();
  if (!row || Date.parse(row.expires_at) <= Date.now() || (!allowConsumed && row.consumed_at)) throw new Error("auth_flow_expired");
  if (!ADMIN_IDS.has(String(row.admin_telegram_id))) throw new Error("auth_flow_expired");
  const secret = await decrypt(row.verifier_ciphertext, row.verifier_iv, env, FLOW_AAD);
  return { ...row, state: token, verifier: String(secret.verifier || "") };
}
async function startFlow(env, body) {
  const adminId = String(body.admin_telegram_id || "");
  const userId = validUserId(body.user_id);
  if (!ADMIN_IDS.has(adminId) || !userId) throw new Error("admin_required");
  const state = `cfcentral_${randomToken(32)}`;
  const verifier = randomToken(48);
  const sealed = await encrypt({ verifier }, env, FLOW_AAD);
  const expires = new Date(Date.now() + 15 * 60_000).toISOString();
  await env.DB.prepare(
    "INSERT INTO oauth_flows(state_hash,verifier_ciphertext,verifier_iv,admin_telegram_id,user_id,expires_at) VALUES(?,?,?,?,?,?)"
  ).bind(await digest(state), sealed.ciphertext, sealed.iv, adminId, userId, expires).run();
  const status = await credentialStatus(env);
  return {
    state,
    expires_at: expires,
    url: `https://login.traumwohnunghamburg.de/connect?ticket=${encodeURIComponent(state)}`,
    account_hint: ACCOUNT_EMAIL,
    current_status: status,
  };
}
async function claimFlow(env, flow) {
  const result = await env.DB.prepare(
    "UPDATE oauth_flows SET consumed_at=CURRENT_TIMESTAMP WHERE state_hash=? AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP"
  ).bind(flow.state_hash).run();
  if (!result.meta.changes) throw new Error("auth_flow_expired");
}
async function releaseFlow(env, flow) {
  await env.DB.prepare(
    "UPDATE oauth_flows SET consumed_at=NULL WHERE state_hash=? AND consumed_at IS NOT NULL"
  ).bind(flow.state_hash).run();
}
async function tokenRequest(payload) {
  return fetchJson(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": UA },
    body: new URLSearchParams({ ...payload, client_id: CLIENT_ID }),
  }, "token_exchange_failed");
}
async function userInfo(accessToken) {
  return fetchJson(USERINFO, {
    headers: { accept: "application/json", authorization: `Bearer ${accessToken}`, "user-agent": UA },
  }, "userinfo_failed");
}
async function authorizeWithSession(flow, email, sessionToken) {
  if (!flow.verifier) throw new Error("auth_flow_expired");
  const params = {
    source: "myaccount", utm_medium: "app", utm_source: "android", utm_campaign: "sso_entrance",
    app_name: CLIENT_ID, consent: "true", client_id: CLIENT_ID, response_type: "code",
    response_mode: "query", redirect_uri: REDIRECT_URI, scope: SCOPE, state: flow.state,
    nonce: crypto.randomUUID(), code_challenge: await digestChallenge(flow.verifier),
    code_challenge_method: "S256", login_hint: email, sessionToken, prompt: "none",
  };
  const url = new URL(AUTHORIZE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let response;
  try {
    response = await fetch(url.href, {
      redirect: "manual",
      headers: { accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8", "user-agent": UA },
      signal: AbortSignal.timeout(25000),
    });
  } catch { throw new Error("temporary_network_error"); }
  const location = response.headers.get("location");
  if (!location) throw new Error("authorization_code_missing");
  const parsed = callbackParts(location);
  if (parsed.state !== flow.state) throw new Error("invalid_state");
  if (parsed.error) throw new Error("oauth_login_failed");
  if (!parsed.code) throw new Error("authorization_code_missing");
  return parsed.code;
}
async function digestChallenge(value) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))));
}
async function persistCredentials(env, credentials, preserveEnabled = false, adminId = null) {
  const sealed = await encrypt(credentials, env, CREDENTIAL_AAD);
  const expiresAt = new Date(credentials.expires_at || Date.now() + 3600000).toISOString();
  await env.DB.prepare(`
    INSERT INTO central_credentials
      (singleton,account_hint,ciphertext,iv,key_version,status,enabled,expires_at,last_verified_at,last_error,updated_at)
    VALUES ('central',?,?,?,1,'connected',0,?,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP)
    ON CONFLICT(singleton) DO UPDATE SET
      account_hint=excluded.account_hint,ciphertext=excluded.ciphertext,iv=excluded.iv,
      key_version=1,status='connected',
      enabled=CASE WHEN ?=1 THEN central_credentials.enabled ELSE 0 END,
      expires_at=excluded.expires_at,last_verified_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP
  `).bind(ACCOUNT_EMAIL, sealed.ciphertext, sealed.iv, expiresAt, preserveEnabled ? 1 : 0).run();
  await env.DB.prepare("INSERT INTO audit_events(event_type,account_hint,admin_telegram_id) VALUES('credential_stored',?,?)")
    .bind(ACCOUNT_EMAIL, adminId ? String(adminId) : null).run();
  return { status: "connected", accountHint: ACCOUNT_EMAIL, expiresAt };
}
async function finishWithSession(env, flow, email, sessionToken) {
  let stage = "claim_flow";
  await claimFlow(env, flow);
  try {
    stage = "authorize";
    const code = await authorizeWithSession(flow, email, sessionToken);
    stage = "token_exchange";
    const { response, body } = await tokenRequest({
      grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, code_verifier: flow.verifier,
    });
    if (!response.ok || !body?.access_token) throw new Error("token_exchange_failed");
    if (!body?.refresh_token) throw new Error("refresh_token_missing");
    stage = "userinfo";
    const info = await userInfo(String(body.access_token));
    if (!info.response.ok || !info.body?.sub) throw new Error("userinfo_failed");
    const verifiedEmail = validEmail(info.body?.email);
    if (!verifiedEmail) throw new Error("account_email_claim_missing");
    if (verifiedEmail !== ACCOUNT_EMAIL) throw new Error("central_account_mismatch");
    const expiresAt = new Date(Date.now() + Math.max(60, Number(body.expires_in || 3600)) * 1000).toISOString();
    const credentials = {
      access_token: String(body.access_token),
      refresh_token: String(body.refresh_token),
      id_token: body.id_token ? String(body.id_token) : null,
      expires_at: expiresAt,
      token_type: String(body.token_type || "Bearer"),
      scope: String(body.scope || SCOPE),
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      issuer: ISSUER,
      sub: String(info.body.sub),
    };
    stage = "persist";
    await persistCredentials(env, credentials, false, flow.admin_telegram_id);
    return { status: "connected", authenticated: true, accountReady: true, accountHint: verifiedEmail, passwordStored: false };
  } catch (error) {
    const code = String(error?.message || "immoscout_operation_failed");
    if (stage === "authorize" && ["authorization_code_missing", "temporary_network_error"].includes(code)) {
      await releaseFlow(env, flow).catch(() => {});
    }
    if (error && typeof error === "object") error.stage = stage;
    await env.DB.prepare(
      "INSERT INTO audit_events(event_type,account_hint,admin_telegram_id) VALUES(?,?,?)"
    ).bind(`oauth_failed:${stage}:${code}`.slice(0,160), ACCOUNT_EMAIL, flow.admin_telegram_id).run().catch(() => {});
    throw error;
  }
}
async function passwordLogin(env, state, emailValue, passwordValue) {
  const email = validEmail(emailValue);
  const password = String(passwordValue || "");
  if (email !== ACCOUNT_EMAIL || !password || password.length > 1024) throw new Error("login_failed");
  const flow = await getFlow(env, state);
  const { response, body } = await authn(email, password);
  const status = clean(body?.status, 60).toUpperCase();
  if (status === "MFA_REQUIRED" || status === "MFA_CHALLENGE") {
    const factors = supportedFactors(body);
    const stateToken = String(body?.stateToken || "");
    if (!stateToken || !factors.length) throw new Error("mfa_factor_unsupported");
    const ticket = await sealMfaTicket(env, {
      v: 1, exp: Date.now() + 10 * 60_000, flowState: flow.state,
      adminId: flow.admin_telegram_id, userId: flow.user_id, email,
      stateToken, factors: factors.map((f) => ({ id: f.id, type: f.type })),
    });
    return { status: "mfa_required", authenticated: false, mfaRequired: true, mfaTicket: ticket, factors };
  }
  if (!response.ok || status !== "SUCCESS" || !body?.sessionToken) throw new Error("login_failed");
  return finishWithSession(env, flow, email, String(body.sessionToken));
}
async function sealMfaTicket(env, value) {
  const sealed = await encrypt(value, env, MFA_AAD);
  return `${b64url(unb64(sealed.iv))}.${b64url(unb64(sealed.ciphertext))}`;
}
async function openMfaTicket(env, value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 2) throw new Error("mfa_expired");
  try {
    const payload = await decrypt(b64(unb64url(parts[1])), b64(unb64url(parts[0])), env, MFA_AAD);
    if (!payload?.exp || Date.now() > Number(payload.exp)) throw new Error("mfa_expired");
    return payload;
  } catch (error) {
    if (error?.message === "mfa_expired") throw error;
    throw new Error("mfa_expired");
  }
}
function unb64url(value) { return unb64(String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value).length / 4) * 4, "=")); }
async function mfaStart(env, ticketValue, factorIdValue) {
  const ticket = await openMfaTicket(env, ticketValue);
  const factorId = String(factorIdValue || "");
  const allowed = (ticket.factors || []).find((factor) => factor.id === factorId);
  if (!allowed) throw new Error("mfa_factor_unsupported");
  const flow = await getFlow(env, ticket.flowState);
  if (String(flow.user_id) !== String(ticket.userId) || String(flow.admin_telegram_id) !== String(ticket.adminId)) throw new Error("auth_flow_expired");
  if (allowed.type === "token:software:totp") return { status: "mfa_code_required", mfaRequired: true, mfaTicket: ticketValue, factorId, factorType: allowed.type };
  const { response, body } = await verifyFactor(factorId, String(ticket.stateToken));
  const status = clean(body?.status, 60).toUpperCase();
  if (status === "SUCCESS" && body?.sessionToken) return finishWithSession(env, flow, String(ticket.email), String(body.sessionToken));
  if (!response.ok && !["MFA_CHALLENGE", "MFA_REQUIRED"].includes(status)) throw new Error("mfa_challenge_failed");
  const nextTicket = await sealMfaTicket(env, { ...ticket, exp: Date.now() + 10 * 60_000, stateToken: String(body?.stateToken || ticket.stateToken) });
  return { status: "mfa_code_required", mfaRequired: true, mfaTicket: nextTicket, factorId, factorType: allowed.type };
}
async function mfaVerify(env, ticketValue, factorIdValue, passCodeValue) {
  const passCode = String(passCodeValue || "").trim();
  if (!/^[0-9]{4,10}$/.test(passCode)) throw new Error("mfa_invalid_code");
  const ticket = await openMfaTicket(env, ticketValue);
  const factorId = String(factorIdValue || "");
  const allowed = (ticket.factors || []).find((factor) => factor.id === factorId);
  if (!allowed) throw new Error("mfa_factor_unsupported");
  const flow = await getFlow(env, ticket.flowState);
  if (String(flow.user_id) !== String(ticket.userId) || String(flow.admin_telegram_id) !== String(ticket.adminId)) throw new Error("auth_flow_expired");
  const { response, body } = await verifyFactor(factorId, String(ticket.stateToken), passCode);
  const status = clean(body?.status, 60).toUpperCase();
  if (status === "SUCCESS" && body?.sessionToken) return finishWithSession(env, flow, String(ticket.email), String(body.sessionToken));
  if (response.status === 403 || String(body?.errorCode || "") === "E0000068") throw new Error("mfa_invalid_code");
  if (status === "MFA_CHALLENGE" || status === "MFA_REQUIRED") {
    const nextTicket = await sealMfaTicket(env, { ...ticket, exp: Date.now() + 10 * 60_000, stateToken: String(body?.stateToken || ticket.stateToken) });
    return { status: "mfa_code_required", mfaRequired: true, mfaTicket: nextTicket, factorId, factorType: allowed.type };
  }
  throw new Error("mfa_challenge_failed");
}
async function credentialStatus(env) {
  const row = await env.DB.prepare("SELECT account_hint,status,enabled,expires_at,last_verified_at,last_error,updated_at FROM central_credentials WHERE singleton='central'").first();
  return {
    configured: !!row,
    account_hint: row?.account_hint || null,
    status: row?.status || "disconnected",
    enabled: row?.enabled === 1,
    expires_at: row?.expires_at || null,
    last_verified_at: row?.last_verified_at || null,
    last_error: row?.last_error || null,
    updated_at: row?.updated_at || null,
  };
}
async function internal(request, env, path) {
  if (!await authorize(request, env)) return json({ error: "unauthorized" }, 401);
  if (path === "/internal/status" && request.method === "GET") return json(await credentialStatus(env));
  const body = request.method === "POST" ? await bodyJson(request) : {};
  if (path === "/internal/start" && request.method === "POST") return json(await startFlow(env, body));
  if (path === "/internal/resolve" && request.method === "POST") {
    const flow = await getFlow(env, body.state, body.allow_consumed === true);
    return json({
      state: flow.state, user_id: flow.user_id, admin_telegram_id: flow.admin_telegram_id,
      expires_at: flow.expires_at, consumed: !!flow.consumed_at,
      account_hint: ACCOUNT_EMAIL, origin: "telegram", return_target: "telegram",
    });
  }
  if (path === "/internal/password_login" && request.method === "POST") {
    return json(await passwordLogin(env, body.state, body.email, body.password));
  }
  if (path === "/internal/mfa_start" && request.method === "POST") {
    return json(await mfaStart(env, body.mfaTicket, body.factorId));
  }
  if (path === "/internal/mfa_verify" && request.method === "POST") {
    return json(await mfaVerify(env, body.mfaTicket, body.factorId, body.passCode));
  }
  if (path === "/internal/store" && request.method === "POST") {
    const email = validEmail(body.account_hint);
    if (email !== ACCOUNT_EMAIL || typeof body.access_token !== "string" || body.access_token.length < 20 ||
        typeof body.refresh_token !== "string" || body.refresh_token.length < 20) return json({ error: "invalid_credentials" }, 400);
    const expires = new Date(body.expires_at || Date.now() + 3600000);
    if (!Number.isFinite(expires.getTime())) return json({ error: "invalid_expiry" }, 400);
    const credentials = {
      access_token: body.access_token, refresh_token: body.refresh_token,
      id_token: typeof body.id_token === "string" ? body.id_token : null,
      token_type: String(body.token_type || "Bearer"), scope: String(body.scope || SCOPE),
      expires_at: expires.toISOString(),
    };
    const result = await persistCredentials(env, credentials, body.preserve_enabled === true, body.admin_telegram_id || null);
    return json({ stored: true, ...result });
  }
  if (path === "/internal/mark" && request.method === "POST") {
    const status = String(body.status || "");
    if (!["connected", "needs_login", "error"].includes(status)) return json({ error: "invalid_status" }, 400);
    await env.DB.prepare("UPDATE central_credentials SET status=?,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE singleton='central'")
      .bind(status, String(body.last_error || "").slice(0, 160) || null).run();
    return json({ status });
  }
  if (path === "/internal/credentials" && request.method === "GET") {
    const row = await env.DB.prepare("SELECT ciphertext,iv,account_hint,status,enabled,expires_at FROM central_credentials WHERE singleton='central'").first();
    if (!row || row.status !== "connected") return json({ error: "needs_login" }, 404);
    const credentials = await decrypt(row.ciphertext, row.iv, env, CREDENTIAL_AAD);
    return json({ account_hint: row.account_hint, enabled: row.enabled === 1, status: row.status, ...credentials });
  }
  if (path === "/internal/enable" && request.method === "POST") {
    if (!ADMIN_IDS.has(String(body.admin_telegram_id || ""))) return json({ error: "admin_required" }, 403);
    const enabled = body.enabled === true;
    const result = await env.DB.prepare("UPDATE central_credentials SET enabled=?,updated_at=CURRENT_TIMESTAMP WHERE singleton='central' AND status='connected'")
      .bind(enabled ? 1 : 0).run();
    if (!result.meta.changes) return json({ error: "credential_not_connected" }, 409);
    await env.DB.prepare("INSERT INTO audit_events(event_type,account_hint,admin_telegram_id) SELECT ?,account_hint,? FROM central_credentials WHERE singleton='central'")
      .bind(enabled ? "auto_apply_enabled" : "auto_apply_disabled", String(body.admin_telegram_id)).run();
    return json({ enabled });
  }
  return json({ error: "not_found" }, 404);
}
function safeDiagnosticCode(error) {
  const code = String(error?.message || "immoscout_operation_failed");
  return /^[a-z0-9_]{1,80}$/.test(code) ? code : "immoscout_operation_failed";
}
function publicError(error) {
  const code = safeDiagnosticCode(error);
  const safe = new Set([
    "login_failed", "mfa_required", "mfa_factor_unsupported", "mfa_invalid_code",
    "mfa_challenge_failed", "mfa_expired", "auth_flow_expired", "invalid_state",
    "central_account_mismatch", "temporary_network_error", "authorization_code_missing",
    "token_exchange_failed", "refresh_token_missing", "userinfo_failed", "oauth_login_failed",
    "invalid_callback_url", "provider_response_invalid", "account_email_claim_missing", "admin_required",
  ]);
  const status = code === "login_failed" || code === "mfa_invalid_code" ? 401
    : code === "invalid_callback_url" ? 400
    : code === "auth_flow_expired" || code === "invalid_state" || code === "mfa_expired" ? 410
    : code.startsWith("mfa_") ? 409 : code === "admin_required" ? 403 : 503;
  const outwardCode = ({
    authorization_code_missing: "oauth_login_failed",
    refresh_token_missing: "token_exchange_failed",
    invalid_callback_url: "oauth_login_failed",
    provider_response_invalid: "oauth_login_failed",
  })[code] || (safe.has(code) ? code : "token_exchange_failed");
  return json({ error: outwardCode }, status);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      const result = await env.DB.prepare("SELECT COUNT(*) AS tables_count FROM sqlite_master WHERE type='table'").first();
      return json({ ok: true, service: "immoscout-central-token-staging", database: "d1", tables: result?.tables_count || 0 });
    }
    try {
      return await internal(request, env, url.pathname);
    } catch (error) {
      console.error("central_immoscout_request_failed", {
        path: url.pathname,
        stage: String(error?.stage || "request"),
        code: safeDiagnosticCode(error),
      });
      return publicError(error);
    }
  },
};
