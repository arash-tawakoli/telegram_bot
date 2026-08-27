import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession:false, autoRefreshToken:false } });

async function secret(name:string){
  const {data,error}=await db.rpc("get_bot_secret",{secret_name:name});
  if(error||!data) throw new Error(`secret ${name} unavailable`);
  return String(data);
}

Deno.serve(async(req:Request)=>{
  try{
    if(req.method!=="POST") return new Response("method not allowed",{status:405});
    const supplied=req.headers.get("x-internal-secret")||"";
    const internal=await secret("internal_worker_secret");
    if(!supplied||supplied!==internal) return new Response("unauthorized",{status:401});

    const {data:jobs,error}=await db.rpc("claim_source_jobs",{p_worker:"source-job-runner",p_qty:4});
    if(error) throw new Error(`claim_source_jobs: ${error.message}`);

    const results=await Promise.all((jobs||[]).map(async(job:any)=>{
      const slug=String(job.worker_slug||"");
      const sourceId=Number(job.source_id);
      let ok=false; let status=0; let detail="";
      try{
        if(!/^source-[a-z0-9-]+$/.test(slug)) throw new Error("invalid worker slug");
        const res=await fetch(`${SUPABASE_URL}/functions/v1/${slug}`,{
          method:"POST",
          headers:{"content-type":"application/json","x-internal-secret":internal},
          body:JSON.stringify({source_id:sourceId}),
          signal:AbortSignal.timeout(35000),
        });
        status=res.status;
        detail=(await res.text()).slice(0,1200);
        let explicitOk: boolean | null = null;
        try {
          const parsed=JSON.parse(detail);
          if(typeof parsed?.ok==="boolean") explicitOk=parsed.ok;
          if(typeof parsed?.valid==="number" && typeof parsed?.upserted==="number" && parsed.upserted < parsed.valid) explicitOk=false;
        } catch {}
        ok=res.ok && explicitOk!==false;
      }catch(e){ detail=e instanceof Error?e.message:String(e); }

      const {error:finishError}=await db.rpc("finish_source_job",{p_job_id:job.job_id,p_success:ok,p_error:ok?null:`HTTP ${status||0}: ${detail}`});
      if(finishError) return {job_id:job.job_id,source_id:sourceId,worker:slug,ok:false,status,error:`finish: ${finishError.message}`};
      return {job_id:job.job_id,source_id:sourceId,worker:slug,ok,status,detail:detail.slice(0,300)};
    }));

    return Response.json({ok:true,claimed:(jobs||[]).length,results});
  }catch(e){
    return Response.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:500});
  }
});
