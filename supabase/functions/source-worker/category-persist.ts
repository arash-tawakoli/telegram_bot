import {Candidate,Source,db,upsertCandidates} from './shared.ts';

function categoryListingKey(c:any){return String(c?.key||c?.id||c?.raw?.entry?.exposedId||c?.url?.split('/').filter(Boolean).at(-1)||'').slice(0,500)}
function categoryOfferMode(c:any){
  const text=String(c?.title||'')+' '+String(c?.raw?.text||'')+' '+String(c?.raw?._provider_text||'')+' '+String(c?.raw?.alt||'');
  if(/\b(?:zum kauf|kaufpreis|zu verkaufen|verkauf|mietkauf|erbpacht)\b/i.test(text))return 'sale';
  if(/\b(?:ich|wir)\s+suche\b/i.test(text)||/\b(?:haus|wohnung|apartment|zimmer|wg-zimmer|mitbewohner(?:in)?)\s+gesucht\b/i.test(text)||/^\s*(?:tauschwohnung[: -]*)?suche\b/i.test(text))return 'wanted';
  if(/tauschwohnung|tauschangebot|wohnungstausch|wohnung[ -]*tausch|\btausche\b/i.test(text))return 'swap';
  return 'rent';
}
export async function persistCategoryListings(source:Source,stream:any,candidates:Candidate[],completeSnapshot=false){
  const unique=new Map<string,Candidate>();
  for(const c of candidates){const key=categoryListingKey(c);if(key)unique.set(key,c)}
  const keys=[...unique.keys()],existing=new Map<string,any>();
  for(let i=0;i<keys.length;i+=200){
    const {data,error}=await db.from('listings').select('source_listing_key,fresh_delivery_eligible,raw,first_seen_at').eq('source_id',source.id).in('source_listing_key',keys.slice(i,i+200));
    if(error)throw error;
    for(const row of data||[])existing.set(String(row.source_listing_key),row);
  }
  const stale:Candidate[]=[],fresh:Candidate[]=[],now=Date.now();
  const categoryOnly=source.coverage_strategy==='category_streams_only';
  const streamBaseline=stream?.baseline_at?Date.parse(stream.baseline_at):NaN;
  const sourceBaseline=source.baseline_completed_at?Date.parse(source.baseline_completed_at):NaN;
  const freshnessBaseline=categoryOnly?sourceBaseline:streamBaseline;
  const previous=stream?.last_success_at?Date.parse(stream.last_success_at):NaN;
  for(const c of unique.values()){
    const key=categoryListingKey(c),old=existing.get(key),category=String(stream.category);
    const text=String(c.title||'')+' '+String(c.raw?._provider_text||'')+' '+String(c.raw?.alt||'');
    const explicitRoomOffer=category==='room'&&/\bWG[-\s]?Zimmer\b|\bPrivatzimmer\b|\bMitbewohner(?:in)?\b|\bUntermiet(?:e|er)?\b|Wohngemeinschaft/i.test(text);
    const mode=source.id===73&&category!=='swap'?'rent':explicitRoomOffer?'rent':categoryOfferMode(c);
    if(mode==='sale'||(mode==='wanted'&&!explicitRoomOffer))continue;
    if(categoryOnly&&category==='swap'&&mode!=='swap')continue;
    if(categoryOnly&&category!=='swap'&&mode==='swap')continue;
    const type=categoryOnly
      ?(mode==='swap'?'Tauschwohnung':category==='house'?'Haus':category==='room'?'WG':'Wohnung')
      :(category==='house'?(mode==='swap'?'Tauschwohnung':'Haus'):'WG');
    const next:Candidate={...c,type,raw:{...c.raw,category_stream:category,_classification:{version:1,kind:category,mode}}};
    let proof=next.raw?._newness||null,eligible=false;
    if(proof?.method==='source_timestamp'&&proof?.source_published_at){
      const published=Date.parse(proof.source_published_at);
      eligible=Number.isFinite(freshnessBaseline)&&Number.isFinite(published)&&published>=freshnessBaseline&&published>=now-86400000&&published<=now+300000;
    }
    if(categoryOnly&&source.delivery_mode==='live'&&Number.isFinite(sourceBaseline)&&old?.fresh_delivery_eligible===true&&old?.raw?._newness){
      const oldProof=old.raw._newness;
      const observed=oldProof?.source_published_at?Date.parse(oldProof.source_published_at):oldProof?.previous_success_at?Date.parse(oldProof.previous_success_at):oldProof?.observed_at?Date.parse(oldProof.observed_at):NaN;
      if(Number.isFinite(observed)&&observed>=sourceBaseline&&observed>=now-86400000&&observed<=now+300000){
        proof=oldProof;next.raw={...next.raw,_newness:proof};eligible=true;
      }
    }
    if(categoryOnly&&source.delivery_mode==='live'&&Number.isFinite(sourceBaseline)&&!old&&c.raw?.is_new===true){
      proof={method:'poll_delta',previous_success_at:source.baseline_completed_at};
      next.raw={...next.raw,_newness:proof};eligible=true;
    }
    if(!categoryOnly&&!eligible&&old?.fresh_delivery_eligible===true&&old?.raw?._newness){
      proof=old.raw._newness;next.raw={...next.raw,_newness:proof};eligible=true;
    }
    if(!categoryOnly&&!eligible&&old?.raw?.category_stream!==category&&Number.isFinite(streamBaseline)&&Number.isFinite(previous)&&previous>=streamBaseline&&previous>=now-86400000){
      proof=completeSnapshot?{method:'complete_snapshot_delta',previous_complete_at:stream.last_success_at}:{method:'poll_delta',previous_success_at:stream.last_success_at};
      next.raw={...next.raw,_newness:proof};eligible=true;
    }
    (eligible?fresh:stale).push(next);
  }
  const a=stale.length?await upsertCandidates(source,stale,false):{seen:0,fresh:0,keys:[] as string[]};
  const b=fresh.length?await upsertCandidates(source,fresh,true):{seen:0,fresh:0,keys:[] as string[]};
  return{seen:a.seen+b.seen,fresh:a.fresh+b.fresh,keys:[...(a.keys||[]),...(b.keys||[])]};
}
