import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Connector, Source, db, emsg, internalSecret, markSuccess } from "./shared.ts";
import { runScout, runScoutSchleswigHolstein } from "./scout.ts";
import { runGcp } from "./gcp.ts";
import { runImmomio } from "./immomio.ts";
import { runHpm } from "./hpm.ts";
import { runGeneric } from "./generic.ts";
import { runClaimedJob } from "./job-runner.ts";
import { runPublicInventory } from "./public-inventory.ts";
import { runNestpick } from "./nestpick.ts";
import { runCatalog } from "./catalog.ts";
import { runCategoryStreams } from "./category.ts";

async function runPortalRegistryMirror(s:Source){
  const started=new Date().toISOString();
  const portalSourceIds=[1,3];
  const {data,error,count}=await db
    .from("listings")
    .select("last_seen_at",{count:"exact"})
    .in("source_id",portalSourceIds)
    .eq("is_active",true)
    .contains("raw",{provider_source_id:s.id})
    .order("last_seen_at",{ascending:false})
    .limit(1);
  if(error)throw new Error(`portal registry mirror: ${error.message}`);
  const mapped=Math.max(0,Number(count||0));
  const lastPortalSeenAt=data?.[0]?.last_seen_at||null;
  const finished=new Date().toISOString();
  const {error:recordError}=await db.rpc("record_crawl_result",{
    p_source_id:s.id,
    p_started_at:started,
    p_finished_at:finished,
    p_success:true,
    p_connector_priority:1,
    p_connector_label:"portal registry mirror",
    p_fetched_count:mapped,
    p_inserted_count:0,
    p_metadata:{
      architecture:"v3",
      outcome:mapped>0?"success_with_portal_listing":"success_no_portal_inventory",
      strategy:"portal_registry_mirror",
      mirror_source_ids:portalSourceIds,
      provider_source_id:s.id,
      last_portal_seen_at:lastPortalSeenAt,
      complete:false,
    },
    p_error:null,
  });
  if(recordError)throw new Error(`portal registry mirror telemetry: ${recordError.message}`);
  return{
    ok:true,
    source_id:s.id,
    fetched:mapped,
    new:0,
    complete:false,
    mirror_source_ids:portalSourceIds,
    last_portal_seen_at:lastPortalSeenAt,
  };
}
async function processBaseSource(s:Source,connectors:Connector[]){
  const id=s.id;
  if(s.coverage_strategy==="category_streams_only"){
    const started=new Date().toISOString();
    await markSuccess(s,started,null,0,0,{strategy:"category_streams_only",complete:false});
    return {ok:true,source_id:id,fetched:0,new:0,complete:false,category_only:true};
  }
  if(s.coverage_strategy==="portal_registry_mirror")return runPortalRegistryMirror(s);
  const primary = connectors.find((c) => !c.shadow_only) || connectors[0];
  if(primary?.config?.adapter==="source-worker/scout-schleswig-holstein")return runScoutSchleswigHolstein(s);
  if (id === 1) return runScout(s);
  if(primary && ['source-worker/city-catalog','source-worker/wunder-catalog','source-worker/swap-catalog'].includes(String(primary.config?.adapter)))return runCatalog(s,primary);
  if(primary?.config?.adapter==='source-worker/nestpick-public')return runNestpick(s,primary);
  if(primary && ['source-worker/tag-public','source-worker/urban-public','source-worker/heim-public','source-worker/kaifu-public','source-worker/finken-public','source-worker/buchdrucker-public'].includes(String(primary.config?.adapter)))
    return runPublicInventory(s,primary);
  if (id === 8 && connectors.length) return runGcp(s, connectors);
  if (primary?.connector_kind === "immomio_tenant") return runImmomio(s, primary, connectors.filter(c=>c!==primary));
  if (primary?.connector_kind === "immosolve_api") return runHpm(s, primary);
  return runGeneric(s, connectors);
}
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
  const base=await processBaseSource(s,connectors);
  const category_streams=await runCategoryStreams(s).catch(error=>[{ok:false,error:error instanceof Error?error.message:String(error)}]);
  return {...base,category_streams};
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
        p_qty: 1,
      });
      if (error) throw error;
      if (!jobs?.length) break;
      claimed += jobs.length;
      const batch = await Promise.allSettled(jobs.map((j: any) => one(j)));
      for (const item of batch) {
        if (item.status === "fulfilled") results.push(item.value);
        else throw item.reason;
      }
      // Large portal parsers need their own invocation CPU budget.
      if (jobs.some((job: any) => [1, 2, 3, 69].includes(Number(job.source_id)))) break;
    }
    return Response.json({ ok: true, architecture: "v3", claimed, results });
  } catch (e) {
    return Response.json({ ok: false, error: emsg(e) }, { status: 500 });
  }
});
