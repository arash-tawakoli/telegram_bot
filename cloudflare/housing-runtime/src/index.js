import { deleteExpiredApplicationRecords, deleteExpiredListings, expireAdminPremiumOverrides } from "./retention.js";
import centralTokenWorker from "./immoscout-central-token.js";
import { HOUSING_SOURCES } from "./source-allowlist.js";
import { sourceForId } from "./source-allowlist.js";
import { ingestImmomioSource } from "./immomio-source.js";
import { ingestImmoweltSource } from "./immowelt-source.js";
import { ingestImmoScoutSource } from "./immoscout-source.js";
import { deliveryCutoverLedger, reconcileCloudflareDeliveries } from "./delivery-cutover-ledger.js";
import { telegramText } from "./matching.js";
import { createSession, hashPassword, memberForAccess, refreshSession, revokeSession, sha256, verifyPassword } from "./auth.js";
import { handleCoach } from "./coach-api.js";
import { handleProviderFacade } from "./provider-facade.js";
import { handleStripeWebhook } from "./stripe-webhook.js";
import { processHousingApplication } from "./application-runtime.js";
import { createD1Client } from "./d1-database.js";
import { handleLegacyTelegramUpdate } from "./telegram-legacy/index.js";
import { runEngagementNotifications } from "./engagement-cron.js";
import { recordTelegramActivity, recoverTelegramUpdates } from "./telegram-recovery.js";
import { scheduledTasksForMinute, sourcesForMinute } from "./source-schedule.js";
import { runPlatformSessionReminders } from "./platform-session-cron.js";
import { applicationDocumentFileResponse, applicationDocumentPackageResponse } from "./application-documents.js";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

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
  return withDatabase(env, async (sql) => {
    const deleted = await deleteExpiredListings(sql, 5000);
    const applications = await deleteExpiredApplicationRecords(sql, 5000);
    return { deleted, ...applications };
  });
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

const TELEGRAM_WEBHOOK_URL = "https://intern.traumwohnunghamburg.de/edge/telegram/webhook";

export async function ensureTelegramWebhook(env) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "");
  const secret = String(env.TELEGRAM_WEBHOOK_SECRET || "");
  if (!token || !secret) throw new Error("telegram_webhook_credentials_missing");
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: TELEGRAM_WEBHOOK_URL,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      max_connections: 40,
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) {
    throw new Error(`telegram_set_webhook_failed_${response.status}`);
  }
  return { ok: true, url: TELEGRAM_WEBHOOK_URL };
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
  const processingAt = new Date().toISOString();
  const sql = databaseClient(env);
  try {
    const claimed = await sql`
      INSERT INTO housing.telegram_updates (update_id, payload_hash, kind, status, payload_json, processing_at)
      VALUES (${updateId}, ${hash}, ${kind}, 'processing', ${body}, ${processingAt})
      ON CONFLICT (update_id) DO UPDATE SET attempts = housing.telegram_updates.attempts + 1, payload_hash = EXCLUDED.payload_hash, payload_json = EXCLUDED.payload_json, status = 'processing', processing_at = EXCLUDED.processing_at, last_error = NULL
      WHERE housing.telegram_updates.status = 'failed' AND housing.telegram_updates.attempts < 5
      RETURNING update_id
    `;
    if (!claimed.length) return json({ ok: true, duplicate: true });
    await recordTelegramActivity(sql, update, processingAt);
    const result = await handleLegacyTelegramUpdate(env, update);
    await sql`UPDATE housing.telegram_updates SET status = 'completed', completed_at = ${processingAt}, processing_at = NULL, payload_json = NULL, last_error = NULL WHERE update_id = ${updateId}`;
    return json(result);
  } catch (error) {
    await sql`UPDATE housing.telegram_updates SET status = 'failed', processing_at = ${processingAt}, last_error = ${String(error?.message || error).slice(0, 500)} WHERE update_id = ${updateId}`.catch(() => {});
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
  let result;
  try {
    result = source.family === "immomio"
      ? await ingestImmomioSource(sql, sourceRow, connectorConfig)
      : source.family === "immowelt"
        ? await ingestImmoweltSource(sql, sourceRow, connectorConfig)
        : await ingestImmoScoutSource(sql, sourceRow, connectorConfig);
  } catch (error) {
    await sql`UPDATE housing.source_registry SET consecutive_failures = COALESCE(consecutive_failures, 0) + 1 WHERE id = ${source.id}`
      .catch(updateError => console.error("housing_source_failure_record_failed", String(updateError?.message || updateError)));
    throw error;
  }
  await sql`UPDATE housing.source_registry SET last_success_at = now(), consecutive_failures = 0 WHERE id = ${source.id}`;
  return json({ ok: true, source_id: source.id, ...result });
}

