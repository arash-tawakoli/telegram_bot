import {
  normalizeImmomioApply,
  extractImmomioApplyUrlsFromText,
  collectImmomioApplyUrls,
  extractImmomioRedirectUrlsFromText,
} from './immomio-object-resolver.mjs';

const clamp=(value,min,max,fallback)=>{const n=Number(value);return Number.isFinite(n)?Math.min(max,Math.max(min,Math.trunc(n))):fallback};
const plusHours=(hours)=>new Date(Date.now()+hours*3600000).toISOString();
const safeError=(error)=>String(error instanceof Error?error.message:error).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,300);
function hostFrom(value){try{const u=new URL(String(value||''));return u.protocol==='https:'?u.hostname.toLowerCase():null}catch{return null}}
function configuredHosts(source){
  const out=new Set();
  for(const value of [source.homepage_url,source.search_url]){const h=hostFrom(value);if(h)out.add(h)}
  for(const connector of source.source_connectors||[]){
    if(connector?.enabled===false)continue;
    const config=connector?.config||{};
    for(const key of ['url','endpoint','search_url','path','module_url','tenant_registration_url']){const h=hostFrom(config[key]);if(h)out.add(h)}
  }
  return out;
}
function publicListingTarget(value,source){
  try{
    const u=new URL(String(value||''));
    if(u.protocol!=='https:'||u.username||u.password||u.port||u.href.length>4096)return null;
    const host=u.hostname.toLowerCase();
    if(host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)||host.includes(':'))return null;
    const configured=configuredHosts(source);
    const known=host==='tenant.immomio.com'||host.endsWith('.immomio.de')||host.endsWith('.immosolve.eu')||host==='immobilienscout24.de'||host.endsWith('.immobilienscout24.de');
    const configuredMatch=[...configured].some(h=>host===h||host.endsWith('.'+h)||h.endsWith('.'+host));
    return known||configuredMatch?u.href:null;
  }catch{return null}
}
function knownFieldHits(listing){
  const raw=listing?.raw||{},out=new Map();
  for(const value of [raw.applicationLink,raw.application_link,raw.applicationUrl,raw.application_url,raw.tenant_apply_url,listing?.canonical_url]){
    const hit=normalizeImmomioApply(value);if(hit)out.set(hit.sourceIdentifier,hit);
  }
  return [...out.values()];
}
function resolutionRow(listing,status,method,hit,evidenceUrl,evidence,error=null,nextHours=6){
  return {
    listing_id:listing.id,
    source_id:listing.source_id,
    status,
    source_identifier:status==='resolved'?hit.sourceIdentifier:null,
    apply_url:status==='resolved'?hit.url:null,
    method,
    evidence_url:evidenceUrl||null,
    checked_at:new Date().toISOString(),
    next_check_at:plusHours(nextHours),
    error:error||null,
    evidence:evidence||{},
  };
}
async function resolveTrustedRedirects(urls){
  const hits=new Map(),attempts=[];
  for(const url of urls.slice(0,4)){
    const started=Date.now();
    try{
      const response=await fetch(url,{method:'GET',redirect:'follow',headers:{'user-agent':'TraumwohnungHamburgBot/ImmomioObjectShadow','accept':'text/html,*/*'},signal:AbortSignal.timeout(3500)});
      const hit=normalizeImmomioApply(response.url||'');
      attempts.push({status:response.status,duration_ms:Date.now()-started,resolved:!!hit});
      if(hit)hits.set(hit.sourceIdentifier,hit);
    }catch(error){attempts.push({duration_ms:Date.now()-started,error:safeError(error)})}
  }
  return {hits:[...hits.values()],attempts};
}
async function resolveListingShadow(listing,source,allowFetch){
  const known=knownFieldHits(listing),deep=collectImmomioApplyUrls(listing?.raw||{}),all=new Map();
  for(const hit of [...known,...deep])all.set(hit.sourceIdentifier,hit);
  if(all.size>1)return resolutionRow(listing,'conflict','embedded_conflict',null,listing.canonical_url,{network:false,known_hits:known.length,embedded_hits:deep.length,unique_object_ids:all.size},null,24);
  if(all.size===1){
    const hit=[...all.values()][0],method=known.length?'existing_target':'embedded_source_payload';
    return resolutionRow(listing,'resolved',method,hit,listing.canonical_url,{network:false,known_hits:known.length,embedded_hits:deep.length},null,method==='existing_target'?168:24);
  }
  if(!allowFetch)return null;
  const embeddedRedirects=extractImmomioRedirectUrlsFromText(JSON.stringify(listing?.raw||{}));
  if(embeddedRedirects.length){
    const resolved=await resolveTrustedRedirects(embeddedRedirects);
    if(resolved.hits.length>1)return resolutionRow(listing,'conflict','embedded_redirect_conflict',null,listing.canonical_url,{network:true,redirects:embeddedRedirects.length,attempts:resolved.attempts},null,24);
    if(resolved.hits.length===1)return resolutionRow(listing,'resolved','embedded_immomio_redirect',resolved.hits[0],embeddedRedirects[0],{network:true,redirects:embeddedRedirects.length,attempts:resolved.attempts},null,24);
  }
  const target=publicListingTarget(listing.canonical_url,source);
  if(!target)return resolutionRow(listing,'skipped','canonical_not_fetchable',null,listing.canonical_url,{network:false},null,24);
  const started=Date.now();
  try{
    const response=await fetch(target,{redirect:'follow',headers:{'user-agent':'TraumwohnungHamburgBot/ImmomioObjectShadow','accept':'text/html,application/xhtml+xml,application/json,*/*','accept-language':'de-DE,de;q=0.9','cache-control':'no-cache'},signal:AbortSignal.timeout(4500)});
    const evidence={network:true,http_status:response.status,content_type:response.headers.get('content-type')||null,duration_ms:Date.now()-started};
    if(!response.ok){
      const retry=response.status===429||response.status>=500;
      return resolutionRow(listing,retry?'error':'missing',retry?'detail_http_error':'detail_unavailable',null,response.url||target,evidence,retry?`HTTP ${response.status}`:null,retry?1:12);
    }
    const length=Number(response.headers.get('content-length')||0);
    if(length>2500000)return resolutionRow(listing,'skipped','detail_too_large',null,response.url||target,{...evidence,content_length:length},null,24);
    const text=await response.text(),hits=extractImmomioApplyUrlsFromText(text,response.url||target),ev={...evidence,bytes:text.length,unique_object_ids:hits.length};
    if(hits.length>1)return resolutionRow(listing,'conflict','detail_conflict',null,response.url||target,ev,null,24);
    if(hits.length===1){
      const redirected=!!normalizeImmomioApply(response.url||'');
      return resolutionRow(listing,'resolved',redirected?'detail_redirect':'detail_page',hits[0],response.url||target,ev,null,24);
    }
    const redirects=extractImmomioRedirectUrlsFromText(text);
    if(redirects.length){
      const resolved=await resolveTrustedRedirects(redirects);
      const redirectEvidence={...ev,redirects:redirects.length,redirect_attempts:resolved.attempts};
      if(resolved.hits.length>1)return resolutionRow(listing,'conflict','detail_redirect_conflict',null,response.url||target,redirectEvidence,null,24);
      if(resolved.hits.length===1)return resolutionRow(listing,'resolved','detail_immomio_redirect',resolved.hits[0],redirects[0],redirectEvidence,null,24);
    }
    return resolutionRow(listing,'missing','detail_no_target',null,response.url||target,{...ev,redirects:redirects.length},null,6);
  }catch(error){
    return resolutionRow(listing,'error','transport_error',null,target,{network:true,duration_ms:Date.now()-started},safeError(error),1);
  }
}
export async function runImmomioObjectShadow(db,body={}){
  const lookbackHours=clamp(body.resolver_lookback_hours,1,720,24),fetchLimit=clamp(body.resolver_fetch_limit,0,24,8),rowLimit=clamp(body.resolver_row_limit,1,240,120);
  let sourceQuery=db.from('sources').select('id,name,homepage_url,search_url,source_type,enabled,runtime_mode,source_connectors(priority,enabled,config)').eq('source_type','Baugenossenschaft').order('id');
  const requested=Array.isArray(body.resolver_source_ids)?[...new Set(body.resolver_source_ids.map(Number).filter(Number.isInteger))].slice(0,32):[];
  if(requested.length)sourceQuery=sourceQuery.in('id',requested);
  const {data:sources,error:se}=await sourceQuery;if(se)throw se;
  const sourceMap=new Map((sources||[]).map(s=>[Number(s.id),s])),sourceIds=[...sourceMap.keys()];
  if(!sourceIds.length)return {sources:0,eligible:0,checked:0,network_fetches:0,resolved:0,new_shadow_candidates:0,conflict:0,missing:0,error:0,skipped:0};
  const cutoff=new Date(Date.now()-lookbackHours*3600000).toISOString();
  const {data:listings,error:le}=await db.from('listings').select('id,source_id,canonical_url,raw,first_seen_at').in('source_id',sourceIds).eq('is_active',true).eq('is_primary_listing',true).gte('first_seen_at',cutoff).order('first_seen_at',{ascending:false}).limit(rowLimit);
  if(le)throw le;
  const ids=(listings||[]).map(l=>l.id);let prior=[];
  if(ids.length){const q=await db.from('immomio_object_resolution_shadow').select('listing_id,next_check_at,status').in('listing_id',ids);if(q.error)throw q.error;prior=q.data||[]}
  const priorMap=new Map(prior.map(r=>[r.listing_id,r])),due=(listings||[]).filter(l=>{const p=priorMap.get(l.id);return !p||!p.next_check_at||Date.parse(p.next_check_at)<=Date.now()});
  const rows=[],network=[];
  for(const listing of due){
    const source=sourceMap.get(Number(listing.source_id));if(!source)continue;
    const row=await resolveListingShadow(listing,source,false);
    if(row)rows.push(row);else if(network.length<fetchLimit)network.push({listing,source});
  }
  for(let i=0;i<network.length;i+=4){
    const batch=await Promise.all(network.slice(i,i+4).map(x=>resolveListingShadow(x.listing,x.source,true)));
    rows.push(...batch.filter(Boolean));
  }
  if(rows.length){const {error}=await db.from('immomio_object_resolution_shadow').upsert(rows,{onConflict:'listing_id'});if(error)throw error}
  const counts={resolved:0,new_shadow_candidates:0,conflict:0,missing:0,error:0,skipped:0};
  for(const row of rows){if(Object.hasOwn(counts,row.status))counts[row.status]++;if(row.status==='resolved'&&row.method!=='existing_target')counts.new_shadow_candidates++}
  return {sources:sourceIds.length,lookback_hours:lookbackHours,eligible:(listings||[]).length,due:due.length,checked:rows.length,network_fetches:network.length,...counts};
}
