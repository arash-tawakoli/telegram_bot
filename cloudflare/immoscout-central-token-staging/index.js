const ACCOUNT_EMAIL = "arash@nexalabs.de";
const ADMIN_IDS = new Set(["8538226539", "414638980"]);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  },
});

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(value) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("invalid_encryption_key");
  return Uint8Array.from(value.match(/.{2}/g), (b) => parseInt(b, 16));
}
function b64(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}
function unb64(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
function randomToken(size = 32) {
  const value = crypto.getRandomValues(new Uint8Array(size));
  return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function digest(value) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
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
async function encryptionKey(env) {
  const raw = hexToBytes(env.TOKEN_ENCRYPTION_KEY || "");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encrypt(value, env, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(env);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, key, plaintext
  ));
  return { ciphertext: b64(ciphertext), iv: b64(iv) };
}
async function decrypt(ciphertext, iv, env, aad) {
  const key = await encryptionKey(env);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv), additionalData: new TextEncoder().encode(aad) },
    key, unb64(ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}
async function bodyJson(request) {
  const text = await request.text();
  if (text.length > 32768) throw new Error("payload_too_large");
  try { return JSON.parse(text); } catch { throw new Error("invalid_json"); }
}
async function internal(request, env, path) {
  if (!await authorize(request, env)) return json({ error: "unauthorized" }, 401);
  if (path === "/internal/status" && request.method === "GET") {
    const row = await env.DB.prepare(
      "SELECT account_hint,status,enabled,expires_at,last_verified_at,last_error,updated_at FROM central_credentials WHERE singleton='central'"
    ).first();
    return json({
      configured: !!row,
      account_hint: row?.account_hint || null,
      status: row?.status || "disconnected",
      enabled: row?.enabled === 1,
      expires_at: row?.expires_at || null,
      last_verified_at: row?.last_verified_at || null,
      last_error: row?.last_error || null,
      updated_at: row?.updated_at || null,
    });
  }
  if (path === "/internal/store" && request.method === "POST") {
    const body = await bodyJson(request);
    const email = String(body.account_hint || "").trim().toLowerCase();
    if (email !== ACCOUNT_EMAIL) return json({ error: "central_account_mismatch" }, 403);
    if (typeof body.access_token !== "string" || body.access_token.length < 20 ||
        typeof body.refresh_token !== "string" || body.refresh_token.length < 20) {
      return json({ error: "invalid_credentials" }, 400);
    }
    const expires = new Date(body.expires_at || Date.now() + 3600000);
    if (!Number.isFinite(expires.getTime())) return json({ error: "invalid_expiry" }, 400);
    const credentials = {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      id_token: typeof body.id_token === "string" ? body.id_token : null,
      token_type: String(body.token_type || "Bearer"),
      scope: String(body.scope || ""),
      expires_at: expires.toISOString(),
    };
    const sealed = await encrypt(credentials, env, "nexalabs:immoscout:central:v1");
    await env.DB.prepare(`
      INSERT INTO central_credentials
        (singleton,account_hint,ciphertext,iv,key_version,status,enabled,expires_at,last_verified_at,last_error,updated_at)
      VALUES ('central',?,?,?,1,'connected',0,?,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP)
      ON CONFLICT(singleton) DO UPDATE SET
        account_hint=excluded.account_hint,ciphertext=excluded.ciphertext,iv=excluded.iv,
        key_version=1,status='connected',enabled=CASE WHEN ?=1 THEN central_credentials.enabled ELSE 0 END,expires_at=excluded.expires_at,
        last_verified_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP
    `).bind(email, sealed.ciphertext, sealed.iv, body.preserve_enabled === true ? 1 : 0, expires.toISOString()).run();
    if (typeof body.flow_state === "string" && body.flow_state.startsWith("cf_")) {
      await env.DB.prepare("UPDATE oauth_flows SET completed_at=CURRENT_TIMESTAMP WHERE state_hash=?")
        .bind(await digest(body.flow_state)).run();
    }
    await env.DB.prepare("INSERT INTO audit_events(event_type,account_hint) VALUES('credential_stored',?)").bind(email).run();
    return json({ stored: true, account_hint: email, enabled: false, expires_at: expires.toISOString() });
  }
  if (path === "/internal/mark" && request.method === "POST") {
    const body = await bodyJson(request);
    const status = String(body.status || "");
    if (!["connected","needs_login","error"].includes(status)) return json({ error: "invalid_status" }, 400);
    await env.DB.prepare(
      "UPDATE central_credentials SET status=?,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE singleton='central'"
    ).bind(status, String(body.last_error || "").slice(0,160) || null).run();
    return json({ status });
  }
  if (path === "/internal/credentials" && request.method === "GET") {
    const row = await env.DB.prepare(
      "SELECT ciphertext,iv,account_hint,status,enabled,expires_at FROM central_credentials WHERE singleton='central'"
    ).first();
    if (!row || row.status !== "connected") return json({ error: "needs_login" }, 404);
    const credentials = await decrypt(row.ciphertext, row.iv, env, "nexalabs:immoscout:central:v1");
    return json({ account_hint: row.account_hint, enabled: row.enabled === 1, status: row.status, ...credentials });
  }
  if (path === "/internal/enable" && request.method === "POST") {
    const body = await bodyJson(request);
    if (typeof body.enabled !== "boolean") return json({ error: "invalid_enabled_value" }, 400);
    const result = await env.DB.prepare(
      "UPDATE central_credentials SET enabled=?,updated_at=CURRENT_TIMESTAMP WHERE singleton='central' AND status='connected'"
    ).bind(body.enabled ? 1 : 0).run();
    if (!result.meta.changes) return json({ error: "credential_not_connected" }, 409);
    await env.DB.prepare("INSERT INTO audit_events(event_type,account_hint) SELECT ?,account_hint FROM central_credentials WHERE singleton='central'")
      .bind(body.enabled ? "auto_apply_enabled" : "auto_apply_disabled").run();
    return json({ enabled: body.enabled });
  }
  if (path === "/internal/flow" && request.method === "POST") {
    const body = await bodyJson(request);
    const adminId = String(body.admin_telegram_id || "");
    if (!ADMIN_IDS.has(adminId)) return json({ error: "admin_required" }, 403);
    const state = `cf_${randomToken(32)}`;
    const verifier = randomToken(48);
    const sealed = await encrypt({ verifier }, env, "nexalabs:immoscout:oauth-flow:v1");
    const expires = new Date(Date.now() + 15 * 60_000).toISOString();
    await env.DB.prepare(
      "INSERT INTO oauth_flows(state_hash,verifier_ciphertext,verifier_iv,admin_telegram_id,user_id,expires_at) VALUES(?,?,?,?,?,?)"
    ).bind(await digest(state), sealed.ciphertext, sealed.iv, adminId, String(body.user_id || ""), expires).run();
    return json({ state, expires_at: expires });
  }
  if (path === "/internal/flow/inspect" && request.method === "POST") {
    const body = await bodyJson(request);
    const state = String(body.state || "");
    const row = await env.DB.prepare(
      "SELECT state_hash,verifier_ciphertext,verifier_iv,admin_telegram_id,user_id,expires_at,consumed_at FROM oauth_flows WHERE state_hash=?"
    ).bind(await digest(state)).first();
    if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now()) return json({ error: "flow_expired" }, 410);
    const secret = await decrypt(row.verifier_ciphertext, row.verifier_iv, env, "nexalabs:immoscout:oauth-flow:v1");
    return json({ state, verifier: secret.verifier, admin_telegram_id: row.admin_telegram_id, user_id: row.user_id, expires_at: row.expires_at, consumed: false });
  }
  if (path === "/internal/flow/claim" && request.method === "POST") {
    const body = await bodyJson(request);
    const state = String(body.state || "");
    const row = await env.DB.prepare(
      "SELECT state_hash,verifier_ciphertext,verifier_iv,admin_telegram_id,user_id,expires_at,consumed_at FROM oauth_flows WHERE state_hash=?"
    ).bind(await digest(state)).first();
    if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now()) return json({ error: "flow_expired" }, 410);
    const claimed = await env.DB.prepare(
      "UPDATE oauth_flows SET consumed_at=CURRENT_TIMESTAMP WHERE state_hash=? AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP"
    ).bind(row.state_hash).run();
    if (!claimed.meta.changes) return json({ error: "flow_expired" }, 410);
    const secret = await decrypt(row.verifier_ciphertext, row.verifier_iv, env, "nexalabs:immoscout:oauth-flow:v1");
    return json({ state, verifier: secret.verifier, admin_telegram_id: row.admin_telegram_id, user_id: row.user_id, expires_at: row.expires_at, consumed: true });
  }
  if (path === "/internal/flow/status" && request.method === "POST") {
    const body = await bodyJson(request);
    const state = String(body.state || "");
    const row = await env.DB.prepare(
      "SELECT admin_telegram_id,user_id,expires_at,consumed_at,completed_at FROM oauth_flows WHERE state_hash=?"
    ).bind(await digest(state)).first();
    if (!row || Date.parse(row.expires_at) <= Date.now()) return json({ error: "flow_expired" }, 410);
    return json({ state, admin_telegram_id: row.admin_telegram_id, user_id: row.user_id, expires_at: row.expires_at, consumed: !!row.consumed_at, completed_at: row.completed_at || null });
  }
  return json({ error: "not_found" }, 404);
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
      const message = String(error?.message || "internal_error");
      const safe = new Set(["payload_too_large","invalid_json","invalid_encryption_key"]);
      return json({ error: safe.has(message) ? message : "internal_error" }, 500);
    }
  },
};