async function processDelivery(sql, request, env) {
  const expected = env.DELIVERY_RUN_TOKEN || env.SOURCE_RUN_TOKEN;
  if (!expected || !await sameSecret(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "", expected)) return json({ error: "unauthorized" }, 401);
  const claimed = await sql.begin(async (tx) => {
    const rows = await tx`
      WITH fresh AS (
        SELECT id, created_at, 0 AS priority
        FROM housing.deliveries
        WHERE status = 'pending' AND error_message IS NOT 'cutover_waiting'
          AND created_at >= now() - interval '15 minutes'
        ORDER BY created_at, id
        LIMIT 1
      ), cutover AS (
        SELECT id, created_at, 1 AS priority
        FROM housing.deliveries
        WHERE status = 'pending' AND error_message = 'cutover_waiting'
        ORDER BY created_at, id
        LIMIT 1
      ), candidates AS (
        SELECT id, created_at, priority FROM fresh
        UNION ALL
        SELECT id, created_at, priority FROM cutover
      )
      SELECT d.id, d.participant_id, d.offer_identity_id, p.telegram_chat_id, oi.facts, oi.canonical_url
      FROM candidates c
      JOIN housing.deliveries d ON d.id = c.id
      JOIN housing.participants p ON p.id = d.participant_id
      JOIN housing.offer_identities oi ON oi.id = d.offer_identity_id
      ORDER BY c.priority, c.created_at, c.id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    if (!rows[0]) return null;
    const won = await tx`UPDATE housing.deliveries SET status = 'processing', attempts = attempts + 1 WHERE id = ${rows[0].id} AND status = 'pending' RETURNING id`;
    return won.length ? rows[0] : null;
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
  const cutover = env.DELIVERY_CUTOVER_ENABLED === "1";
  const ledgerInput = { participant_id: claimed.participant_id, url: claimed.canonical_url, owner: `cloudflare:${claimed.id}` };
  const ledger = action => deliveryCutoverLedger(env.HOUSING_DB, { ...ledgerInput, action });
  const defer = async () => {
    await sql`UPDATE housing.deliveries SET status = 'pending', error_message = 'cutover_waiting' WHERE id = ${claimed.id} AND status = 'processing'`;
    return json({ ok: true, status: "deferred" });
  };
  if (cutover) {
    if (!env.DELIVERY_CUTOVER_SECRET) return defer();
    try {
      const reservation = await ledger("claim");
      if (reservation.status === "already_sent") {
        await sql`UPDATE housing.deliveries SET status = 'skipped', error_message = 'cutover_duplicate' WHERE id = ${claimed.id}`;
        return json({ ok: true, status: "skipped", reason: "cutover_duplicate" });
      }
      if (reservation.status === "unknown") {
        await sql`UPDATE housing.deliveries SET status = 'failed', error_message = 'cutover_outcome_unknown' WHERE id = ${claimed.id}`;
        return json({ ok: true, status: "failed", reason: "cutover_outcome_unknown" });
      }
      if (reservation.status !== "claimed" || (await ledger("begin")).status !== "sending") return defer();
    } catch {
      await ledger("release").catch(() => {});
      console.error("delivery_cutover_claim_failed");
      return defer();
    }
  }
  let details = claimed.facts;
  if (typeof details === "string") {
    try { details = JSON.parse(details); } catch { details = {}; }
  }
  const facts = { ...(details && typeof details === "object" ? details : {}), canonical_url: claimed.canonical_url };
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: claimed.telegram_chat_id, text: telegramText(facts), parse_mode: "HTML", disable_web_page_preview: false }), signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    if (cutover) await ledger("unknown").catch(() => {});
    throw error;
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) {
    if (cutover) await ledger([400, 401, 403, 404, 409, 429].includes(response.status) ? "release" : "unknown");
    await sql`UPDATE housing.deliveries SET status = 'failed' WHERE id = ${claimed.id}`;
    return json({ error: "telegram_delivery_failed" }, 503);
  }
  if (cutover && (!Number.isSafeInteger(result.result?.message_id) || result.result.message_id < 1)) {
    await ledger("unknown");
    await sql`UPDATE housing.deliveries SET status = 'failed', error_message = 'cutover_outcome_unknown' WHERE id = ${claimed.id}`;
    return json({ error: "telegram_delivery_unknown" }, 503);
  }
  await sql`UPDATE housing.deliveries SET status = 'sent', telegram_message_id = ${Number(result.result?.message_id || 0)}, sent_at = now(), error_message = NULL WHERE id = ${claimed.id}`;
  if (cutover && (await ledger("sent").catch(() => ({ status: "unavailable" }))).status !== "sent") {
    console.error("delivery_cutover_confirmation_failed");
    return json({ ok: true, status: "sent", ledger_status: "pending" });
  }
  return json({ ok: true, status: "sent", delivery_id: claimed.id });
}

async function runScheduledHousingWork(env, minute = Math.floor(Date.now() / 60_000)) {
  const scheduledSources = sourcesForMinute(minute);
  const tasks = scheduledTasksForMinute(minute);
  if (tasks.engagement) {
    try {
      const result = await withDatabase(env, (sql) => runEngagementNotifications(sql, env));
      console.log("housing_engagement_scheduled", JSON.stringify(result));
    } catch (error) {
      console.error("housing_engagement_scheduled_failed", String(error?.message || error));
    }
  }
  if (tasks.telegramRecovery) {
    try {
      const result = await withDatabase(env, (sql) => recoverTelegramUpdates(sql, env, handleLegacyTelegramUpdate));
      if (result.scanned) console.log("housing_telegram_recovery", JSON.stringify(result));
    } catch (error) {
      console.error("housing_telegram_recovery_failed", String(error?.message || error));
    }
  }
  if (tasks.platformSessionReminders) {
    try {
      const result = await withDatabase(env, (sql) => runPlatformSessionReminders(sql, env));
      if (result.queued || result.sent) console.log("housing_platform_session_reminders", JSON.stringify(result));
    } catch (error) {
      console.error("housing_platform_session_reminders_failed", String(error?.message || error));
    }
  }
  if (tasks.premiumOverrideExpiry) {
    try {
      const expired = await withDatabase(env, expireAdminPremiumOverrides);
      if (expired) console.log("housing_admin_premium_overrides_expired", JSON.stringify({ expired }));
    } catch (error) {
      console.error("housing_admin_premium_override_expiry_failed", String(error?.message || error));
    }
  }
  if (env.DELIVERY_CUTOVER_ENABLED === "1" && env.DELIVERY_CUTOVER_SECRET) {
    try { await reconcileCloudflareDeliveries(env.HOUSING_DB); }
    catch { console.error("delivery_cutover_reconciliation_failed"); }
  }
  const runScheduledSource = async (sourceId) => {
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
  };
  if (scheduledSources[0] !== undefined) await runScheduledSource(scheduledSources[0]);

  for (let index = 0; index < 5; index++) {
    const deliveryRequest = new Request("https://housing-runtime.internal/internal/delivery/process", {
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

export async function handleAuth(sql, request, env = {}) {
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  // The portal owns password checks, rate limits and single-use recovery tokens.
  if (["login", "password_change", "password_reset_complete"].includes(action)) {
    return json({ error: "portal_auth_required" }, 410);
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
    let stage = "validate";
    try {
      const tokenHash = await sha256(String(body.token || ""));
      const email = String(body.email || "").trim().toLowerCase();
      const displayName = String(body.displayName || "").trim().slice(0, 120);
      const password = String(body.password || "");
      if (!/^\\S+@\\S+\\.\\S+$/.test(email) || !displayName || password.length < 12 || password.length > 512) {
        return json({ error: "profile_invalid" }, 400);
      }
      stage = "hash_password";
      const passwordHash = await hashPassword(password);
      stage = "read_super_admin";
      const activeSuperAdmins = await sql.unsafe("SELECT id, lower(email) AS email, password_hash FROM housing.portal_members WHERE role = 'super_admin' AND active = true");
      let memberId;
      if (activeSuperAdmins.length) {
        const existing = activeSuperAdmins.find((row) => row.email === email && String(row.password_hash || "").startsWith("migration_required$"));
        if (!existing) return json({ error: "bootstrap_unavailable" }, 404);
        stage = "consume_token";
        const tokens = await sql.unsafe("UPDATE housing.bootstrap_tokens SET consumed_at = now() WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING id", [tokenHash]);
        if (!tokens[0]) return json({ error: "bootstrap_unavailable" }, 404);
        stage = "update_admin_password";
        const updated = await sql.unsafe("UPDATE housing.portal_members SET display_name = $1, password_hash = $2, updated_at = now() WHERE id = $3 AND password_hash = $4 RETURNING id", [displayName, passwordHash, existing.id, existing.password_hash]);
        if (!updated[0]) return json({ error: "bootstrap_unavailable" }, 404);
        stage = "revoke_old_sessions";
        await sql.unsafe("UPDATE housing.portal_sessions SET revoked_at = now() WHERE member_id = $1 AND revoked_at IS NULL", [existing.id]);
        memberId = existing.id;
      } else {
        stage = "check_existing_members";
        const activeMembers = await sql.unsafe("SELECT 1 FROM housing.portal_members WHERE active = true LIMIT 1");
        if (activeMembers[0]) return json({ error: "bootstrap_unavailable" }, 404);
        stage = "consume_token";
        const tokens = await sql.unsafe("UPDATE housing.bootstrap_tokens SET consumed_at = now() WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING id", [tokenHash]);
        if (!tokens[0]) return json({ error: "bootstrap_unavailable" }, 404);
        memberId = crypto.randomUUID();
        stage = "insert_super_admin";
        await sql.unsafe("INSERT INTO housing.portal_members (id, email, display_name, role, password_hash) VALUES ($1, $2, $3, 'super_admin', $4)", [memberId, email, displayName, passwordHash]);
      }
      stage = "create_session";
      return json({ ok: true, ...(await createSession(sql, memberId)) });
    } catch (error) {
      console.error("housing_bootstrap_complete_failed", JSON.stringify({
        stage,
        error: String(error?.message || error).slice(0, 240),
        name: String(error?.name || "Error").slice(0, 80),
      }));
      throw error;
    }
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

    if (env.PREVIEW_MODE === "1" && !(request.method === "GET" && routePath === "/health")) {
      return json({ error: "preview_read_only" }, 403);
    }

    if (request.method === "GET" && (url.pathname === "/health" || routePath === "/health")) {
      return json({
        ok: true,
        service: "traumwohnung-housing-runtime",
        databaseConfigured: Boolean(env.HOUSING_DB),
      });
    }

    if (routePath === "/stripe/webhook") return handleStripeWebhook(request, env);

    if (request.method === "GET" && routePath === "/documents/package") {
      try { return await withDatabase(env, (sql) => applicationDocumentPackageResponse(sql, env, request)); }
      catch (error) { console.error("housing_document_package_failed", String(error?.message || error)); return json({ error: "document_package_unavailable" }, 503); }
    }

    if (request.method === "GET" && routePath === "/documents/package-file") {
      try { return await withDatabase(env, (sql) => applicationDocumentFileResponse(sql, env, request)); }
      catch (error) { console.error("housing_document_package_file_failed", String(error?.message || error)); return json({ error: "document_download_unavailable" }, 503); }
    }

    if (request.method === "GET" && routePath === "/documents/package") {
      try { return await withDatabase(env, (sql) => applicationDocumentPackageResponse(sql, env, request)); }
      catch (error) { console.error("housing_document_package_failed", String(error?.message || error)); return json({ error: "document_package_unavailable" }, 503); }
    }

    if (request.method === "GET" && routePath === "/documents/package-file") {
      try { return await withDatabase(env, (sql) => applicationDocumentFileResponse(sql, env, request)); }
      catch (error) { console.error("housing_document_package_file_failed", String(error?.message || error)); return json({ error: "document_download_unavailable" }, 503); }
    }

    if (routePath === "/internal/delivery-cutover-ledger" && request.method === "POST") {
      const secret = String(env.DELIVERY_CUTOVER_SECRET || "");
      if (!secret || !env.HOUSING_DB) return json({ error: "cutover_ledger_unavailable" }, 503);
      if (!await sameSecret(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "", secret)) return json({ error: "unauthorized" }, 401);
      try { return json(await deliveryCutoverLedger(env.HOUSING_DB, await request.json().catch(() => null))); }
      catch (error) {
        if (["invalid_ledger_request", "invalid_listing_url", "unsupported_listing_url"].includes(String(error?.message))) return json({ error: String(error.message) }, 400);
        console.error("delivery_cutover_ledger_failed");
        return json({ error: "cutover_ledger_unavailable" }, 503);
      }
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
          const [tables, centralTables, imported] = await Promise.all([
            sql`SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('source_registry','participants','portal_members','participant_assignments','portal_sessions','bootstrap_tokens','search_profiles','source_links','applicant_profiles','documents','upload_tokens','provider_connections','application_preferences','offer_identities','deliveries','applications','application_events','application_dedupe_keys','jobs','audit_events','telegram_updates','provider_auth_flows')`,
            sql`SELECT
              (SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'central_credentials') AS credentials,
              (SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'central_oauth_flows') AS oauth_flows,
              (SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'central_audit_events') AS audit_events`,
            sql`SELECT 1 AS imported FROM participants LIMIT 1`,
          ]);
          const central = centralTables[0] || {};
          const hasCentralTables = ["credentials", "oauth_flows", "audit_events"].every((key) => Number(central[key]) === 1);
          return {
            role: "cloudflare-d1",
            rls: "worker_authorization",
            serviceRoleMember: false,
            listingAccess: "denied",
            retentionFunction: "available",
            centralVault: hasCentralTables ? "available" : "unavailable",
            legacyD1: "removed",
            centralTables: {
              credentials: Number(central.credentials) === 1,
              oauth_flows: Number(central.oauth_flows) === 1,
              audit_events: Number(central.audit_events) === 1,
            },
            housingTarget: { tables: Number(tables[0]?.count || 0), rls: "worker_authorization", dataImported: Boolean(imported[0]) },
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
        return json({ ok: true, ...deleted });
      } catch (error) {
        console.error("housing_listing_retention_failed", String(error?.message || error));
        return json({ ok: false, error: "retention_failed" }, 503);
      }
    }

    return json({ error: "not_found" }, 404);
  },

  async scheduled(controller, env, ctx) {
    if (env.PREVIEW_MODE === "1") return;
    const scheduledTime = Number(controller?.scheduledTime);
    const minute = Number.isSafeInteger(scheduledTime) && scheduledTime > 0 ? Math.floor(scheduledTime / 60_000) : Math.floor(Date.now() / 60_000);
    const tasks = scheduledTasksForMinute(minute);
    ctx.waitUntil((async () => {
      if (tasks.verifyTelegramWebhook && env.TELEGRAM_WEBHOOK_REGISTER === "1") {
        try {
          const result = await ensureTelegramWebhook(env);
          console.log("telegram_webhook_registered", JSON.stringify(result));
        } catch (error) {
          console.error("telegram_webhook_registration_failed", String(error?.message || "unknown").slice(0, 120));
        }
      }

      try {
        const deleted = await runRetention(env);
        console.log("housing_listing_retention_completed", JSON.stringify({ deleted }));
      } catch (error) {
        console.error("housing_listing_retention_failed", String(error?.message || error));
      }

      try {
        await runScheduledHousingWork(env, minute);
      } catch (error) {
        console.error("housing_scheduled_work_failed", String(error?.message || error));
      }
    })());
  },
};

