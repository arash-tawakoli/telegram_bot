import postgres from "postgres";
import { deleteExpiredListings } from "./retention.js";
import { createD1Compat } from "./d1-compat.js";
import centralTokenWorker from "./immoscout-central-token.js";
import { importLegacyD1Snapshot, verifyLegacyD1SnapshotKey } from "./legacy-migration.js";
import { proxySupabaseFunction } from "./supabase-proxy.js";
import { HOUSING_SOURCES } from "./source-allowlist.js";
import { createSession, refreshSession, revokeSession, verifyPassword } from "./auth.js";
import { handleCoach } from "./coach-api.js";

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
  const connectionString = env.HYPERDRIVE?.connectionString;
  if (!connectionString) throw new Error("database_binding_missing");

  return postgres(connectionString, {
    max: 5,
    fetch_types: false,
    prepare: true,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: {
      application_name: "Cloudflare Housing Runtime",
    },
  });
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

async function runLegacyD1Migration(env) {
  return withDatabase(env, async (sql) => {
    const centralEnv = await createCentralEnvironment(env, sql);
    const request = new Request("https://housing-runtime.internal/internal/migrate-from-d1", {
      method: "POST",
      headers: { authorization: `Bearer ${centralEnv.API_SECRET}` },
    });
    const response = await migrateLegacyCentralToken(request, env, sql, centralEnv);
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) {
      throw new Error(result?.error || "legacy_migration_failed");
    }
    return result;
  });
}


