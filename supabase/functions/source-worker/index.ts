import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Connector, Source, db, emsg, internalSecret, markSuccess } from "./shared.ts";
import { runScout, runScoutSchleswigHolstein } from "./scout.ts";
import { runImmomio } from "./immomio.ts";
import { runGeneric } from "./generic.ts";
import { runClaimedJob } from "./job-runner.ts";
import { runPublicInventory } from "./finken-inventory.ts";
import { runCategoryStreams } from "./category.ts";
import { isAllowedSearchSource, isImmomioSearchSource } from "./search-policy.ts";

function processBaseSource(s:Source,connectors:Connector[]){
  const id=s.id;
  if(!isAllowedSearchSource(id))throw new Error("search source retired");
  if(s.coverage_strategy==="category_streams_only"){
    const started=new Date().toISOString();
    return markSuccess(s,started,null,0,0,{strategy:"category_streams_only",complete:false}).then(()=>({ok:true,source_id:id,fetched:0,new:0,complete:false,category_only:true}));
  }
  const primary=connectors.find(c=>!c.shadow_only)||connectors[0];
  if(primary?.config?.adapter==="source-worker/scout-schleswig-holstein")return runScoutSchleswigHolstein(s);
  if(id===1)return runScout(s);
  if(id===37&&primary?.config?.adapter==="source-worker/finken-public")return runPublicInventory(s,primary);
  if(isImmomioSearchSource(id)||primary?.connector_kind==="immomio_tenant")return runImmomio(s,primary,connectors.filter(c=>c!==primary));
  if(id===3)return runGeneric(s,connectors);
  throw new Error("search adapter not allowed for retained source");
}
async function processSource(id:number){
  if(!isAllowedSearchSource(id))throw new Error("search source retired");
  const {data:source,error}=await db.from("sources").select("*,source_connectors(priority,label,connector_kind,enumerable,shadow_only,config,enabled,warmed_at)").eq("id",id).eq("enabled",true).eq("runtime_mode","live").single();
  if(error||!source)throw new Error(error?.message||"source unavailable");
  const s=source as Source;
  const connectors=(source.source_connectors||[]).filter((c:any)=>c.enabled).sort((a:any,b:any)=>a.priority-b.priority) as Connector[];
  const base=await processBaseSource(s,connectors);
  const category_streams=await runCategoryStreams(s).catch(error=>[{ok:false,error:error instanceof Error?error.message:String(error)}]);
  return {...base,category_streams};
}
async function one(job:any){
 return runClaimedJob(job,processSource,async(args)=>{
  const {data,error}=await db.rpc("finish_source_job_attempt",args);
  if(error)throw new Error("finish_source_job_attempt: "+error.message);
  return data===true;
 });
}
Deno.serve(async(req)=>{
 try{
  if(req.method!=="POST")return new Response("method not allowed",{status:405});
  const internal=await internalSecret();
  if((req.headers.get("x-internal-secret")||"")!==internal)return new Response("unauthorized",{status:401});
  if((await req.json().catch(()=>({}))).dry_run){
   const {error}=await db.from("sources").select("id").eq("enabled",true).limit(1);
   if(error)throw error;
   return Response.json({ok:true,dry_run:true});
  }
  const started=Date.now(),results:any[]=[];let claimed=0;
  while(Date.now()-started<50000){
   const {data:jobs,error}=await db.rpc("claim_source_jobs",{p_worker:"source-worker",p_qty:1});
   if(error)throw error;
   if(!jobs?.length)break;
   claimed+=jobs.length;
   const batch=await Promise.allSettled(jobs.map((j:any)=>one(j)));
   for(const item of batch){if(item.status==="fulfilled")results.push(item.value);else throw item.reason;}
   if(jobs.some((job:any)=>[1,69].includes(Number(job.source_id))))break;
  }
  return Response.json({ok:true,architecture:"housing-source-policy-v1",claimed,results});
 }catch(e){return Response.json({ok:false,error:emsg(e)},{status:500});}
});