import { timestampMillis } from "./application-policy.js";
import { credentialKeyBytes } from "./provider-credentials.js";

const PACKAGE_TTL = 24 * 60 * 60_000;
const FILE_TTL = 15 * 60_000;
const ORIGIN = "https://intern.traumwohnunghamburg.de/edge";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decode(value) {
  const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value || "").length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}

async function key(env) {
  return crypto.subtle.importKey("raw", credentialKeyBytes(env.APPLICATION_CREDENTIAL_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signedToken(env, claims) {
  const payload = encode(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", await key(env), encoder.encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}

async function verifiedToken(env, token) {
  const [payload, signature, ...rest] = String(token || "").split(".");
  if (!payload || !signature || rest.length) throw new Error("invalid_token");
  if (!await crypto.subtle.verify("HMAC", await key(env), decode(signature), encoder.encode(payload))) throw new Error("invalid_token");
  let claims;
  try { claims = JSON.parse(decoder.decode(decode(payload))); } catch { throw new Error("invalid_token"); }
  if (!/^[0-9a-f-]{36}$/i.test(String(claims?.participant_id || ""))
    || !/^[0-9a-f-]{36}$/i.test(String(claims?.application_id || ""))
    || !Number.isSafeInteger(Number(claims?.expires_at))
    || (claims.document_id != null && !/^[0-9a-f-]{36}$/i.test(String(claims.document_id)))) throw new Error("invalid_token");
  return claims;
}

async function activeApplication(sql, claims, now) {
  const rows = await sql`
    SELECT id, participant_id, created_at FROM housing.applications
    WHERE id = ${claims.application_id} AND participant_id = ${claims.participant_id} LIMIT 1
  `;
  const application = rows[0];
  const createdAt = timestampMillis(application?.created_at);
  if (!application || !Number.isFinite(createdAt) || now.getTime() >= Number(claims.expires_at)
    || Number(claims.expires_at) > createdAt + PACKAGE_TTL) throw new Error("package_expired");
  return application;
}

function responseText(body, status) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" } });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export async function createApplicationDocumentPackage(sql, env, application, now = new Date()) {
  const documents = await sql`
    SELECT id FROM housing.documents
    WHERE participant_id = ${application.participant_id} AND send_with_auto_apply = true
    ORDER BY created_at, id
  `;
  if (!documents.length) return { url: null, count: 0 };
  if (!env.DOCUMENTS) throw new Error("document_storage_unavailable");
  const createdAt = timestampMillis(application.created_at);
  const expiresAt = Math.min(createdAt + PACKAGE_TTL, now.getTime() + PACKAGE_TTL);
  if (!Number.isFinite(createdAt) || expiresAt <= now.getTime()) return { url: null, count: 0 };
  const token = await signedToken(env, { participant_id: application.participant_id, application_id: application.id, expires_at: expiresAt });
  return { url: `${ORIGIN}/documents/package?t=${encodeURIComponent(token)}`, count: documents.length };
}

export async function applicationDocumentPackageResponse(sql, env, request, now = new Date()) {
  try {
    const claims = await verifiedToken(env, new URL(request.url).searchParams.get("t"));
    await activeApplication(sql, claims, now);
    const documents = await sql`
      SELECT id, original_filename, size_bytes FROM housing.documents
      WHERE participant_id = ${claims.participant_id} AND send_with_auto_apply = true
      ORDER BY created_at, id
    `;
    const items = await Promise.all(documents.map(async document => {
      const token = await signedToken(env, { ...claims, document_id: document.id, expires_at: Math.min(Number(claims.expires_at), now.getTime() + FILE_TTL) });
      const size = Number(document.size_bytes || 0);
      return `<li><a href="${ORIGIN}/documents/package-file?t=${encodeURIComponent(token)}" rel="noopener noreferrer">${escapeHtml(document.original_filename)}</a><span>${size ? ` · ${Math.max(1, Math.round(size / 1024))} KB` : ""}</span></li>`;
    }));
    const list = items.length ? items.join("") : "<li>Aktuell sind keine Unterlagen freigegeben.</li>";
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Bewerbungsunterlagen</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;color:#111}h1{font-size:24px}p{color:#555}ul{padding-left:22px}li{margin:14px 0}a{color:#0563c1;word-break:break-word}span{color:#777;font-size:14px}</style></head><body><h1>Bewerbungsunterlagen</h1><p>Die folgenden Unterlagen wurden für diese Wohnungsbewerbung freigegeben. Downloadlinks sind jeweils 15 Minuten gültig.</p><ul>${list}</ul></body></html>`;
    return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, max-age=0", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" } });
  } catch (error) {
    const code = String(error?.message || "");
    return responseText(code === "invalid_token" ? "Dieser Link ist ungültig." : "Dieser Link ist nicht mehr gültig.", code === "invalid_token" ? 400 : 410);
  }
}

export async function applicationDocumentFileResponse(sql, env, request, now = new Date()) {
  try {
    if (!env.DOCUMENTS) throw new Error("document_storage_unavailable");
    const claims = await verifiedToken(env, new URL(request.url).searchParams.get("t"));
    if (!claims.document_id) throw new Error("invalid_token");
    await activeApplication(sql, claims, now);
    const rows = await sql`
      SELECT object_key, original_filename, content_type FROM housing.documents
      WHERE id = ${claims.document_id} AND participant_id = ${claims.participant_id} AND send_with_auto_apply = true LIMIT 1
    `;
    if (!rows[0]) throw new Error("package_expired");
    const object = await env.DOCUMENTS.get(rows[0].object_key);
    if (!object) throw new Error("document_missing");
    const filename = String(rows[0].original_filename || "Unterlage").replace(/[\r\n"\\]/g, "_");
    return new Response(object.body, { status: 200, headers: {
      "content-type": rows[0].content_type || "application/octet-stream",
      "content-disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(String(rows[0].original_filename || "Unterlage"))}`,
      "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer",
    } });
  } catch (error) {
    const code = String(error?.message || "");
    const status = code === "invalid_token" ? 400 : code === "document_missing" ? 404 : code === "document_storage_unavailable" ? 503 : 410;
    return responseText("Dieser Unterlagenlink ist nicht mehr gültig.", status);
  }
}