function decodeBase64(value) {
  return Uint8Array.from(atob(String(value || "")), (character) => character.charCodeAt(0));
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getDatabaseSecret(sql, name) {
  const rows = await sql`SELECT app_private.get_housing_runtime_secret(${name}) AS secret`;
  const value = rows?.[0]?.secret;
  if (!value) throw new Error("database_secret_unavailable");
  return String(value);
}

async function createCentralEnvironment(env, sql) {
  const [apiSecret, credentialKey] = await Promise.all([
    getDatabaseSecret(sql, "immoscout_central_cloudflare_api_secret"),
    getDatabaseSecret(sql, "application_credential_key_v1"),
  ]);
  const keyBytes = decodeBase64(credentialKey);
  if (keyBytes.length !== 32) throw new Error("credential_key_invalid");

  return {
    ...env,
    API_SECRET: apiSecret,
    TOKEN_ENCRYPTION_KEY: bytesToHex(keyBytes),
    DB: createD1Compat(sql),
  };
}

async function encryptionKeyFingerprint(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return bytesToHex(new Uint8Array(digest));
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

async function readLegacyD1Snapshot(env, keyHex) {
  const db = env.LEGACY_D1;
  if (!db) throw new Error("legacy_d1_binding_missing");

  const [credentials, oauthFlows, auditEvents] = await Promise.all([
    db.prepare(
      "SELECT singleton, account_hint, ciphertext, iv, key_version, status, enabled, expires_at, last_verified_at, last_error, updated_at FROM central_credentials WHERE singleton = ?"
    ).bind("central").first(),
    db.prepare(
      "SELECT state_hash, verifier_ciphertext, verifier_iv, admin_telegram_id, user_id, expires_at, consumed_at, created_at FROM oauth_flows ORDER BY created_at ASC LIMIT 10001"
    ).all(),
    db.prepare(
      "SELECT id, event_type, account_hint, admin_telegram_id, created_at FROM audit_events ORDER BY id ASC LIMIT 10001"
    ).all(),
  ]);

  return {
    credentials: credentials || null,
    oauth_flows: oauthFlows?.results || [],
    audit_events: auditEvents?.results || [],
    key_fingerprint: await encryptionKeyFingerprint(keyHex),
  };
}

async function migrateLegacyCentralToken(request, env, sql, centralEnv) {
  if (!await sameSecret(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "", centralEnv.API_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }
  if (env.PREVIEW_MODE === "1" && new URL(request.url).searchParams.get("dry_run") !== "1") {
    return json({ error: "preview_read_only" }, 403);
  }

  try {
    const snapshot = await readLegacyD1Snapshot(env, centralEnv.TOKEN_ENCRYPTION_KEY);
    const verified = await verifyLegacyD1SnapshotKey(snapshot, centralEnv.TOKEN_ENCRYPTION_KEY);
    const counts = {
      credentials: snapshot.credentials ? 1 : 0,
      oauth_flows: snapshot.oauth_flows.length,
      audit_events: snapshot.audit_events.length,
    };

    if (new URL(request.url).searchParams.get("dry_run") === "1") {
      return json({ ok: true, verified: true, counts, keyCheck: verified });
    }

    const imported = await importLegacyD1Snapshot(
      sql,
      snapshot,
      snapshot.key_fingerprint,
    );
    return json({
      ok: true,
      migrated: imported.credentials > 0 || imported.oauth_flows > 0 || imported.audit_events > 0,
      imported,
      keyCheck: verified,
    });
  } catch (error) {
    const code = String(error?.message || "");
    if (code.includes("key_mismatch")) {
      return json({ ok: false, error: "legacy_encryption_key_mismatch" }, 409);
    }
    if (code.startsWith("legacy_")) return json({ ok: false, error: code }, 422);
    console.error("central_immoscout_migration_failed", code);
    return json({ ok: false, error: "migration_failed" }, 503);
  }
}
function isAuthorized(request, env) {
  const expected = env.RETENTION_TOKEN;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

async function handleAuth(sql, request) {
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  if (action === "login") {
    const email = String(body.email || "").trim().toLowerCase();
    const rows = await sql`SELECT id, password_hash FROM housing.portal_members WHERE lower(email) = ${email} AND active = true`;
    if (!rows[0] || !await verifyPassword(String(body.password || ""), rows[0].password_hash)) return json({ error: "invalid_credentials" }, 401);
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
  return json({ error: "invalid_action" }, 400);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        service: "traumwohnung-housing-runtime",
        databaseConfigured: Boolean(env.HYPERDRIVE?.connectionString),
      });
    }

    if (request.method === "POST" && url.pathname === "/edge/auth") {
      try {
        return await withDatabase(env, (sql) => handleAuth(sql, request));
      } catch (error) {
        console.error("housing_auth_failed", String(error?.message || error));
        return json({ error: "auth_unavailable" }, 503);
      }
    }

    if (request.method === "POST" && url.pathname === "/edge/coach") {
      try {
        return await withDatabase(env, async (sql) => json(await handleCoach(sql, request)));
      } catch (error) {
        const code = String(error?.message || "");
        const status = code === "unauthorized" ? 401 : code === "participant_forbidden" ? 403 : code === "invalid_action" ? 400 : 422;
        console.error("housing_coach_api_failed", code.slice(0, 180));
        return json({ error: code || "coach_api_failed" }, status);
      }
    }

    const proxyMatch = url.pathname.match(/^\/edge\/(coach|telegram|source|application|immoscout-application)$/);
    if (proxyMatch) {
      try {
        return await proxySupabaseFunction(request, env, proxyMatch[1]);
      } catch (error) {
        console.error("housing_edge_proxy_failed", String(error?.message || error));
        return json({ error: "upstream_unavailable" }, 503);
      }
    }

    if (request.method === "POST" && url.pathname === "/internal/migrate-from-d1") {
      try {
        return await withDatabase(env, async (sql) => {
          const centralEnv = await createCentralEnvironment(env, sql);
          return migrateLegacyCentralToken(request, env, sql, centralEnv);
        });
      } catch (error) {
        console.error("central_immoscout_migration_failed", String(error?.message || error));
        return json({ ok: false, error: "migration_failed" }, 503);
      }
    }

    if (request.method === "GET" && url.pathname === "/internal/source-allowlist") {
      if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      return json({ ok: true, sources: HOUSING_SOURCES });
    }

    if (url.pathname.startsWith("/internal/")) {
      if (env.PREVIEW_MODE === "1" && !(request.method === "GET" && url.pathname === "/internal/status")) {
        return json({ error: "preview_read_only" }, 403);
      }
      try {
        return await withDatabase(env, async (sql) => {
          const centralEnv = await createCentralEnvironment(env, sql);
          return centralTokenWorker.fetch(request, centralEnv);
        });
      } catch (error) {
        console.error("central_immoscout_request_failed", String(error?.message || error));
        return json({ ok: false, error: "central_token_unavailable" }, 503);
      }
    }

    if (request.method === "GET" && url.pathname === "/ready") {
      try {
        const readiness = await withDatabase(env, async (sql) => {
          const centralEnv = await createCentralEnvironment(env, sql);
          const legacySnapshot = await readLegacyD1Snapshot(env, centralEnv.TOKEN_ENCRYPTION_KEY);
          await verifyLegacyD1SnapshotKey(legacySnapshot, centralEnv.TOKEN_ENCRYPTION_KEY);
          const [identity, permissions, rls, counts] = await Promise.all([
            sql`SELECT current_user AS role, r.rolbypassrls AS bypass_rls,
                pg_has_role(current_user, 'service_role', 'member') AS service_role_member
              FROM pg_roles AS r WHERE r.rolname = current_user`,
            sql`SELECT
                has_table_privilege(current_user, 'app_private.immoscout_central_credentials', 'SELECT') AS credentials_read,
                has_table_privilege(current_user, 'app_private.immoscout_central_oauth_flows', 'SELECT') AS oauth_read,
                has_table_privilege(current_user, 'app_private.immoscout_central_audit_events', 'SELECT') AS audit_read,
                has_table_privilege(current_user, 'public.listings', 'SELECT') AS listings_read,
                has_function_privilege(current_user, 'app_private.delete_expired_listings(integer)', 'EXECUTE') AS retention_execute,
                has_function_privilege(current_user, 'app_private.get_housing_runtime_secret(text)', 'EXECUTE') AS scoped_secret_execute`,
            sql`SELECT count(*) = 3 AND bool_and(c.relrowsecurity) AS all_enabled
              FROM pg_class AS c
              JOIN pg_namespace AS n ON n.oid = c.relnamespace
              WHERE n.nspname = 'app_private'
                AND c.relname IN (
                  'immoscout_central_credentials',
                  'immoscout_central_oauth_flows',
                  'immoscout_central_audit_events'
                )`,
            sql`SELECT
                (SELECT count(*)::integer FROM app_private.immoscout_central_credentials) AS credentials,
                (SELECT count(*)::integer FROM app_private.immoscout_central_oauth_flows) AS oauth_flows,
                (SELECT count(*)::integer FROM app_private.immoscout_central_audit_events) AS audit_events`,
          ]);
          const role = identity[0];
          const access = permissions[0];
          const rlsEnabled = Boolean(rls[0]?.all_enabled);
          if (!role || role.bypass_rls || role.service_role_member ||
              !access.credentials_read || !access.oauth_read || !access.audit_read ||
              access.listings_read || !access.retention_execute || !access.scoped_secret_execute ||
              !rlsEnabled) {
            throw new Error("runtime_security_contract_failed");
          }
          return {
            role: role.role,
            rls: "enabled",
            serviceRoleMember: false,
            listingAccess: "denied",
            retentionFunction: "available",
            centralVault: "available",
            legacyD1: "ciphertext_verified",
            centralTables: counts[0],
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
      if (env.MIGRATE_D1_ONCE === "1") {
        try {
          const migrated = await runLegacyD1Migration(env);
          console.log("central_d1_migration_completed", JSON.stringify(migrated));
        } catch (error) {
          console.error("central_d1_migration_failed", String(error?.message || error));
        }
      }

      try {
        const deleted = await runRetention(env);
        console.log("housing_listing_retention_completed", JSON.stringify({ deleted }));
      } catch (error) {
        console.error("housing_listing_retention_failed", String(error?.message || error));
      }
    })());
  },
};

