import postgres from "postgres";
import { deleteExpiredListings } from "./retention.js";
import { createD1Compat } from "./d1-compat.js";
import centralTokenWorker from "./immoscout-central-token.js";

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

async function migrateLegacyCentralToken(request, env, sql, centralEnv) {
  if (!await sameSecret(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "", centralEnv.API_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }

  const existing = await sql`
    SELECT singleton
    FROM app_private.immoscout_central_credentials
    WHERE singleton = 'central'
    LIMIT 1
  `;
  if (existing.length) return json({ ok: true, migrated: false, reason: "already_migrated" });

  let legacyResponse;
  try {
    legacyResponse = await fetch("https://immoscout-central-token-staging.arash-ce5.workers.dev/internal/credentials", {
      headers: { authorization: `Bearer ${centralEnv.API_SECRET}`, accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return json({ ok: false, error: "legacy_source_unavailable" }, 503);
  }
  if (legacyResponse.status === 404) return json({ ok: true, migrated: false, reason: "legacy_credentials_missing" });
  if (!legacyResponse.ok) return json({ ok: false, error: "legacy_source_unavailable" }, 503);

  const legacy = await legacyResponse.json().catch(() => null);
  if (!legacy || typeof legacy.access_token !== "string" || typeof legacy.refresh_token !== "string") {
    return json({ ok: false, error: "legacy_credentials_invalid" }, 502);
  }

  const storeRequest = new Request(new URL("/internal/store", request.url), {
    method: "POST",
    headers: {
      authorization: `Bearer ${centralEnv.API_SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      account_hint: legacy.account_hint,
      access_token: legacy.access_token,
      refresh_token: legacy.refresh_token,
      id_token: typeof legacy.id_token === "string" ? legacy.id_token : null,
      token_type: legacy.token_type || "Bearer",
      scope: legacy.scope || "",
      expires_at: legacy.expires_at,
      preserve_enabled: false,
      admin_telegram_id: "8538226539",
    }),
  });

  const stored = await centralTokenWorker.fetch(storeRequest, centralEnv);
  if (!stored.ok) return json({ ok: false, error: "legacy_credentials_store_failed" }, 503);
  return json({ ok: true, migrated: true, enabled: false });
}

function isAuthorized(request, env) {
  const expected = env.RETENTION_TOKEN;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
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

    if (url.pathname.startsWith("/internal/")) {
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
        await withDatabase(env, async (sql) => {
          await sql`SELECT 1 AS ready`;
        });
        return json({ ok: true, database: "reachable" });
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
    ctx.waitUntil(
      runRetention(env)
        .then((deleted) => {
          console.log("housing_listing_retention_completed", JSON.stringify({ deleted }));
        })
        .catch((error) => {
          console.error("housing_listing_retention_failed", String(error?.message || error));
        }),
    );
  },
};
