import postgres from "postgres";
import { deleteExpiredListings } from "./retention.js";

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
  return withDatabase(env, (sql) => deleteExpiredListings(sql, 1000));
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
