import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {db,internalSecret,parseHtml,collectJson} from '../source-worker/shared.ts';

Deno.serve(async request=>{
 try {
  if(request.method!=='POST')return new Response('method not allowed',{status:405});
  if((request.headers.get('x-internal-secret')||'')!==await internalSecret())return new Response('unauthorized',{status:401});
  const {data:sources,error}=await db.from('sources').select('id,name,search_url,homepage_url,tier,runtime_mode').or('tier.eq.K3,runtime_mode.eq.shadow');
  if(error)throw error;
  let probes=0;
  // Small bounded parallel batches; probes never write listings or send messages.
  for(let i=0;i<(sources||[]).length;i+=4)await Promise.all(sources!.slice(i,i+4).map(async source=>{
   const {data:connectors,error:ce}=await db.from('source_connectors').select('priority,config').eq('source_id',source.id).order('priority').limit(3);
   if(ce)throw ce;
   for(const connector of connectors||[]){
    const config=connector.config||{};
    const raw=config.url||config.endpoint||config.search_url||source.search_url||source.homepage_url;
    let reachable=false,count=0,status=0,reason='no_http_target';
    try {
     const target=new URL(raw);
     if(!['https:','http:'].includes(target.protocol))throw new Error('unsupported URL');
     const response=await fetch(target,{headers:{'user-agent':'TraumwohnungHamburgBot/ShadowAudit'},signal:AbortSignal.timeout(3000)});
     status=response.status;reachable=response.ok;reason=response.ok?'reachable_unverified_inventory':'http_error';
     if(response.ok){const text=await response.text();const candidates:any[]=[];if((response.headers.get('content-type')||'').includes('json'))collectJson(JSON.parse(text),target.href,candidates);else candidates.push(...parseHtml(text,target.href));count=candidates.length;}
    } catch {reason='transport_or_parse_error';}
    const {error:pe}=await db.rpc('record_source_probe',{p_source_id:source.id,p_priority:connector.priority,p_reachable:reachable,p_count:count,p_details:{http_status:status,outcome:reason,inventory_verified:false}});
    if(pe)throw pe;probes++;
    if(reachable&&count>0)break;
   }
  }));
  return Response.json({ok:true,probes});
 } catch(error){return Response.json({ok:false,error:String(error)},{status:500});}
});
