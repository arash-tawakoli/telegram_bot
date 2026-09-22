import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {db,internalSecret,parseHtml,collectJson} from '../source-worker/shared.ts';
import {runImmomioObjectShadow} from './immomio-object-shadow.mjs';

Deno.serve(async request=>{
 try {
  if(request.method!=='POST')return new Response('method not allowed',{status:405});
  if((request.headers.get('x-internal-secret')||'')!==await internalSecret())return new Response('unauthorized',{status:401});
  const body=await request.json().catch(()=>({}));
  const immomio_object_shadow=body.resolver_disabled===true?{disabled:true}:await runImmomioObjectShadow(db,body);
  if(body.resolver_only===true)return Response.json({ok:true,immomio_object_shadow});
  const ids=Array.isArray(body.source_ids)?[...new Set(body.source_ids.filter((id:any)=>Number.isInteger(id)&&id>=1&&id<=65))].slice(0,10):[];
  let sourceQuery=db.from('sources').select('id,name,search_url,homepage_url,tier,runtime_mode');
  sourceQuery=ids.length?sourceQuery.in('id',ids):sourceQuery.or('tier.eq.K3,runtime_mode.eq.shadow');
  const {data:sources,error}=await sourceQuery;
  if(error)throw error;
  let probes=0;const results:any[]=[];
  // Small bounded parallel batches; probes never write listings or send messages.
  for(let i=0;i<(sources||[]).length;i+=4)await Promise.all(sources!.slice(i,i+4).map(async source=>{
   const {data:connectors,error:ce}=await db.from('source_connectors').select('priority,config,enabled').eq('source_id',source.id).eq('enabled',true).order('priority').limit(3);
   if(ce)throw ce;
   const probedTargets=new Set<string>();
   for(const connector of connectors||[]){
    const config=connector.config||{};
    const raw=config.url||config.endpoint||config.search_url||config.path||source.search_url||source.homepage_url;
    const started=Date.now();let shape:any={};
    let reachable=false,count=0,status=0,reason='no_http_target';
    try {
     const target=new URL(raw,source.homepage_url);
     const targetKey=target.href.replace(/#.*$/,'');
     if(probedTargets.has(targetKey))continue;
     probedTargets.add(targetKey);
     if(!['https:','http:'].includes(target.protocol))throw new Error('unsupported URL');
     const response=await fetch(target,{headers:{'user-agent':'TraumwohnungHamburgBot/ShadowAudit','accept':'application/json,text/html,*/*'},signal:AbortSignal.timeout(ids.length?8000:3000)});
     status=response.status;reachable=response.ok;reason=response.ok?'reachable_unverified_inventory':'http_error';
     if(response.ok){const bytes=new Uint8Array(await response.arrayBuffer());let text=new TextDecoder().decode(bytes);if((response.headers.get('content-type')||'').includes('json')&&!/^[\s]*[\[{]/.test(text)){const format=bytes[0]===0x78?'deflate':'deflate-raw';text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format))).text();}const candidates:any[]=[];shape={bytes:text.length,content_type:response.headers.get('content-type')};if((response.headers.get('content-type')||'').includes('json')){const json=JSON.parse(text);shape.root_keys=Array.isArray(json)?['array']:Object.keys(json||{}).slice(0,20);shape.reported_total=json?.total??json?.totalCount??null;shape.html_results_bytes=typeof json?.results==='string'?json.results.length:null;collectJson(json,target.href,candidates)}else candidates.push(...parseHtml(text,target.href));count=candidates.length;const lower=text.toLowerCase(),homepageInventory=lower.includes('homepage.immomio.com'),tenantRegistration=lower.includes('tenant.immomio.com/de/auth/register/propertylocation'),applyLinks=(text.match(/https:\/\/tenant\.immomio\.com\/(?:de\/)?apply\/[0-9a-f-]{36}/gi)||[]).length,redirectLinks=(text.match(/https:\/\/rdr\.immomio\.com\/[A-Za-z0-9_-]{3,128}/g)||[]).length;shape.immomio_homepage_inventory=homepageInventory;shape.immomio_apply_links=applyLinks;shape.immomio_redirect_links=redirectLinks;shape.immomio_registration_only=tenantRegistration&&!homepageInventory&&!applyLinks&&!redirectLinks;if(source.id===60&&target.hostname==='buchdrucker.immomio.de'&&target.pathname.startsWith('/immobilien')){const isFeed=/\/feed\/?$/.test(target.pathname),feedItems=(text.match(/<item\b/gi)||[]).length,verifiedEmpty=isFeed?/<channel\b/i.test(text)&&feedItems===0:/\b0\s+Treffer anzeigen\b/i.test(text);shape.feed_items=feedItems;shape.verified_empty=verifiedEmpty;if(verifiedEmpty){reason='verified_empty_inventory';shape.inventory_verified=true}else if(count>0||feedItems>0)reason='public_inventory_detected';}}
    } catch(error) {reason='transport_or_parse_error';shape.error=String(error).slice(0,160);}
    const details={http_status:status,outcome:reason,inventory_verified:false,duration_ms:Date.now()-started,...shape};
    const {error:pe}=await db.rpc('record_source_probe',{p_source_id:source.id,p_priority:connector.priority,p_reachable:reachable,p_count:count,p_details:details});
    if(pe)throw pe;probes++;
    results.push({source_id:source.id,priority:connector.priority,candidates:count,...details});
    if(!ids.length&&reachable&&count>0)break;
   }
  }));
  return Response.json({ok:true,probes,results,immomio_object_shadow});
 } catch(error){return Response.json({ok:false,error:String(error)},{status:500});}
});
