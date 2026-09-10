import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Connector, Source, db, emsg, internalSecret } from "./shared.ts";
import { runScout } from "./scout.ts";
import { runKlein } from "./klein.ts";
import { runGcp } from "./gcp.ts";
import { runImmomio } from "./immomio.ts";
import { runHpm } from "./hpm.ts";
import { runGeneric } from "./generic.ts";
import { runClaimedJob } from "./job-runner.ts";
import { runPublicInventory } from "./public-inventory.ts";
import { runNestpick } from "./nestpick.ts";
import { runCatalog } from "./catalog.ts";

const CATALOG_ADAPTERS = new Set([
  "source-worker/city-catalog",
  "source-worker/wunder-catalog",
  "source-worker/swap-catalog",
]);
const PUBLIC_ADAPTERS = new Set([
  "source-worker/tag-public",
  "source-worker/urban-public",
  "source-worker/heim-public",
  "source-worker/kaifu-public",
  "source-worker/finken-public",
]);

function primaryOf(connectors: Connector[]) {
  return connectors.find((c) => !c.shadow_only) || connectors[0];
}

async function runConnectorRoute(
  s: Source,
  id: number,
  connectors: Connector[],
  allowImmomioFallback = true,
): Promise<any> {
  const primary = primaryOf(connectors);
  if (!primary) return runGeneric(s, connectors);

  const adapter = String(primary.config?.adapter || "");
  if (CATALOG_ADAPTERS.has(adapter)) return runCatalog(s, primary);
  if (adapter === "source-worker/nestpick-public") return runNestpick(s, primary);
  if (PUBLIC_ADAPTERS.has(adapter)) return runPublicInventory(s, primary);
  if (id === 8 && connectors.length) return runGcp(s, connectors);

  if (primary.connector_kind === "immomio_tenant") {
    const result = await runImmomio(
      s,
      primary,
      connectors.filter((c) => c !== primary),
    );
    if (result?.ok !== false || !allowImmomioFallback) return result;

    // Universal cooperative routing: Immomio is primary, but a tenant that does
    // not expose a usable Homepage GraphQL token must never take an otherwise
    // healthy housing source offline. Keep the previous verified connector as
    // an automatic fallback until that tenant becomes directly enumerable.
    const legacy = connectors.filter(
      (c) => c !== primary && c.connector_kind !== "immomio_tenant",
    );
    if (!legacy.length) return result;

    const fallback = await runConnectorRoute(s, id, legacy, false);
    return fallback?.ok === false
      ? {
          ...fallback,
          immomio_primary_failed: true,
          immomio_primary_error: result?.error || "Immomio primary failed",
        }
      : {
          ...fallback,
          immomio_primary_fallback: true,
          immomio_primary_error: result?.error || "Immomio primary failed",
        };
  }

  if (primary.connector_kind === "immosolve_api") return runHpm(s, primary);
  return runGeneric(s, connectors);
}

async function processSource(id: number) {
  const { data: source, error } = await db
    .from("sources")
    .select("*")
    .eq("id", id)
    .eq("enabled", true)
    .eq("runtime_mode", "live")
    .single();
  if (error || !source) throw new Error(error?.message || "source unavailable");
  const s = source as Source;
  const { data: cs, error: ce } = await db
    .from("source_connectors")
    .select("priority,label,connector_kind,enumerable,shadow_only,config")
    .eq("source_id", id)
    .eq("enabled", true)
    .order("priority");
  if (ce) throw ce;
  const connectors = (cs || []) as Connector[];
  if (id === 1) return runScout(s);
  if (id === 2) return runKlein(s);
  return runConnectorRoute(s, id, connectors);
}

async function one(job: any) {
  return runClaimedJob(job, processSource, async (args) => {
    const { data, error } = await db.rpc("finish_source_job_attempt", args);
    if (error) throw new Error(`finish_source_job_attempt: ${error.message}`);
    return data === true;
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST")
      return new Response("method not allowed", { status: 405 });
    const internal = await internalSecret();
    if ((req.headers.get("x-internal-secret") || "") !== internal)
      return new Response("unauthorized", { status: 401 });
    if ((await req.json().catch(() => ({}))).dry_run) {
      const { error } = await db.from("sources").select("id").limit(1);
      if (error) throw error;
      return Response.json({ ok: true, dry_run: true });
    }
    const started = Date.now();
    let claimed = 0;
    const results: any[] = [];
    while (Date.now() - started < 50000) {
      const { data: jobs, error } = await db.rpc("claim_source_jobs", {
        p_worker: "source-worker",
        p_qty: 3,
      });
      if (error) throw error;
      if (!jobs?.length) break;
      claimed += jobs.length;
      const batch = await Promise.allSettled(jobs.map((j: any) => one(j)));
      for (const item of batch) {
        if (item.status === "fulfilled") results.push(item.value);
        else throw item.reason;
      }
    }
    return Response.json({ ok: true, architecture: "v3", claimed, results });
  } catch (e) {
    return Response.json({ ok: false, error: emsg(e) }, { status: 500 });
  }
});
