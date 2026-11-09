import { deleteExpiredListings } from "./retention.js";
import centralTokenWorker from "./immoscout-central-token.js";
import { HOUSING_SOURCES } from "./source-allowlist.js";
import { sourceForId } from "./source-allowlist.js";
import { ingestImmomioSource } from "./immomio-source.js";
import { ingestImmoweltSource } from "./immowelt-source.js";
import { ingestImmoScoutSource } from "./immoscout-source.js";
import { telegramText } from "./matching.js";
import { createSession, hashPassword, memberForAccess, refreshSession, revokeSession, sha256, verifyPassword } from "./auth.js";
import { handleCoach } from "./coach-api.js";
import { handleProviderFacade } from "./provider-facade.js";
import { processHousingApplication } from "./application-runtime.js";
import { createD1Client } from "./d1-database.js";
import { handleLegacyTelegramUpdate } from "./telegram-legacy/index.js";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};
const SOURCE_ROTATION = [1, 3, 23, 29, 34, 35, 66, 69, 71];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function databaseClient(env) {
  if (env.HOUSING_DB) return createD1Client(env.HOUSING_DB);
  throw new Error("housing_d1_binding_missing");
}

async function withDatabase(env, operation) {
  const sql = databaseClient(env);
  try {
    return await operation(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function runRetention(env) {
  return withDatabase(env, (sql) => deleteExpiredListings(sql, 5000));
}

async function createCentralEnvironment(env) {
  const apiSecret = env.CENTRAL_API_SECRET;
  const credentialKey = env.CENTRAL_TOKEN_ENCRYPTION_KEY;
  if (!apiSecret || !credentialKey) throw new Error("central_secret_unavailable");
  if (!/^[a-f0-9]{64}$/i.test(String(credentialKey || ""))) throw new Error("credential_key_invalid");

  return {
    ...env,
    API_SECRET: apiSecret,
    TOKEN_ENCRYPTION_KEY: String(credentialKey).toLowerCase(),
    DB: env.HOUSING_DB,
  };
}

async function sameSecret(supplied, expected) {
  if (typeof supplied !== "string" || typeof expected !== "string" || supplied.length !== expected.length) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

function isAuthorized(request, env) {
  const expected = env.RETENTION_TOKEN;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

async function telegramWebhook(request, env) {
  const expected = env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !await sameSecret(request.headers.get("x-telegram-bot-api-secret-token") || "", expected)) {
    return json({ error: "unauthorized" }, 401);
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 512 * 1024) return json({ error: "update_too_large" }, 413);
  const body = await request.text();
  let update;
  try { update = JSON.parse(body); } catch { return json({ error: "invalid_update" }, 400); }
  const updateId = Number(update?.update_id);
  if (!Number.isSafeInteger(updateId) || updateId < 0) return json({ error: "invalid_update" }, 400);
  const kind = update?.callback_query ? "callback_query" : update?.message ? "message" : "other";
  const hash = await sha256(body);
  const sql = databaseClient(env);
  try {
    const claimed = await sql`
      INSERT INTO housing.telegram_updates (update_id, payload_hash, kind, status)
      VALUES (${updateId}, ${hash}, ${kind}, 'processing')
      ON CONFLICT (update_id) DO UPDATE SET attempts = housing.telegram_updates.attempts + 1, payload_hash = EXCLUDED.payload_hash, status = 'processing', last_error = NULL
      WHERE housing.telegram_updates.status <> 'completed'
      RETURNING update_id
    `;
    if (!claimed.length) return json({ ok: true, duplicate: true });
    const result = await handleLegacyTelegramUpdate(env, update);
    await sql`UPDATE housing.telegram_updates SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE update_id = ${updateId}`;
    return json(result);
  } catch (error) {
    await sql`UPDATE housing.telegram_updates SET status = 'failed', last_error = ${String(error?.message || error).slice(0, 500)} WHERE update_id = ${updateId}`.catch(() => {});
    throw error;
  } finally { await sql.end({ timeout: 5 }); }
}

async function runSource(sql, request, env) {
  const expected = env.SOURCE_RUN_TOKEN;
  if (!expected || !await sameSecret(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "", expected)) return json({ error: "unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  const source = sourceForId(body.source_id);
  if (!source) return json({ error: "source_not_allowlisted" }, 422);
  if (!['immomio', 'immowelt', 'immoscout24'].includes(source.family)) return json({ error: "source_adapter_not_ported", source: source.family }, 409);
  const rows = await sql`SELECT id, name, connector_config FROM housing.source_registry WHERE id = ${source.id} AND enabled = true`;
  if (!rows[0]) return json({ error: "source_not_configured" }, 404);
  const rawConnectorConfig = rows[0].connector_config || {};
  const connectorConfig = typeof rawConnectorConfig === "string" ? JSON.parse(rawConnectorConfig || "{}") : rawConnectorConfig;
  const sourceRow = {
    ...rows[0],
    homepage_url: connectorConfig.homepage_url || connectorConfig.url || null,
    search_url: connectorConfig.search_url || connectorConfig.url || null,
  };
  const result = source.family === "immomio"
    ? await ingestImmomioSource(sql, sourceRow, connectorConfig)
    : source.family === "immowelt"
      ? await ingestImmoweltSource(sql, sourceRow, connectorConfig)
      : await ingestImmoScoutSource(sql, sourceRow, connectorConfig);
  await sql`UPDATE housing.source_registry SET last_success_at = now(), consecutive_failures = 0 WHERE id = ${source.id}`;
  return json({ ok: true, source_id: source.id, ...result });
}

async function processDelivery(sql, request, env) {
  const expected = env.DELIVERY_RUN_TOKEN || env.SOURCE_RUN_TOKEN;
  if (!expected || !await sameSecret(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "", expected)) return json({ error: "unauthorized" }, 401);
  const freshOnly = new URL(request.url).searchParams.get("fresh_only") === "1";
  const claimed = await sql.begin(async (tx) => {
    const rows = freshOnly ? await tx`
      SELECT d.id, d.participant_id, d.offer_identity_id, p.telegram_chat_id, oi.facts, oi.canonical_url
      FROM housing.deliveries d
      JOIN housing.participants p ON p.id = d.participant_id
      JOIN housing.offer_identities oi ON oi.id = d.offer_identity_id
      WHERE d.status = 'pending' AND d.created_at >= now() - interval '15 minutes'
      ORDER BY d.created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    ` : await tx`
      SELECT d.id, d.participant_id, d.offer_identity_id, p.telegram_chat_id, oi.facts, oi.canonical_url
      FROM housing.deliveries d
      JOIN housing.participants p ON p.id = d.participant_id
      JOIN housing.offer_identities oi ON oi.id = d.offer_identity_id
      WHERE d.status = 'pending'
      ORDER BY d.created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    if (!rows[0]) return null;
    await tx`UPDATE housing.deliveries SET status = 'processing', attempts = attempts + 1 WHERE id = ${rows[0].id}`;
    return rows[0];
  });
  if (!claimed) return json({ ok: true, status: "idle" });
  if (!claimed.telegram_chat_id) {
    await sql`UPDATE housing.deliveries SET status = 'skipped', error_message = 'telegram_not_connected' WHERE id = ${claimed.id}`.catch(() => {});
    return json({ ok: true, status: "skipped", reason: "telegram_not_connected" });
  }
  const token = String(env.TELEGRAM_BOT_TOKEN || "");
  if (!token) {
    await sql`UPDATE housing.deliveries SET status = 'failed' WHERE id = ${claimed.id}`;
    return json({ error: "telegram_token_missing" }, 503);
  }
  const facts = { ...(claimed.facts || {}), canonical_url: claimed.canonical_url };
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: claimed.telegram_chat_id, text: telegramText(facts), parse_mode: "HTML", disable_web_page_preview: false }), signal: AbortSignal.timeout(15_000) });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) {
    await sql`UPDATE housing.deliveries SET status = 'failed' WHERE id = ${claimed.id}`;
    return json({ error: "telegram_delivery_failed" }, 503);
  }
  await sql`UPDATE housing.deliveries SET status = 'sent', telegram_message_id = ${Number(result.result?.message_id || 0)}, sent_at = now() WHERE id = ${claimed.id}`;
  return json({ ok: true, status: "sent", delivery_id: claimed.id });
}

async function runScheduledHousingWork(env) {
  const minute = Math.floor(Date.now() / 60_000);
  const sourceId = SOURCE_ROTATION[minute % SOURCE_ROTATION.length];
  const sourceRequest = new Request("https://housing-runtime.internal/internal/source/run", {
    method: "POST",
    headers: { authorization: `Bearer ${env.SOURCE_RUN_TOKEN || ""}`, "content-type": "application/json" },
    body: JSON.stringify({ source_id: sourceId }),
  });
  try {
    await withDatabase(env, (sql) => runSource(sql, sourceRequest, env));
  } catch (error) {
    console.error("housing_source_scheduled_failed", JSON.stringify({ source_id: sourceId, error: String(error?.message || error) }));
  }

  for (let index = 0; index < 5; index++) {
    const deliveryRequest = new Request("https://housing-runtime.internal/internal/delivery/process?fresh_only=1", {
      method: "POST",
      headers: { authorization: `Bearer ${env.DELIVERY_RUN_TOKEN || ""}` },
    });
    let result;
    try {
      result = await withDatabase(env, (sql) => processDelivery(sql, deliveryRequest, env));
    } catch (error) {
      console.error("housing_delivery_scheduled_failed", String(error?.message || error));
      break;
    }
    if (result.status === 200) {
      const body = await result.clone().json().catch(() => null);
      if (body?.status === "idle") break;
    }
  }

  const applicationRequest = new Request("https://housing-runtime.internal/internal/application/process?fresh_only=1", {
    method: "POST",
    headers: { authorization: `Bearer ${env.APPLICATION_RUN_TOKEN || ""}` },
  });
  try {
    await withDatabase(env, async (sql) => {
      const result = await processHousingApplication(sql, env, applicationRequest);
      console.log("housing_application_scheduled", JSON.stringify(result.body || result));
    });
  } catch (error) {
    console.error("housing_application_scheduled_failed", String(error?.message || error));
  }
}

async function verifyMigratedSupabasePassword(email, password, env) {
  const baseUrl = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const publishableKey = String(env.SUPABASE_PUBLISHABLE_KEY || "");
  if (!baseUrl || !publishableKey) return { status: "unavailable" };

  let response;
  try {
    response = await fetch(baseUrl + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return { status: "unavailable" };
  }

  if (response.status === 429) {
    await response.body?.cancel().catch(() => {});
    return { status: "rate_limited" };
  }
  if (response.status === 400 || response.status === 401) {
    await response.body?.cancel().catch(() => {});
    return { status: "invalid" };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return { status: "unavailable" };
  }

  // The Supabase session is deliberately discarded. Only the D1 password hash
  // and D1 session survive this one-time compatibility check.
  await response.body?.cancel().catch(() => {});
  return { status: "valid" };
}

export async function handleAuth(sql, request, env = {}) {
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  if (action === "login") {
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!/^\S+@\S+\.\S+$/.test(email) || !password || password.length > 512) {
      return json({ error: "invalid_credentials" }, 401);
    }
    const rows = await sql`SELECT id, password_hash FROM housing.portal_members WHERE lower(email) = ${email} AND active = true`;
    if (!rows[0]) return json({ error: "invalid_credentials" }, 401);

    let verified = await verifyPassword(password, rows[0].password_hash);
    if (!verified && String(rows[0].password_hash || "").startsWith("migration_required$")) {
      const legacy = await verifyMigratedSupabasePassword(email, password, env);
      if (legacy.status === "rate_limited") return json({ error: "rate_limited" }, 429);
      if (legacy.status === "unavailable") return json({ error: "auth_unavailable" }, 503);
      if (legacy.status !== "valid") return json({ error: "invalid_credentials" }, 401);
      if (password.length < 12) return json({ error: "password_migration_required" }, 409);

      const migratedHash = await hashPassword(password);
      const updated = await sql`
        UPDATE housing.portal_members
        SET password_hash = ${migratedHash}, updated_at = now()
        WHERE id = ${rows[0].id} AND password_hash = ${rows[0].password_hash}
        RETURNING id
      `;
      if (!updated[0]) {
        const latest = await sql`SELECT password_hash FROM housing.portal_members WHERE id = ${rows[0].id} AND active = true`;
        if (!latest[0] || !await verifyPassword(password, latest[0].password_hash)) {
          return json({ error: "invalid_credentials" }, 401);
        }
      }
      verified = true;
    }
    if (!verified) return json({ error: "invalid_credentials" }, 401);
    return json({ ok: true, ...(await createSession(sql, rows[0].id)) });
  }
  if (action === "refresh") {
    const session = await refreshSession(sql, String(body.refresh_token || ""));
    return session ? json({ ok: true, ...session }) : json({ error: "unauthorized" }, 401);
  }
  if (action === "logout") {
    await revokeSession(sql, String(body.access_token || body.refresh_token || ""));
    return json({ ok: true });
  }
  if (action === "bootstrap_status") {
    const tokenHash = await sha256(String(body.token || ""));
    const rows = await sql`SELECT 1 FROM housing.bootstrap_tokens WHERE token_hash = ${tokenHash} AND consumed_at IS NULL AND expires_at > now()`;
    return rows[0] ? json({ ok: true }) : json({ error: "bootstrap_unavailable" }, 404);
  }
  if (action === "bootstrap_complete") {
    const tokenHash = await sha256(String(body.token || ""));
    const email = String(body.email || "").trim().toLowerCase();
    const displayName = String(body.displayName || "").trim().slice(0, 120);
    if (!/^\S+@\S+\.\S+$/.test(email) || !displayName) return json({ error: "profile_invalid" }, 400);
    const passwordHash = await hashPassword(String(body.password || ""));
    const activeSuperAdmins = await sql.unsafe("SELECT id, lower(email) AS email, password_hash FROM housing.portal_members WHERE role = 'super_admin' AND active = true");
    let memberId;
    if (activeSuperAdmins.length) {
      const existing = activeSuperAdmins.find((row) => row.email === email && String(row.password_hash || "").startsWith("migration_required$"));
      if (!existing) return json({ error: "bootstrap_unavailable" }, 404);
      const tokens = await sql.unsafe("UPDATE housing.bootstrap_tokens SET consumed_at = now() WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING id", [tokenHash]);
      if (!tokens[0]) return json({ error: "bootstrap_unavailable" }, 404);
      const updated = await sql.unsafe("UPDATE housing.portal_members SET display_name = $1, password_hash = $2, updated_at = now() WHERE id = $3 AND password_hash = $4 RETURNING id", [displayName, passwordHash, existing.id, existing.password_hash]);
      if (!updated[0]) return json({ error: "bootstrap_unavailable" }, 404);
      await sql.unsafe("UPDATE housing.portal_sessions SET revoked_at = now() WHERE member_id = $1 AND revoked_at IS NULL", [existing.id]);
      memberId = existing.id;
    } else {
      const activeMembers = await sql.unsafe("SELECT 1 FROM housing.portal_members WHERE active = true LIMIT 1");
      if (activeMembers[0]) return json({ error: "bootstrap_unavailable" }, 404);
      const tokens = await sql.unsafe("UPDATE housing.bootstrap_tokens SET consumed_at = now() WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING id", [tokenHash]);
      if (!tokens[0]) return json({ error: "bootstrap_unavailable" }, 404);
      memberId = crypto.randomUUID();
      await sql.unsafe("INSERT INTO housing.portal_members (id, email, display_name, role, password_hash) VALUES ($1, $2, $3, 'super_admin', $4)", [memberId, email, displayName, passwordHash]);
    }
    return json({ ok: true, ...(await createSession(sql, memberId)) });
  }
  return json({ error: "invalid_action" }, 400);
}

function cookie(request, name) {
  const prefix = `${name}=`;
  const value = String(request.headers.get("cookie") || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : "";
}

async function requestMember(sql, request) {
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : cookie(request, "__Host-tw_cp_access");
  return memberForAccess(sql, bearer);
}

async function participantAllowed(sql, member, participantId) {
  if (member?.role === "admin" || member?.role === "super_admin") return true;
  const rows = await sql`SELECT 1 FROM housing.participant_assignments WHERE participant_id = ${participantId} AND member_id = ${member.id}`;
  return Boolean(rows[0]);
}

async function uploadDocument(sql, request, env) {
  if (!env.DOCUMENTS) return json({ error: "document_storage_unavailable" }, 503);
  const member = await requestMember(sql, request);
  if (!member) return json({ error: "unauthorized" }, 401);
  const token = new URL(request.url).searchParams.get("token") || "";
  const rows = await sql`SELECT id, participant_id, object_key, content_type FROM housing.upload_tokens WHERE token_hash = ${await sha256(token)} AND expires_at > now() AND uploaded_at IS NULL AND consumed_at IS NULL`;
  if (!rows[0] || !await participantAllowed(sql, member, rows[0].participant_id)) return json({ error: "upload_not_found" }, 404);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 6 * 1024 * 1024) return json({ error: "document_too_large" }, 413);
  const body = await request.arrayBuffer();
  if (!body.byteLength || body.byteLength > 6 * 1024 * 1024) return json({ error: "document_too_large" }, 413);
  await env.DOCUMENTS.put(rows[0].object_key, body, { httpMetadata: { contentType: rows[0].content_type } });
  await sql`UPDATE housing.upload_tokens SET uploaded_at = now(), size_bytes = ${body.byteLength} WHERE id = ${rows[0].id}`;
  return json({ ok: true });
}

async function openDocument(sql, request, env) {
  if (!env.DOCUMENTS) return json({ error: "document_storage_unavailable" }, 503);
  const member = await requestMember(sql, request);
  if (!member) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const participantId = url.searchParams.get("participant_id") || "";
  const documentId = url.searchParams.get("document_id") || "";
  if (!await participantAllowed(sql, member, participantId)) return json({ error: "participant_forbidden" }, 403);
  const rows = await sql`SELECT object_key, content_type, original_filename FROM housing.documents WHERE id = ${documentId} AND participant_id = ${participantId}`;
  if (!rows[0]) return json({ error: "document_not_found" }, 404);
  const object = await env.DOCUMENTS.get(rows[0].object_key);
  if (!object) return json({ error: "document_not_found" }, 404);
  const headers = new Headers({ ...HEADERS, "content-type": rows[0].content_type, "content-disposition": `inline; filename="${String(rows[0].original_filename).replace(/[^a-zA-Z0-9._-]/g, "_")}"` });
  return new Response(object.body, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const routePath = url.pathname.startsWith("/edge/") ? url.pathname.slice("/edge".length) : url.pathname;

    if (request.method === "GET" && (url.pathname === "/health" || routePath === "/health")) {
      return json({
        ok: true,
        service: "traumwohnung-housing-runtime",
        databaseConfigured: Boolean(env.HOUSING_DB),
      });
    }

    if ((url.pathname === "/telegram/webhook" || routePath === "/telegram/webhook") && request.method === "POST") {
      try { return await telegramWebhook(request, env); }
      catch (error) { console.error("housing_telegram_webhook_failed", String(error?.message || error)); return json({ error: "telegram_unavailable" }, 503); }
    }

    if (routePath === "/internal/source/run" && request.method === "POST") {
      try { return await withDatabase(env, (sql) => runSource(sql, request, env)); }
      catch (error) { console.error("housing_source_run_failed", String(error?.message || error)); return json({ error: "source_run_failed" }, 503); }
    }

    if (routePath === "/internal/delivery/process" && request.method === "POST") {
      try { return await withDatabase(env, (sql) => processDelivery(sql, request, env)); }
      catch (error) { console.error("housing_delivery_failed", String(error?.message || error)); return json({ error: "delivery_failed" }, 503); }
    }

    if (routePath === "/internal/application/process" && request.method === "POST") {
      try {
        return await withDatabase(env, async (sql) => {
          const result = await processHousingApplication(sql, env, request);
          return json(result.body, result.status);
        });
      } catch (error) { console.error("housing_application_failed", String(error?.message || error)); return json({ error: "application_failed" }, 503); }
    }

    if (request.method === "POST" && url.pathname === "/edge/auth") {
      try {
        return await withDatabase(env, (sql) => handleAuth(sql, request, env));
      } catch (error) {
        console.error("housing_auth_failed", String(error?.message || error));
        return json({ error: "auth_unavailable" }, 503);
      }
    }

    if (request.method === "POST" && url.pathname === "/edge/provider/facade") {
      try {
        return await withDatabase(env, (sql) => handleProviderFacade(sql, request, env));
      } catch (error) {
        console.error("housing_provider_facade_failed", String(error?.message || error));
        return json({ error: "auth_facade_failed" }, 503);
      }
    }

    if (request.method === "POST" && url.pathname === "/edge/coach") {
      try {
        return await withDatabase(env, async (sql) => json(await handleCoach(sql, request, env)));
      } catch (error) {
        const code = String(error?.message || "");
        const status = code === "unauthorized" ? 401 : code === "participant_forbidden" ? 403 : code === "invalid_action" ? 400 : 422;
        console.error("housing_coach_api_failed", code.slice(0, 180));
        return json({ error: code || "coach_api_failed" }, status);
      }
    }

    if (request.method === "PUT" && url.pathname === "/edge/documents/upload") {
      try { return await withDatabase(env, (sql) => uploadDocument(sql, request, env)); }
      catch (error) { console.error("housing_document_upload_failed", String(error?.message || error)); return json({ error: "document_upload_failed" }, 503); }
    }

    if (request.method === "GET" && url.pathname === "/edge/documents/open") {
      try { return await withDatabase(env, (sql) => openDocument(sql, request, env)); }
      catch (error) { console.error("housing_document_open_failed", String(error?.message || error)); return json({ error: "document_open_failed" }, 503); }
    }

    if (request.method === "GET" && routePath === "/internal/source-allowlist") {
      if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      return json({ ok: true, sources: HOUSING_SOURCES });
    }

    if (routePath.startsWith("/internal/")) {
      if (env.PREVIEW_MODE === "1" && !(request.method === "GET" && routePath === "/internal/status")) {
        return json({ error: "preview_read_only" }, 403);
      }
      try {
        return await withDatabase(env, async (sql) => {
          const centralEnv = await createCentralEnvironment(env);
          return centralTokenWorker.fetch(new Request(new URL(routePath + url.search, request.url), request), centralEnv);
        });
      } catch (error) {
        console.error("central_immoscout_request_failed", String(error?.message || error));
        return json({ ok: false, error: "central_token_unavailable" }, 503);
      }
    }

    if (request.method === "GET" && (url.pathname === "/ready" || routePath === "/ready")) {
      try {
        const readiness = await withDatabase(env, async (sql) => {
          const [tables, centralTables, counts] = await Promise.all([
            sql`SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('source_registry','participants','portal_members','participant_assignments','portal_sessions','bootstrap_tokens','search_profiles','source_links','applicant_profiles','documents','upload_tokens','provider_connections','application_preferences','offer_identities','deliveries','applications','application_events','jobs','audit_events','telegram_updates','provider_auth_flows')`,
            sql`SELECT
              (SELECT count(*) FROM central_credentials) AS credentials,
              (SELECT count(*) FROM central_oauth_flows) AS oauth_flows,
              (SELECT count(*) FROM central_audit_events) AS audit_events`,
            sql`SELECT
              (SELECT count(*) FROM participants) AS participants,
              (SELECT count(*) FROM search_profiles) AS search_profiles,
              (SELECT count(*) FROM applicant_profiles) AS applicant_profiles,
              (SELECT count(*) FROM provider_connections) AS provider_connections,
              (SELECT count(*) FROM offer_identities) AS offers,
              (SELECT count(*) FROM deliveries) AS deliveries,
              (SELECT count(*) FROM applications) AS applications`,
          ]);
          return {
            role: "cloudflare-d1",
            rls: "worker_authorization",
            serviceRoleMember: false,
            listingAccess: "denied",
            retentionFunction: "available",
            centralVault: "available",
            legacyD1: "removed",
            centralTables: centralTables[0] || {},
            housingTarget: { tables: Number(tables[0]?.count || 0), rls: "worker_authorization", dataImported: Number(counts[0]?.participants || 0) > 0 },
            counts: counts[0] || {},
          };
        });
        return json({ ok: true, database: "reachable", ...readiness });
      } catch (error) {
        console.error("housing_runtime_readiness_failed", String(error?.message || error));
        return json({ ok: false, database: "unavailable" }, 503);
      }
    }

    if (request.method === "POST" && url.pathname === "/internal/retention/run") {
      if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);

      try {
        const deleted = await runRetention(env);
        return json({ ok: true, deleted });
      } catch (error) {
        console.error("housing_listing_retention_failed", String(error?.message || error));
        return json({ ok: false, error: "retention_failed" }, 503);
      }
    }

    return json({ error: "not_found" }, 404);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const deleted = await runRetention(env);
        console.log("housing_listing_retention_completed", JSON.stringify({ deleted }));
      } catch (error) {
        console.error("housing_listing_retention_failed", String(error?.message || error));
      }

      try {
        await runScheduledHousingWork(env);
      } catch (error) {
        console.error("housing_scheduled_work_failed", String(error?.message || error));
      }
    })());
  },
};

