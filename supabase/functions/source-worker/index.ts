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
import { runCategoryStreams } from "./category-streams.ts";

async function processSource(id: number) {
  const { data: source, error } = await db
    .from("sources")
    .select("*,source_connectors(priority,label,connector_kind,enumerable,shadow_only,config,enabled,warmed_at)")
    .eq("id", id)
    .eq("enabled", true)
    .eq("runtime_mode", "live")
    .single();
  if (error || !source) throw new Error(error?.message || "source unavailable");
  const s = source as Source;
  const connectors = (source.source_connectors || [])
    .filter((c: any) => c.enabled)
    .sort((a: any, b: any) => a.priority - b.priority) as Connector[];
  const primary = connectors.find((c) => !c.shadow_only) || connectors[0];
  let result: any;
  if (id === 1) result = await runScout(s);
  else if (id === 2) result = await runKlein(s);
  else if(primary && ['source-worker/city-catalog','source-worker/wunder-catalog','source-worker/swap-catalog'].includes(String(primary.config?.adapter)))result = await runCatalog(s,primary);
  else if(primary?.config?.adapter==='source-worker/nestpick-public')result = await runNestpick(s,primary);
  else if(primary && ['source-worker/tag-public','source-worker/urban-public','source-worker/heim-public','source-worker/kaifu-public','source-worker/finken-public'].includes(String(primary.config?.adapter)))
    result = await runPublicInventory(s,primary);
  else if (id === 8 && connectors.length) result = await runGcp(s, connectors);
  else if (primary?.connector_kind === "immomio_tenant")
    result = await runImmomio(s, primary, connectors.filter(c=>c!==primary));
  else if (primary?.connector_kind === "immosolve_api") result = await runHpm(s, primary);
  else result = await runGeneric(s, connectors);

  if ([1,2,6,12].includes(id)) {
    try {
      const category_streams = await runCategoryStreams(s);
      if (category_streams.length) result = {...result, category_streams};
    } catch (error) {
      console.error("source_category_streams", id, emsg(error));
    }
  }
  return result;
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
    if ((await req.json().catch(()=>({}))).dry_run) {
      const {error}=await db.from('sources').select('id').limit(1);
      if(error)throw error;return Response.json({ok:true,dry_run:true});
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
