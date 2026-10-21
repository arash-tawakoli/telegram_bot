import {persistCategoryListings} from './category-persist.ts';
import {coverageTimestampProof} from './coverage-newness.ts';
import {Candidate,Source,db,deNum,iso,markFailure,markSuccess,upsertCandidates,UA} from './shared.ts';
const MCP='https://app.chatgpt.immobilienscout24.de/v2/mcp',PROTO='2025-06-18';
const BOROUGHS=['Hamburg-Mitte','Altona','Eimsbüttel','Hamburg-Nord','Wandsbek','Bergedorf','Harburg'];
const TARGET_NEIGHBORHOODS=[
  {name:'Hamburg-Altstadt',borough:'Hamburg-Mitte'},
  {name:'Neuwerk',borough:'Hamburg-Mitte'},
  {name:'Steinwerder',borough:'Hamburg-Mitte'},
  {name:'Neuallermöhe',borough:'Bergedorf'},
  {name:'Tatenberg',borough:'Bergedorf'},
  {name:'Altenwerder',borough:'Harburg'},
  {name:'Gut Moor',borough:'Harburg'},
];
type CooperativeRegistryRow={provider_entity:string;source_id:number|null;registry_mode:string;needles:string[]};
let cooperativeRegistry:CooperativeRegistryRow[]=[];
let cooperativeRegistryLoadedAt=0;
function normalizeProviderText(value:string){return String(value||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("de-DE").replace(/[^a-z0-9äöüß]+/g," ").replace(/\s+/g," ").trim()}
async function loadCooperativeRegistry(){
  if(cooperativeRegistry.length&&Date.now()-cooperativeRegistryLoadedAt<5*60*1000)return;
  const {data,error}=await db.from("cooperative_provider_registry").select("provider_entity,source_id,registry_mode,aliases").eq("active",true);
  if(error)return;
  cooperativeRegistry=(data||[]).map((r:any)=>({provider_entity:String(r.provider_entity),source_id:r.source_id==null?null:Number(r.source_id),registry_mode:String(r.registry_mode||"passive"),needles:Array.isArray(r.aliases)?r.aliases.map((x:any)=>normalizeProviderText(String(x))).filter((x:string)=>x.length>=5):[]}));
  cooperativeRegistryLoadedAt=Date.now();
}
function registryCooperativeIdentity(value:string){
  if(!/(?:genossenschaft|bauverein|saga|gewoba|harabau|altoba|fluwog|markthof)/i.test(value))return null;
  const hay=normalizeProviderText(value);
  for(const row of cooperativeRegistry)for(const needle of row.needles)if(hay.includes(needle))return row;
  return null;
}
async function post(payload:any){const r=await fetch(MCP,{method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream','mcp-protocol-version':PROTO,'user-agent':UA},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)}),b=await r.text();if(!r.ok)throw new Error(`MCP HTTP ${r.status}`);let j:any=null;if(b.trim().startsWith('{'))j=JSON.parse(b);else for(const line of b.split(/\r?\n/))if(line.startsWith('data:'))try{j=JSON.parse(line.slice(5).trim())}catch{}if(j?.error)throw new Error(j.error.message||'MCP error');return j}
async function init(){await post({jsonrpc:'2.0',id:crypto.randomUUID(),method:'initialize',params:{protocolVersion:PROTO,capabilities:{},clientInfo:{name:'traumwohnung-hamburg',version:'13.0.0'}}});await post({jsonrpc:'2.0',method:'notifications/initialized'})}
async function tool(name:string,query:string){const j=await post({jsonrpc:'2.0',id:crypto.randomUUID(),method:'tools/call',params:{name,arguments:{query}}});if(j?.result?.isError){const msg=Array.isArray(j.result.content)?j.result.content.map((x:any)=>x?.text).filter(Boolean).join(' | '):'';throw new Error(msg||'MCP tool error')}const s=j?.result?.structuredContent||j?.result?.structured_content||{};return{entries:Array.isArray(s.entries)?s.entries:[],total:deNum(s.total)}}
const search=(query:string)=>tool('property_search_de',query);
const mapSearch=(query:string)=>tool('property_map_de',query);
function entryId(e:any){return String(e?.exposedId||e?.exposeId||e?.id||'')}
async function enrichedSearch(query:string){const [r,m]=await Promise.all([search(query),mapSearch(query).then(x=>({ok:true,...x})).catch(e=>({ok:false,entries:[] as any[],total:null,error:e instanceof Error?e.message:String(e)}))]);const byId=new Map<string,any>();for(const e of m.entries||[]){const id=entryId(e);if(id)byId.set(id,e)}let enriched=0;const entries=r.entries.map((e:any)=>{const x=byId.get(entryId(e));if(!x)return e;const patch:any={};for(const k of ['totalRent','serviceCharge','heatingCosts','heatingCostsInServiceCharge'])if(x[k]!=null)patch[k]=x[k];if(Object.keys(patch).length)enriched++;return{...e,...patch}});return{...r,entries,map_entries:m.entries||[],map_ok:m.ok,map_returned:(m.entries||[]).length,map_enriched:enriched,map_error:m.ok?null:m.error||'map error'}}
function query(x:any){const a=['Wohnung zur Miete',`in ${x.neighborhood||x.borough}, Hamburg`];if(x.min!=null&&x.max!=null)a.push(`zwischen ${Math.round(x.min)} und ${Math.round(x.max)} Euro monatlich`);else if(x.max!=null)a.push(`maximal ${Math.round(x.max)} Euro monatlich`);else if(x.min!=null)a.push(`ab ${Math.round(x.min)} Euro monatlich`);return a.join(', ')}
function children(x:any){const lo=x.min==null?null:Number(x.min),hi=x.max==null?null:Number(x.max),d=Number(x.depth||0)+1;if(lo==null&&hi==null)return [[null,750],[750,1000],[1000,1250],[1250,1500],[1500,2000],[2000,3000],[3000,5000],[5000,null]].map(([min,max])=>({...x,min,max,depth:d}));if(lo==null&&hi!=null&&hi>50){const m=Math.round(hi/2);return[{...x,min:null,max:m,depth:d},{...x,min:m,max:hi,depth:d}]}if(lo!=null&&hi==null){const m=lo+2500;return[{...x,min:lo,max:m,depth:d},{...x,min:m,max:null,depth:d}]}if(lo!=null&&hi!=null&&hi-lo>25){const m=Math.round((lo+hi)/2);return[{...x,min:lo,max:m,depth:d},{...x,min:m,max:hi,depth:d}]}return[]}
async function recordNeighborhoodSearch(sourceId:number,target:any,result:any,queryText:string){
  const {data:neighborhood,error:lookupError}=await db.from('hamburg_neighborhoods').select('id,name').eq('name',target.neighborhood).maybeSingle();
  if(lookupError)throw lookupError;
  if(!neighborhood)return;
  const reportedTotal=result.total==null?null:Number(result.total);
  const returnedCount=Array.isArray(result.entries)?result.entries.length:0;
  const hasHits=reportedTotal!=null&&reportedTotal>0||returnedCount>0;
  const verifiedEmpty=reportedTotal===0&&returnedCount===0;
  const status=verifiedEmpty?'searched_no_hits':hasHits?'searched_with_hits':'ambiguous';
  const resultCount=reportedTotal!=null&&reportedTotal>0?reportedTotal:returnedCount>0?returnedCount:verifiedEmpty?0:null;
  const evidenceQuality=reportedTotal!=null?'verified':returnedCount>0?'weak':'unknown';
  const {error}=await db.rpc('record_source_neighborhood_coverage',{
    p_source_id:sourceId,p_neighborhood_id:Number(neighborhood.id),p_search_status:status,
    p_result_count:resultCount,p_strategy:'immoscout_mcp_exact_neighborhood_query',
    p_evidence_quality:evidenceQuality,
    p_evidence:{provider:'immoscout_mcp',query:queryText,borough:target.borough,exactNeighborhoodQuery:true,
      reportedTotal:reportedTotal,returnedCount:returnedCount,mapEnrichmentOk:result.map_ok===true},
    p_attempted_at:iso()
  });
  if(error)throw error;
}
function scoutCooperativeIdentity(e:any){
  const text=JSON.stringify(e||{});
  const rules=[
    ["SAGA",/(?:Vermietungshotline der\s+)?SAGA Unternehmensgruppe/i],
    ["Finkenwärder-Hoffnung",/(?:Baugenossenschaft\s+)?Finkenw(?:ä|ae)rder[-\s]+Hoffnung/i],
    ["GEWOBA Nord",/GEWOBA\s+Nord/i],
    ["NEUE LÜBECKER",/NEUE\s+LÜBECKER/i],
    ["Bauverein Reiherstieg",/Bauverein\s+Reiherstieg/i],
    ["VHW",/(?:Vereinigte\s+Hamburger\s+Wohnungsbaugenossenschaft|\bVHW\b)/i],
    ["mgf Gartenstadt Farmsen",/(?:mgf\s+)?Gartenstadt\s+Farmsen/i],
    ["HARABAU",/(?:Hamburg[-\s]+Rahlstedter\s+Baugenossenschaft|\bHARABAU\b)/i],
    ["Baugenossenschaft der Buchdrucker",/Baugenossenschaft\s+der\s+Buchdrucker/i],
    ["FLUWOG-NORDMARK",/(?:Baugenossenschaft\s+)?FLUWOG[-\s]*NORDMARK/i],
    ["Gartenstadt Hamburg",/(?:Wohnungsgenossenschaft\s+)?Gartenstadt\s+Hamburg/i],
    ["WG von 1904",/(?:Wohnungsgenossenschaft\s+von\s+1904|\bWG\s+von\s+1904\b)/i],
    ["WHW 1897",/(?:Wohnungsgenossenschaft\s+Hamburg[-\s]*Wandsbek\s+von\s+1897|\bWHW\s*1897\b)/i],
    ["ADLERSHORST",/ADLERSHORST\s+Baugenossenschaft/i],
    ["Wohnwarft eG",/Wohnwarft(?:\s+eG)?/i],
    ["Falkenried-Terrassen",/(?:Baugenossenschaft\s+)?Falkenried[-\s]+Terrassen/i],
  ] as const;
  for(const [entity,re] of rules){
    if(!re.test(text))continue;
    const ref=text.match(/(?:Objektreferenz|Referenznummer|Objektnummer|Objekt[-\s]?(?:Nr\.?|ID)|Angebotsnummer)[^A-Za-z0-9]{0,12}([A-Za-z0-9][A-Za-z0-9._/-]{3,80})/i)?.[1]
      || (entity==="SAGA"?text.match(/\b(MO\s*2000\s*\/\s*[A-Za-z0-9.-]+\s*\/\s*[A-Za-z0-9.-]+)\b/i)?.[1]:null)
      || null;
    const row=cooperativeRegistry.find(r=>r.provider_entity===entity);
    return {provider_entity:entity,provider_object_ref:ref?ref.toUpperCase().replace(/\s*\/\s*/g,"/").replace(/\s+/g," ").trim():null,provider_registry_mode:row?.registry_mode||"source",provider_source_id:row?.source_id??null};
  }
  const dynamicRow=registryCooperativeIdentity(text);
  if(dynamicRow){
    const ref=e?.providerObjectRef||e?.objectReference||e?.referenceNumber||e?.externalReference||e?.objectNumber||e?.reference||null;
    return {provider_entity:dynamicRow.provider_entity,provider_object_ref:ref?String(ref).toUpperCase().trim():null,provider_registry_mode:dynamicRow.registry_mode,provider_source_id:dynamicRow.source_id};
  }
  const candidate=/\b(?:Baugenossenschaft|Wohnungsgenossenschaft|Wohnungsbaugenossenschaft|Wohngenossenschaft|Mietergenossenschaft|Bauverein)\b/i.test(text);
  return {provider_entity:null,provider_object_ref:null,provider_registry_mode:null,provider_source_id:null,cooperative_candidate:candidate,cooperative_candidate_text:candidate?text.slice(0,1200):null};
}
function candidates(entries:any[],q:string):Candidate[]{return entries.map(e=>{const id=entryId(e),a=e.address||{},cooperative=scoutCooperativeIdentity(e);return{key:id,url:e.exposeUrl||`https://www.immobilienscout24.de/expose/${id}`,title:e.title||`ImmobilienScout24 ${id}`,address:[a.street,a.houseNumber].filter(Boolean).join(' ')||null,district:a.quarter||null,zip:a.postcode||null,warm:deNum(e.totalRent),cold:deNum(e.price?.value),additional:deNum(e.serviceCharge),heating:deNum(e.heatingCosts),rooms:deNum(e.rooms),area:deNum(e.size),image:Array.isArray(e.titlePictureUrls)?e.titlePictureUrls[0]?.href?.replace(/%WIDTH%/g,'1200').replace(/%HEIGHT%/g,'800'):null,raw:{provider:'immoscout_mcp',query:q,entry:e,...(cooperative.provider_entity?{provider_entity:cooperative.provider_entity}:{}),...(cooperative.provider_object_ref?{provider_object_ref:cooperative.provider_object_ref}:{}),...(cooperative.provider_entity==="SAGA"&&cooperative.provider_object_ref?{saga_object_ref:cooperative.provider_object_ref}:{}),...(cooperative.provider_entity&&(!cooperative.provider_object_ref)?{portal_enrichment_pending:true}:{}),...(cooperative.provider_registry_mode?{provider_registry_mode:cooperative.provider_registry_mode}:{}),...(cooperative.provider_source_id!=null?{provider_source_id:cooperative.provider_source_id}:{}),...(cooperative.cooperative_candidate?{cooperative_candidate:true,cooperative_candidate_text:cooperative.cooperative_candidate_text}:{})}}})}
function propagateDetails(items:Candidate[]){const known=new Map<string,{warm:number|null;additional:number|null;heating:number|null}>();for(const c of items){const k=String(c.key||'');if(!k)continue;const p=known.get(k)||{warm:null,additional:null,heating:null};known.set(k,{warm:c.warm??p.warm,additional:c.additional??p.additional,heating:c.heating??p.heating})}return items.map(c=>{const p=known.get(String(c.key||''));return p?{...c,warm:c.warm??p.warm,additional:c.additional??p.additional,heating:c.heating??p.heating}:c})}
async function preserveKnown(sourceId:number,items:Candidate[]){const keys=[...new Set(items.map(c=>String(c.key||'')).filter(Boolean))],known=new Map<string,any>();for(let i=0;i<keys.length;i+=300){const{data,error}=await db.from('listings').select('source_listing_key,warm_rent,additional_costs,heating_costs').eq('source_id',sourceId).in('source_listing_key',keys.slice(i,i+300)).throwOnError();if(error)throw error;for(const x of data||[])known.set(String(x.source_listing_key),x)}return items.map(c=>{const x=known.get(String(c.key||''));return x?{...c,warm:c.warm??deNum(x.warm_rent),additional:c.additional??deNum(x.additional_costs),heating:c.heating??deNum(x.heating_costs)}:c})}
export async function runScout(source:Source){const started=iso();try{await loadCooperativeRegistry();await init();let{data:st}=await db.from('source_coverage_state').select('*').eq('source_id',source.id).maybeSingle().throwOnError();let cycle=st?.status==='running'?String(st.cycle_id):crypto.randomUUID(),cursor:any=st?.status==='running'?(st.cursor||{}):{};if(st?.status!=='running'){cursor={queue:[...TARGET_NEIGHBORHOODS.map(target=>({borough:target.borough,neighborhood:target.name,min:null,max:null,depth:0,coverage_target:true})),...BOROUGHS.map(b=>({borough:b,min:null,max:null,depth:0}))],processed:0,fresh_borough_index:Number(st?.cursor?.fresh_borough_index||0),map_seen_ids:Array.isArray(st?.cursor?.map_seen_ids)?st.cursor.map_seen_ids:[]};await db.from('source_coverage_state').upsert({source_id:source.id,cycle_id:cycle,strategy:'adaptive_partition',status:'running',cursor,cycle_started_at:started,seen_count:0,request_count:0,updated_at:started}).throwOnError()}
 const recovery=!source.last_success_at||Date.now()-new Date(source.last_success_at).getTime()>10*60*1000,fq='Wohnungen zur Miete in Hamburg, neueste Inserate',fresh=await enrichedSearch(fq),freshBoroughIndex=Number(cursor.fresh_borough_index||0)%BOROUGHS.length,bCount=recovery?6:2,bNames=Array.from({length:bCount},(_,i)=>BOROUGHS[(freshBoroughIndex+i)%BOROUGHS.length]),bResults=await Promise.all(bNames.map(async b=>{const q=`Wohnungen zur Miete in ${b}, Hamburg, neueste Inserate`;return{b,q,r:await enrichedSearch(q)}})),extraMapNames=BOROUGHS.filter(b=>!bNames.includes(b)),extraMaps=await Promise.all(extraMapNames.map(async b=>{const q=`Wohnungen zur Miete in ${b}, Hamburg, neueste Inserate`;try{return{b,q,r:{ok:true,...await mapSearch(q)}}}catch(e){return{b,q,r:{ok:false,entries:[] as any[],total:null,error:e instanceof Error?e.message:String(e)}}}}));let freshItems=[...candidates(fresh.entries,fq).map(c=>({...c,raw:{...c.raw,delivery_lane:'fresh_global'}})),...bResults.flatMap(x=>candidates(x.r.entries,x.q).map(c=>({...c,raw:{...c.raw,delivery_lane:'fresh_borough',fresh_borough:x.b}})))],coverageItems:Candidate[]=[],mapEntries:any[]=[...(fresh.map_entries||[]),...bResults.flatMap(x=>x.r.map_entries||[]),...extraMaps.flatMap(x=>x.r.entries||[])],requests=4+bResults.length*2+extraMaps.length,mapEnriched=Number(fresh.map_enriched||0)+bResults.reduce((n,x)=>n+Number(x.r.map_enriched||0),0),mapErrors=(fresh.map_ok?0:1)+bResults.filter(x=>!x.r.map_ok).length+extraMaps.filter(x=>!x.r.ok).length,queue:any[]=Array.isArray(cursor.queue)?cursor.queue:[],processed=0,saturated=0;const work=queue.splice(0,recovery?0:1);for(let i=0;i<work.length;i+=3){const rs=await Promise.all(work.slice(i,i+3).map(async x=>{const q=query(x),r=await enrichedSearch(q);return{x,q,r}}));requests+=rs.length*2;for(const z of rs){coverageItems.push(...candidates(z.r.entries,z.q).map(c=>({...c,raw:{...c.raw,delivery_lane:'coverage'}})));mapEntries.push(...(z.r.map_entries||[]));mapEnriched+=Number(z.r.map_enriched||0);if(!z.r.map_ok)mapErrors++;processed++;if(z.x.neighborhood&&z.x.min==null&&z.x.max==null)await recordNeighborhoodSearch(source.id,z.x,z.r,z.q);const sat=(z.r.total!=null&&Number(z.r.total)>z.r.entries.length)||z.r.entries.length>=25;if(!sat)continue;const kids=children(z.x);if(kids.length){queue.push(...kids);continue}if(!z.x.neighborhood){const{data:ns}=await db.from('hamburg_neighborhoods').select('name,hamburg_boroughs!inner(name)').eq('hamburg_boroughs.name',z.x.borough).throwOnError();if(ns?.length){queue.push(...ns.map((n:any)=>({...z.x,neighborhood:n.name,depth:Number(z.x.depth||0)+1})));continue}}saturated++}}
 const freshLen=freshItems.length,searchItems=[...freshItems,...coverageItems],mapUnique=[...new Map(mapEntries.map((e:any)=>[entryId(e),e]).filter(([id])=>!!id)).values()],mapItems=candidates(mapUnique,'map_fact_cache'),allCombined=await preserveKnown(source.id,propagateDetails([...searchItems,...mapItems])),combined=allCombined.slice(0,searchItems.length),mapCombined=allCombined.slice(searchItems.length);freshItems=combined.slice(0,freshLen);const freshKeys=new Set(freshItems.map(c=>String(c.key||'')));coverageItems=combined.slice(freshLen).filter(c=>!freshKeys.has(String(c.key||'')));const prevSeenIds=Array.isArray(cursor.map_seen_ids)?cursor.map_seen_ids.map(String):[],prevSeen=new Set(prevSeenIds),snapshotSeeded=prevSeenIds.length>0,currentMapIds=mapCombined.map(c=>String(c.key||'')).filter(Boolean),mapDeltaKeys=new Set(snapshotSeeded?currentMapIds.filter(id=>!prevSeen.has(id)):[]),snapshotAt=iso(),mapDelta=mapCombined.filter(c=>mapDeltaKeys.has(String(c.key||''))&&!freshKeys.has(String(c.key||''))).map(c=>({...c,raw:{...c.raw,delivery_lane:'map_delta',_newness:{method:'map_snapshot_delta',observed_at:snapshotAt}}})),mapDeltaKeySet=new Set(mapDelta.map(c=>String(c.key||'')));const provenCoverage=coverageItems.map(c=>{const proof=coverageTimestampProof(c.raw?.entry);return proof?{...c,raw:{...c.raw,delivery_lane:'coverage_proven',_newness:proof}}:null}).filter((c):c is Candidate=>c!==null),provenKeys=new Set(provenCoverage.map(c=>String(c.key))),unverifiedCoverage=coverageItems.filter(c=>!provenKeys.has(String(c.key))&&!mapDeltaKeySet.has(String(c.key))),freshSaved=await upsertCandidates(source,freshItems,true),promotedSaved=await upsertCandidates(source,provenCoverage,true),mapDeltaSaved=await upsertCandidates(source,mapDelta,true),coverageSaved=await upsertCandidates(source,unverifiedCoverage,false),complete=queue.length===0,t=iso(),seen=freshSaved.seen+promotedSaved.seen+mapDeltaSaved.seen+coverageSaved.seen,inserted=freshSaved.fresh+promotedSaved.fresh+mapDeltaSaved.fresh+coverageSaved.fresh,nextFreshIndex=(freshBoroughIndex+bCount)%BOROUGHS.length,mapSeenIds=[...new Set([...prevSeenIds,...currentMapIds])].slice(-10000);await db.from('source_coverage_state').update({status:complete?'complete':'running',cursor:{queue,processed:Number(cursor.processed||0)+processed,fresh_borough_index:nextFreshIndex,map_seen_ids:mapSeenIds},seen_count:Number(st?.seen_count||0)+seen,request_count:Number(st?.request_count||0)+requests,cycle_finished_at:complete?t:null,last_complete_at:complete?t:st?.last_complete_at||null,updated_at:t,last_error:saturated?`${saturated} saturated leaves`:null}).eq('source_id',source.id).throwOnError();await markSuccess(source,started,null,freshItems.length+coverageItems.length,inserted,{strategy:'fresh_first_7_borough_adaptive_price_mcp',cycle_id:cycle,requests,session_requests:2,coverage_partition_budget:1,coverage_partitions:work.length,map_enriched:mapEnriched,map_fact_entries:mapUnique.length,map_errors:mapErrors,remaining:queue.length,saturated,recovery,fresh_lane_items:freshItems.length,fresh_boroughs:bNames,coverage_items:coverageItems.length,coverage_promoted:promotedSaved.seen,map_delta_items:mapDeltaSaved.seen,map_snapshot_seeded:snapshotSeeded,coverage_delivery_eligible:promotedSaved.seen>0||mapDeltaSaved.seen>0,complete:false});return{ok:true,source_id:1,fetched:freshItems.length+coverageItems.length,new:inserted,map_enriched:mapEnriched,map_fact_entries:mapUnique.length,map_errors:mapErrors,remaining:queue.length,cycle_complete:complete,recovery}}catch(e){return markFailure(source,started,e)}}



function scoutPublishedAt(entry:any){
  const values=[entry?.publishedAt,entry?.publishDate,entry?.creationDate,entry?.createdAt,entry?.firstPublishedAt,entry?.listingDate];
  for(const value of values){
    if(!value)continue;
    const d=new Date(value);
    if(Number.isFinite(d.getTime()))return d.toISOString();
  }
  return null;
}
export async function runScoutCategory(source:Source,stream:any){if(stream?.category!=='house')throw new Error('unsupported Scout category stream');await loadCooperativeRegistry();await init();const q='Häuser zur Miete in Hamburg, neueste Inserate',r=await enrichedSearch(q),rows:Candidate[]=[];for(const c of candidates(r.entries,q)){const published=scoutPublishedAt(c.raw?.entry);rows.push({...c,raw:{...c.raw,...(published?{_newness:{method:'source_timestamp',source_published_at:published}}:{})}})}const saved=await persistCategoryListings(source,stream,rows,false);return{requests:4,candidates:saved.seen,fresh:saved.fresh,cursor:{query:q,returned:r.entries.length,total:r.total,map_ok:r.map_ok,map_returned:r.map_returned,last_checked_at:iso()}}}
