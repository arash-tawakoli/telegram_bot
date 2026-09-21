import {Candidate,Source,db,upsertCandidates} from './shared.ts';

function categoryListingKey(c:any){return String(c?.key||c?.id||c?.raw?.entry?.exposedId||c?.url?.split('/').filter(Boolean).at(-1)||'').slice(0,500)}
function categoryOfferMode(c:any){
  const text=String(c?.title||'')+' '+String(c?.raw?.text||'')+' '+String(c?.raw?.alt||'');
  if(/\b(?:zum kauf|kaufpreis|zu verkaufen|verkauf|mietkauf|erbpacht)\b/i.test(text))return 'sale';
  if(/\b(?:ich|wir)\s+suche\b/i.test(text)||/\b(?:haus|wohnung|apartment|zimmer|wg-zimmer|mitbewohner(?:in)?)\s+gesucht\b/i.test(text)||/^\s*(?:tauschwohnung[: -]*)?suche\b/i.test(text))return 'wanted';
  if(/tauschwohnung|tauschangebot|wohnungstausch|wohnung[ -]*tausch|\btausche\b/i.test(text))return 'swap';
  return 'rent';
}
export async function persistCategoryListings(source:Source,stream:any,candidates:Candidate[],completeSnapshot=false){
  const unique=new Map<string,Candidate>();for(const c of candidates){const key=categoryListingKey(c);if(key)unique.set(key,c)}
  const keys=[...unique.keys()],existing=new Map<string,any>();
  for(let i=0;i<keys.length;i+=200){const {data,error}=await db.from('listings').select('source_listing_key,fresh_delivery_eligible,raw,first_seen_at').eq('source_id',source.id).in('source_listing_key',keys.slice(i,i+200));if(error)throw error;for(const row of data||[])existing.set(String(row.source_listing_key),row)}
  const stale:Candidate[]=[],fresh:Candidate[]=[],now=Date.now(),baseline=stream?.baseline_at?Date.parse(stream.baseline_at):NaN,previous=stream?.last_success_at?Date.parse(stream.last_success_at):NaN;
  for(const c of unique.values()){
    const key=categoryListingKey(c),old=existing.get(key),mode=categoryOfferMode(c);if(mode==='sale'||mode==='wanted')continue;
    const category=String(stream.category),next:Candidate={...c,type:category==='house'?(mode==='swap'?'Tauschwohnung':'Haus'):'WG',raw:{...c.raw,category_stream:category,_classification:{version:1,kind:category,mode}}};
    let proof=next.raw?._newness||null,eligible=false;
    if(proof?.method==='source_timestamp'&&proof?.source_published_at){const published=Date.parse(proof.source_published_at);eligible=Number.isFinite(baseline)&&Number.isFinite(published)&&published>=now-86400000&&published<=now+300000}
    if(!eligible&&old?.fresh_delivery_eligible===true&&old?.raw?._newness){proof=old.raw._newness;next.raw={...next.raw,_newness:proof};eligible=true}
    if(!eligible&&old?.raw?.category_stream!==category&&Number.isFinite(baseline)&&Number.isFinite(previous)&&previous>=baseline&&previous>=now-86400000){proof=completeSnapshot?{method:'complete_snapshot_delta',previous_complete_at:stream.last_success_at}:{method:'poll_delta',previous_success_at:stream.last_success_at};next.raw={...next.raw,_newness:proof};eligible=true}
    (eligible?fresh:stale).push(next);
  }
  const a=stale.length?await upsertCandidates(source,stale,false):{seen:0,fresh:0,keys:[] as string[]},b=fresh.length?await upsertCandidates(source,fresh,true):{seen:0,fresh:0,keys:[] as string[]};
  return{seen:a.seen+b.seen,fresh:a.fresh+b.fresh,keys:[...(a.keys||[]),...(b.keys||[])]};
}
