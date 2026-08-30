import {Candidate,HH_ZIPS,Source,SUPABASE_URL,db,deNum,internalSecret,iso,markFailure,markSuccess,strip,upsertCandidates} from './shared.ts';

const D=[['hamburg-nord',16436],['hamburg-mitte',16423],['altona',9497],['eimsbuettel',16446],['wandsbek',9446],['harburg',9440],['bergedorf',9511]] as const;
const FAST_INTERVAL_MS=3*60*1000,REQUEST_GAP_MS=700;
const TRANSPORT=`${SUPABASE_URL}/functions/v1/kleinanzeigen-transport`;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

function url(s:string,id:number,p:number){return p===1?`https://www.kleinanzeigen.de/s-wohnung-mieten/${s}/anzeige:angebote/c203l${id}`:`https://www.kleinanzeigen.de/s-wohnung-mieten/${s}/anzeige:angebote/seite:${p}/c203l${id}`}
function total(h:string){const m=strip(h).match(/1\s*-\s*25\s+von\s+(\d[\d.]*)/i);return m?Number(m[1].replace(/\./g,'')):null}
function parsePage(h:string){const items:Candidate[]=[];let opens=0;for(const m of h.matchAll(/<article\b[^>]*data-adid=["'](\d+)["'][^>]*data-href=["']([^"']+)["'][^>]*>/gi)){opens++;const st=m.index||0,en=h.indexOf('</article>',st);if(en<0)continue;const b=h.slice(st,en+10),plain=strip(b),title=strip(b.match(/<a\b[^>]*class=["'][^"']*ellipsis[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1]||b.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1]||'');if(!title)continue;let loc=strip(b.match(/aditem-main--top--left[^>]*>([\s\S]*?)<\/div>/i)?.[1]||'');let zip=loc.match(/\b(\d{5})\b/)?.[1]||plain.match(/\b(\d{5})\s+Hamburg\b/i)?.[1];if(!zip||!HH_ZIPS.has(zip))continue;if(!loc){const lm=plain.match(new RegExp(`\\b${zip}\\s+Hamburg(?:\\s+[A-Za-zÄÖÜäöüß&;#0-9.-]+){0,3}`,'i'));loc=lm?.[0]||`${zip} Hamburg`}const tags=strip(b.match(/aditem-main--middle--tags[^>]*>([\s\S]*?)<\/(?:div|p)>/i)?.[1]||b),price=strip(b.match(/aditem-main--middle--price-shipping--price[^>]*>([\s\S]*?)<\/p>/i)?.[1]||''),image=b.match(/<img\b[^>]*(?:src|data-src)=["']([^"']+)["']/i)?.[1]||null,district=loc.replace(/^\d{5}\s+/,'').replace(/^Hamburg\s+/i,'').replace(/\s*\(Stadtteil\)$/i,'').trim();items.push({key:m[1],url:m[2].startsWith('http')?m[2]:'https://www.kleinanzeigen.de'+m[2],title,district,zip,cold:deNum(price),rooms:deNum(tags.match(/([\d.,]+)\s*Zi/i)?.[1]),area:deNum(tags.match(/([\d.,]+)\s*m²/i)?.[1]),image,raw:{provider:'kleinanzeigen',native_offer:true,location:loc,price_text:price}})}return{items,opens}}

async function fetchPage(secret:string,s:string,id:number,p:number,retries=1){let last:any=null;for(let attempt=1;attempt<=retries+1;attempt++){try{const r=await fetch(TRANSPORT,{method:'POST',headers:{'content-type':'application/json','x-internal-secret':secret},body:JSON.stringify({url:url(s,id,p)}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`Kleinanzeigen transport HTTP ${r.status}`);const upstream=Number(r.headers.get('x-upstream-status')||0),h=await r.text();if(upstream!==200)throw new Error(`Kleinanzeigen upstream HTTP ${upstream||'unknown'}`);const parsed=parsePage(h);if(parsed.opens===0)throw new Error(`Kleinanzeigen empty result HTML ${s} page ${p}`);if(parsed.items.length===0)throw new Error(`Kleinanzeigen parser accepted 0/${parsed.opens} ${s} page ${p}`);return{h,items:parsed.items,opens:parsed.opens,attempts:attempt}}catch(e){last=e;if(attempt<=retries)await sleep(1500)}}throw last}

export async function runKlein(source:Source){const started=iso();try{
  const transportSecret=await internalSecret();
  let{data:st}=await db.from('source_coverage_state').select('*').eq('source_id',2).maybeSingle();
  const legacy=st?.status!=='running'||Number(st?.cursor?.v||0)!==2;
  const cycle=legacy?crypto.randomUUID():String(st.cycle_id);
  const cursor:any=legacy?{v:2,district:0,page:2,pages:{},totals:{},fast_checked_at:null}:st.cursor;
  if(legacy){await db.from('source_coverage_state').upsert({source_id:2,cycle_id:cycle,strategy:'district_hybrid',status:'running',cursor,cycle_started_at:started,cycle_finished_at:null,seen_count:0,request_count:0,consecutive_errors:0,backoff_until:null,last_error:null,updated_at:started});st={...st,cycle_id:cycle,cycle_started_at:started,seen_count:0,request_count:0,status:'running',cursor}}

  const pages:any={...(cursor.pages||{})},totals:any={...(cursor.totals||{})};
  const initializing=D.some(([s])=>!Number(pages[s]));
  const fastDue=initializing||!cursor.fast_checked_at||Date.now()-new Date(cursor.fast_checked_at).getTime()>=FAST_INTERVAL_MS;
  let fastItems:Candidate[]=[],fastRequests=0,fastErrors:string[]=[],fastOpens=0;
  if(fastDue){
    const targets=initializing?D.filter(([s])=>!Number(pages[s])):D;
    for(const [s,id] of targets){
      try{const r=await fetchPage(transportSecret,s,id,1,1);fastRequests+=r.attempts;fastOpens+=r.opens;const n=total(r.h);if(n==null)throw new Error(`Kleinanzeigen total missing for ${s}`);totals[s]=n;pages[s]=Math.max(1,Math.min(60,Math.ceil(n/25)));fastItems.push(...r.items)}catch(e){fastErrors.push(`${s}: ${e instanceof Error?e.message:String(e)}`)}
      await sleep(REQUEST_GAP_MS);
    }
  }
  const fastSaved=fastItems.length?await upsertCandidates(source,fastItems):{seen:0,fresh:0};
  const missing=D.filter(([s])=>!Number(pages[s])).map(([s])=>s);
  const fastCheckedAt=fastDue&&!fastErrors.length?iso():cursor.fast_checked_at||null;
  if(missing.length){const msg=`missing first pages: ${missing.join(', ')}${fastErrors.length?` | ${fastErrors.join(' | ')}`:''}`.slice(0,1000);await db.from('source_coverage_state').update({status:'running',cursor:{...cursor,pages,totals,fast_checked_at:fastCheckedAt},expected_count:Object.values(totals).reduce((a:any,x:any)=>a+Number(x||0),0),request_count:Number(st?.request_count||0)+fastRequests,consecutive_errors:Number(st?.consecutive_errors||0)+1,backoff_until:null,updated_at:iso(),last_error:msg}).eq('source_id',2);throw new Error(`Kleinanzeigen first-page coverage incomplete: ${msg}`)}

  let district=Math.max(0,Number(cursor.district||0)),page=Math.max(2,Number(cursor.page||2));
  while(district<D.length&&page>Number(pages[D[district][0]]||1)){district++;page=2}

  let coverageItems:Candidate[]=[],coverageRequests=0,coverageOpens=0,coverageLabel:string|null=null;
  if(district<D.length){const [s,id]=D[district];const currentPage=page,r=await fetchPage(transportSecret,s,id,currentPage,1);coverageRequests=r.attempts;coverageOpens=r.opens;coverageItems=r.items;coverageLabel=`${s}:page:${currentPage}`;page++;if(page>Number(pages[s]||1)){district++;page=2}}
  const coverageSaved=coverageItems.length?await upsertCandidates(source,coverageItems):{seen:0,fresh:0};
  const complete=district>=D.length,t=iso(),cycleStarted=String(st?.cycle_started_at||started);
  if(complete)await db.from('listings').update({is_active:false}).eq('source_id',2).eq('is_active',true).lt('last_seen_at',cycleStarted);

  const requests=fastRequests+coverageRequests;
  const seenIncrement=coverageSaved.seen+(initializing?fastSaved.seen:0);
  const nextCursor={v:2,district:complete?0:district,page:complete?2:page,pages:complete?{}:pages,totals:complete?{}:totals,fast_checked_at:fastCheckedAt};
  await db.from('source_coverage_state').update({status:complete?'complete':'running',strategy:'district_hybrid',cursor:nextCursor,expected_count:Object.values(totals).reduce((a:any,x:any)=>a+Number(x||0),0),seen_count:Number(st?.seen_count||0)+seenIncrement,request_count:Number(st?.request_count||0)+requests,cycle_finished_at:complete?t:null,last_complete_at:complete?t:st?.last_complete_at||null,consecutive_errors:0,backoff_until:null,last_error:fastErrors.length?`fast lane partial: ${fastErrors.join(' | ').slice(0,900)}`:null,updated_at:t}).eq('source_id',2);
  await markSuccess(source,started,null,fastItems.length+coverageItems.length,fastSaved.fresh+coverageSaved.fresh,{strategy:'7_borough_fast_lane_plus_sequential_cursor',transport:'supabase_kleinanzeigen_transport',cycle_id:cycle,fast_lane:fastDue,fast_requests:fastRequests,fast_opens:fastOpens,fast_accepted:fastItems.length,fast_errors:fastErrors,coverage_page:coverageLabel,coverage_requests:coverageRequests,coverage_opens:coverageOpens,coverage_accepted:coverageItems.length,next_district:complete?null:D[district]?.[0]||null,next_page:complete?null:page,expected_count:Object.values(totals).reduce((a:any,x:any)=>a+Number(x||0),0),complete});
  return{ok:true,source_id:2,fetched:fastItems.length+coverageItems.length,new:fastSaved.fresh+coverageSaved.fresh,fast_lane:fastDue,coverage_page:coverageLabel,coverage_accepted:coverageItems.length,next:complete?null:{district:D[district]?.[0]||null,page},complete};
}catch(e){const t=iso(),{data:st}=await db.from('source_coverage_state').select('consecutive_errors').eq('source_id',2).maybeSingle();await db.from('source_coverage_state').update({status:'running',consecutive_errors:Number(st?.consecutive_errors||0)+1,last_error:String(e).slice(0,1000),backoff_until:null,updated_at:t}).eq('source_id',2);return markFailure(source,started,e)}}
