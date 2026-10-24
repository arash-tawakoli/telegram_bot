import {persistCategoryListings} from './category-persist.ts';
import { fetchListingPage } from "../kleinanzeigen-transport/fetch-page.ts";
import {Candidate,HH_ZIPS,Source,db,deNum,decode,iso,markFailure,markSuccess,strip,upsertCandidates} from './shared.ts';

const D=[['hamburg-nord',16436],['hamburg-mitte',16423],['altona',9497],['eimsbuettel',16446],['wandsbek',9446],['harburg',9440],['bergedorf',9511]] as const;
const TARGET_NEIGHBORHOODS=[
  {name:'Hamburg-Altstadt',borough:'Hamburg-Mitte'},
  {name:'Neuwerk',borough:'Hamburg-Mitte'},
  {name:'Steinwerder',borough:'Hamburg-Mitte'},
  {name:'Neuallermöhe',borough:'Bergedorf'},
  {name:'Tatenberg',borough:'Bergedorf'},
  {name:'Altenwerder',borough:'Harburg'},
  {name:'Gut Moor',borough:'Harburg'},
] as const;
const FAST_INTERVAL_MS=3*60*1000,COVERAGE_INTERVAL_MS=10*60*1000,REQUEST_GAP_MS=350;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

function url(s:string,id:number,p:number){const base=p===1?`https://www.kleinanzeigen.de/s-wohnung-mieten/${s}/anzeige:angebote/c203l${id}`:`https://www.kleinanzeigen.de/s-wohnung-mieten/${s}/anzeige:angebote/seite:${p}/c203l${id}`;return`${base}?sortingField=SORTING_DATE`}
function total(h:string){const m=strip(h).match(/1\s*-\s*25\s+von\s+(\d[\d.]*)/i);return m?Number(m[1].replace(/\./g,'')):null}
function listingDates(h:string){const out=new Map<string,string>(),decoded=decode(h);for(const chunk of decoded.split('"organicAdPreview"').slice(1)){const id=chunk.match(/"id":\[0,(\d+)\]/)?.[1],date=chunk.match(/"sortingDate":\[0,"([^"]+)"\]/)?.[1];if(id&&date)out.set(id,date)}return out}
function berlinNow(){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));return{year:Number(parts.year),month:Number(parts.month),day:Number(parts.day),hour:Number(parts.hour),minute:Number(parts.minute)}}
function ageMinutes(label:string|null){if(!label)return null;const now=berlinNow(),time=label.match(/(\d{1,2}):(\d{2})/);if(!time)return null;const adMinutes=Number(time[1])*60+Number(time[2]);let dayDiff:number;if(/^Heute\b/i.test(label))dayDiff=0;else if(/^Gestern\b/i.test(label))dayDiff=1;else{const d=label.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);if(!d)return null;dayDiff=Math.round((Date.UTC(now.year,now.month-1,now.day)-Date.UTC(Number(d[3]),Number(d[2])-1,Number(d[1])))/86400000)}return dayDiff*1440+now.hour*60+now.minute-adMinutes}
function currentListing(label:string|null){const age=ageMinutes(label);return age!=null&&age>=-5&&age<=1440}
function sortingDateIso(label:string|null){
  if(!label)return null;
  const now=berlinNow(),time=label.match(/(\d{1,2}):(\d{2})/);if(!time)return null;
  let y=now.year,m=now.month,d=now.day;
  if(/^Gestern\b/i.test(label)){const x=new Date(Date.UTC(y,m-1,d)-86400000);y=x.getUTCFullYear();m=x.getUTCMonth()+1;d=x.getUTCDate()}
  else if(!/^Heute\b/i.test(label)){const x=label.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);if(!x)return null;d=Number(x[1]);m=Number(x[2]);y=Number(x[3])}
  const utcGuess=new Date(Date.UTC(y,m-1,d,Number(time[1]),Number(time[2])));
  const zone=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Berlin',timeZoneName:'shortOffset'}).formatToParts(utcGuess).find(x=>x.type==='timeZoneName')?.value||'GMT+1';
  const om=zone.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);const offset=om?(om[1]==='-'?-1:1)*(Number(om[2])*60+Number(om[3]||0)):60;
  return new Date(utcGuess.getTime()-offset*60000).toISOString();
}
function parsePage(h:string,regionStateCode='HH'){
  const dates=listingDates(h),items:Candidate[]=[];
  let opens=0;
  for(const m of h.matchAll(/<article\b[^>]*data-adid=["'](\d+)["'][^>]*data-href=["']([^"']+)["'][^>]*>/gi)){
    opens++;
    const st=m.index||0,en=h.indexOf('</article>',st);
    if(en<0)continue;
    const b=h.slice(st,en+10),plain=strip(b);
    const title=strip(b.match(/<a\b[^>]*class=["'][^"']*ellipsis[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1]||b.match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i)?.[1]||'');
    if(!title)continue;
    let loc=strip(b.match(/aditem-main--top--left[^>]*>([\s\S]*?)<\/div>/i)?.[1]||b.match(/<span\b[^>]*>\s*(\d{5}\s+Hamburg[^<]*)<\/span>/i)?.[1]||'');
    let zip=loc.match(/\b(\d{5})\b/)?.[1]||(regionStateCode==='SH'?plain.match(/\b(\d{5})\b/)?.[1]:plain.match(/\b(\d{5})\s+Hamburg\b/i)?.[1]);
    if((!zip&&regionStateCode!=='SH')||(zip&&regionStateCode!=='SH'&&!HH_ZIPS.has(zip)))continue;
    if(!loc){
      if(regionStateCode==='SH'){
        const lm=plain.match(new RegExp(`\\b${zip}\\s+[A-Za-zÄÖÜäöüß&;#0-9.-]+(?:\\s+[A-Za-zÄÖÜäöüß&;#0-9.-]+){0,3}`,'i'));
        loc=lm?.[0]||`${zip} Schleswig-Holstein`;
      }else{
        const lm=plain.match(new RegExp(`\\b${zip}\\s+Hamburg(?:\\s+[A-Za-zÄÖÜäöüß&;#0-9.-]+){0,3}`,'i'));
        loc=lm?.[0]||`${zip} Hamburg`;
      }
    }
    const tags=strip(b.match(/aditem-main--middle--tags[^>]*>([\s\S]*?)<\/(?:div|p)>/i)?.[1]||'');
    const price=strip(b.match(/aditem-main--middle--price-shipping--price[^>]*>([\s\S]*?)<\/p>/i)?.[1]||b.match(/<p\b[^>]*>\s*([\d.]+(?:,\d{1,2})?\s*€(?:\s*VB)?)\s*<\/p>/i)?.[1]||'');
    const image=b.match(/<img\b[^>]*(?:src|data-src)=["']([^"']+)["']/i)?.[1]||null;
    const district=loc.replace(/^\d{5}\s+/,'').replace(/^Hamburg\s+/i,'').replace(/\s*\(Stadtteil\)$/i,'').trim();
    const sortingDate=dates.get(m[1])||null;
    items.push({
      key:m[1],url:m[2].startsWith('http')?m[2]:'https://www.kleinanzeigen.de'+m[2],title,district,zip,
      cold:deNum(price),rooms:deNum(tags.match(/([\d.,]+)\s*Zi/i)?.[1]),area:deNum(tags.match(/([\d.,]+)\s*m²/i)?.[1]),image,
      raw:{provider:'kleinanzeigen',native_offer:true,location:loc,price_text:price,sorting_date:sortingDate}
    });
  }
  return{items,opens};
}

async function fetchPage(s:string,id:number,p:number,retries=1,allowEmpty=false){let last:any=null;for(let attempt=1;attempt<=retries+1;attempt++){try{const r=await fetchListingPage(url(s,id,p),AbortSignal.timeout(15000));if(!r.ok)throw new Error(`Kleinanzeigen transport HTTP ${r.status}`);const upstream=Number(r.headers.get('x-upstream-status')||0),h=await r.text();if(upstream!==200)throw new Error(`Kleinanzeigen upstream HTTP ${upstream||'unknown'}`);const parsed=parsePage(h);if(parsed.opens===0)throw new Error(`Kleinanzeigen empty result HTML ${s} page ${p}`);if(parsed.items.length===0&&!allowEmpty)throw new Error(`Kleinanzeigen parser accepted 0/${parsed.opens} ${s} page ${p}`);return{h,items:parsed.items,opens:parsed.opens,attempts:attempt}}catch(e){last=e;if(attempt<=retries)await sleep(1500)}}throw last}

async function upsertCoverage(source:Source,cands:Candidate[],presenceEpoch:string){const saved=cands.length?await upsertCandidates(source,cands,false,presenceEpoch):{seen:0,fresh:0,keys:[] as string[]};return{...saved,newEligible:0}}
async function recordBoroughOnlyNeighborhoodEvidence(source:Source,pages:any,totals:any,errors:string[]){
  for(const target of TARGET_NEIGHBORHOODS){
    const boroughEntry=D.find(([key])=>key===target.borough.toLocaleLowerCase('de-DE').replaceAll(' ','-').replace('eimsbüttel','eimsbuettel'));
    const boroughSlug=boroughEntry?.[0];
    if(!boroughSlug||!Number(pages[boroughSlug])||errors.some(error=>error.startsWith(boroughSlug+':')))continue;
    const {data:neighborhood, error:lookupError}=await db.from('hamburg_neighborhoods').select('id').eq('name',target.name).maybeSingle();
    if(lookupError)throw lookupError;
    if(!neighborhood)continue;
    const {error}=await db.rpc('record_source_neighborhood_coverage',{
      p_source_id:source.id,p_neighborhood_id:Number(neighborhood.id),p_search_status:'ambiguous',
      p_result_count:null,p_strategy:'kleinanzeigen_borough_level_page_not_neighborhood_specific',
      p_evidence_quality:'weak',
      p_evidence:{provider:'kleinanzeigen',borough:target.borough,boroughResultCount:Number(totals[boroughSlug]||0),
        exactNeighborhoodQuery:false,reason:'The verified URL uses a borough location ID; neighborhood-level result counts cannot be inferred.'},
      p_attempted_at:iso()
    });
    if(error)throw error;
  }
}

export async function runKlein(source:Source){const started=iso();try{
  let{data:st}=await db.from('source_coverage_state').select('*').eq('source_id',2).maybeSingle().throwOnError();
  const legacy=st?.status!=='running'||Number(st?.cursor?.v||0)!==2;
  const cycle=legacy?crypto.randomUUID():String(st.cycle_id);
  const cursor:any=legacy?{v:2,district:0,page:2,pages:{},totals:{},fast_checked_at:null,coverage_checked_at:null}:st.cursor;
  if(legacy){await db.from('source_coverage_state').upsert({source_id:2,cycle_id:cycle,strategy:'district_hybrid',status:'running',cursor,cycle_started_at:started,cycle_finished_at:null,seen_count:0,request_count:0,consecutive_errors:0,backoff_until:null,last_error:null,updated_at:started}).throwOnError();st={...st,cycle_id:cycle,cycle_started_at:started,seen_count:0,request_count:0,status:'running',cursor}}
  const presenceEpoch=String(st?.cycle_started_at||started);

  const pages:any={...(cursor.pages||{})},totals:any={...(cursor.totals||{})};
  const initializing=D.some(([s])=>!Number(pages[s]));
  const fastDue=initializing||!cursor.fast_checked_at||Date.now()-new Date(cursor.fast_checked_at).getTime()>=FAST_INTERVAL_MS;
  let fastItems:Candidate[]=[],fastRequests=0,fastErrors:string[]=[],fastOpens=0,fastRejectedStale=0;
  if(fastDue){
    const targets=initializing?D.filter(([s])=>!Number(pages[s])):D;
    let targetIndex=0;
    for(const [s,id] of targets){
      try{const r=await fetchPage(s,id,1,1);fastRequests+=r.attempts;fastOpens+=r.opens;const n=total(r.h);if(n==null)throw new Error(`Kleinanzeigen total missing for ${s}`);totals[s]=n;pages[s]=Math.max(1,Math.min(60,Math.ceil(n/25)));const current=r.items.filter(x=>currentListing(String(x.raw?.sorting_date||''))).map(x=>({...x,raw:{...x.raw,lane:'fast'}}));fastRejectedStale+=r.items.length-current.length;fastItems.push(...current)}catch(e){fastErrors.push(`${s}: ${e instanceof Error?e.message:String(e)}`)}
      if(++targetIndex<targets.length)await sleep(REQUEST_GAP_MS);
    }
  }
  if(fastDue)await recordBoroughOnlyNeighborhoodEvidence(source,pages,totals,fastErrors);
  const fastSaved=fastItems.length?await upsertCandidates(source,fastItems,true,presenceEpoch):{seen:0,fresh:0,keys:[] as string[]};
  const missing=D.filter(([s])=>!Number(pages[s])).map(([s])=>s);
  const fastCheckedAt=fastDue&&!fastErrors.length?iso():cursor.fast_checked_at||null;
  if(missing.length){const msg=`missing first pages: ${missing.join(', ')}${fastErrors.length?` | ${fastErrors.join(' | ')}`:''}`.slice(0,1000);await db.from('source_coverage_state').update({status:'running',cursor:{...cursor,pages,totals,fast_checked_at:fastCheckedAt},expected_count:Object.values(totals).reduce((a:any,x:any)=>a+Number(x||0),0),request_count:Number(st?.request_count||0)+fastRequests,consecutive_errors:Number(st?.consecutive_errors||0)+1,backoff_until:null,updated_at:iso(),last_error:msg}).eq('source_id',2).throwOnError();throw new Error(`Kleinanzeigen first-page coverage incomplete: ${msg}`)}

  let district=Math.max(0,Number(cursor.district||0)),page=Math.max(2,Number(cursor.page||2));
  while(district<D.length&&page>Number(pages[D[district][0]]||1)){district++;page=2}

  const coverageDue=initializing||!cursor.coverage_checked_at||Date.now()-new Date(cursor.coverage_checked_at).getTime()>=COVERAGE_INTERVAL_MS;
  let coverageItems:Candidate[]=[],coverageRequests=0,coverageOpens=0,coverageLabel:string|null=null,coverageError:string|null=null;
  if(coverageDue&&district<D.length){
    const [s,id]=D[district],currentPage=page;
    coverageLabel=`${s}:page:${currentPage}`;
    try{const r=await fetchPage(s,id,currentPage,1,true);coverageRequests=r.attempts;coverageOpens=r.opens;coverageItems=r.items.map(x=>({...x,raw:{...x.raw,lane:'coverage'}}));page++;if(page>Number(pages[s]||1)){district++;page=2}}
    catch(e){coverageRequests=2;coverageError=e instanceof Error?e.message:String(e)}
  }
  const coverageSaved=await upsertCoverage(source,coverageItems,presenceEpoch);
  const coverageCheckedAt=coverageDue&&!coverageError?iso():cursor.coverage_checked_at||null;
  const complete=district>=D.length&&!coverageError,t=iso(),cycleStarted=presenceEpoch;
  if(complete)await db.from('listings').update({is_active:false}).eq('source_id',2).eq('is_active',true).or('property_kind.is.null,property_kind.eq.apartment').lt('last_seen_at',cycleStarted).throwOnError();

  const requests=fastRequests+coverageRequests;
  const seenIncrement=coverageSaved.seen+(initializing?fastSaved.seen:0);
  const nextCursor={v:2,district:complete?0:district,page:complete?2:page,pages:complete?{}:pages,totals:complete?{}:totals,fast_checked_at:fastCheckedAt,coverage_checked_at:coverageCheckedAt};
  const partialErrors=[...(fastErrors.length?[`fast lane partial: ${fastErrors.join(' | ')}`]:[]),...(coverageError?[`coverage partial: ${coverageError}`]:[])];
  await db.from('source_coverage_state').update({status:complete?'complete':'running',strategy:'district_hybrid',cursor:nextCursor,expected_count:Object.values(totals).reduce((a:any,x:any)=>a+Number(x||0),0),seen_count:Number(st?.seen_count||0)+seenIncrement,request_count:Number(st?.request_count||0)+requests,cycle_finished_at:complete?t:null,last_complete_at:complete?t:st?.last_complete_at||null,consecutive_errors:coverageError?Number(st?.consecutive_errors||0)+1:0,backoff_until:null,last_error:partialErrors.length?partialErrors.join(' | ').slice(0,900):null,updated_at:t}).eq('source_id',2).throwOnError();
  await markSuccess(source,started,null,fastItems.length+coverageItems.length,fastSaved.fresh+coverageSaved.fresh,{strategy:'7_borough_current_fast_lane_plus_inventory_cursor',transport:'supabase_kleinanzeigen_transport',cycle_id:cycle,fast_lane:fastDue,fast_requests:fastRequests,fast_opens:fastOpens,fast_accepted:fastItems.length,fast_rejected_stale:fastRejectedStale,fast_freshness_window_hours:24,fast_errors:fastErrors,coverage_due:coverageDue,coverage_interval_minutes:10,coverage_page:coverageLabel,coverage_requests:coverageRequests,coverage_opens:coverageOpens,coverage_accepted:coverageItems.length,coverage_error:coverageError,coverage_new_eligible:0,next_district:complete?null:D[district]?.[0]||null,next_page:complete?null:page,expected_count:Object.values(totals).reduce((a:any,x:any)=>a+Number(x||0),0),complete});
  return{ok:true,source_id:2,fetched:fastItems.length+coverageItems.length,new:fastSaved.fresh,fast_lane:fastDue,fast_rejected_stale:fastRejectedStale,coverage_due:coverageDue,coverage_page:coverageLabel,coverage_accepted:coverageItems.length,coverage_new_eligible:0,next:complete?null:{district:D[district]?.[0]||null,page},complete};
}catch(e){const t=iso(),{data:st}=await db.from('source_coverage_state').select('consecutive_errors').eq('source_id',2).maybeSingle().throwOnError();await db.from('source_coverage_state').update({status:'running',consecutive_errors:Number(st?.consecutive_errors||0)+1,last_error:String(e).slice(0,1000),backoff_until:null,updated_at:t}).eq('source_id',2).throwOnError();return markFailure(source,started,e)}}


function kleinCategoryPageUrl(base: string, page: number) {
  const url = new URL(base);
  if (page <= 1) return url.href;
  const segments = url.pathname.split("/");
  const categoryIndex = segments.findIndex((segment) => /^(?:k\d+c\d+l\d+|c\d+l\d+)$/i.test(segment));
  if (categoryIndex < 0) throw new Error(`Kleinanzeigen category URL has no location segment: ${base}`);
  if (segments[categoryIndex - 1] !== `seite:${page}`) segments.splice(categoryIndex, 0, `seite:${page}`);
  url.pathname = segments.join("/");
  return url.href;
}

async function fetchKleinCategoryPage(base: string, page: number, regionStateCode: string) {
  const url = kleinCategoryPageUrl(base, page);
  const response = await fetchListingPage(url, AbortSignal.timeout(15000));
  if (!response.ok) throw new Error(`Kleinanzeigen category HTTP ${response.status}`);
  const upstream = Number(response.headers.get("x-upstream-status") || 0);
  if (upstream !== 200) throw new Error(`Kleinanzeigen category upstream HTTP ${upstream || "unknown"}`);
  const html = await response.text();
  const parsed = parsePage(html, regionStateCode);
  const noOffers = /keine (?:passenden )?(?:angebote|anzeigen|treffer)|0 (?:angebote|treffer)|leider (?:gibt es|haben wir) (?:aktuell )?keine/i.test(strip(html));
  if (parsed.opens === 0 && !noOffers) throw new Error(`Kleinanzeigen category page returned no cards and no verified-empty marker: ${url}`);
  if (parsed.opens > 0 && parsed.items.length === 0) throw new Error(`Kleinanzeigen parser accepted 0/${parsed.opens} cards at ${url}`);
  return { url: response.url || url, html, ...parsed, noOffers, total: total(html) };
}

export async function runKleinCategory(source:Source,stream:any){
  const base=String(stream.url||"");
  if(!base)throw new Error("Kleinanzeigen category URL is missing");
  const category=String(stream.category||"");
  const regionStateCode=source.search_capabilities?.region_state_code==="SH"?"SH":"HH";
  const prior=stream.cursor&&typeof stream.cursor==="object"?stream.cursor:{};
  const reset=prior.complete===true||prior.initialized!==true;
  let nextPage=reset?1:Math.max(1,Number(prior.next_page||1));
  let totalPages=reset?null:(Number(prior.total_pages||0)||null);
  let parsedTotal=reset?0:Number(prior.parsed_total||0);
  let acceptedTotal=reset?0:Number(prior.accepted_total||0);
  let allEmptyVerified=reset?true:prior.all_empty_verified!==false;
  const rows:Candidate[]=[];
  let requests=0,parsedCount=0,complete=false,verifiedEmpty=false;
  const maxPagesPerRun=4;
  for(let index=0;index<maxPagesPerRun;index++){
    const page=await fetchKleinCategoryPage(base,nextPage,regionStateCode);
    requests++;
    parsedCount+=page.opens;
    parsedTotal+=page.opens;
    if(page.items.length)allEmptyVerified=false;
    if(page.opens===0&&page.noOffers){
      complete=true;
      verifiedEmpty=acceptedTotal===0&&allEmptyVerified;
      break;
    }
    for(const candidate of page.items){
      const title=String(candidate.title||"");
      if(category==="house"&&!/\b(Haus|Einfamilienhaus|Reihenhaus|Doppelhaus|Doppelhaushälfte|Villa|Bungalow|Stadthaus)\b/i.test(title))continue;
      if(category==="room"&&source.coverage_strategy!=="category_streams_only"){
        const roomSignal=/\b(?:WG(?:[- ]?Zimmer)?|Privatzimmer|Mitbewohner(?:in)?|Untermiet(?:e|er)?|Zimmer)\b/i.test(title);
        const wholeUnit=/\b(?:gesamte|komplette)\s+(?:Unterkunft|Wohnung)\b|\b\d+(?:[.,]\d+)?[ -]?Zimmer\b.{0,40}\bWohnung\b|\bApartment\b/i.test(title);
        const strongRoom=/\b(?:WG(?:[- ]?Zimmer)?|Privatzimmer|Mitbewohner(?:in)?|Untermiet(?:e|er)?)\b/i.test(title);
        if(!roomSignal||(wholeUnit&&!strongRoom))continue;
      }
      const published=sortingDateIso(String(candidate.raw?.sorting_date||""));
      rows.push({...candidate,raw:{...candidate.raw,...(published?{_newness:{method:"source_timestamp",source_published_at:published}}:{})}});
    }
    if(page.total!=null&&page.total>0)totalPages=Math.max(1,Math.ceil(page.total/25));
    const hasNextByTotal=totalPages!=null&&nextPage<totalPages;
    const pageFull=page.opens>=25;
    nextPage++;
    if(!hasNextByTotal&&(totalPages!=null||!pageFull)){
      complete=true;
      break;
    }
    if(totalPages!=null&&nextPage>totalPages){
      complete=true;
      break;
    }
  }
  const saved=await persistCategoryListings(source,stream,rows,false);
  acceptedTotal+=saved.seen;
  verifiedEmpty=complete&&acceptedTotal===0&&allEmptyVerified;
  return{
    requests,candidates:saved.seen,fresh:saved.fresh,
    cursor:{
      initialized:true,next_page:complete?1:nextPage,total_pages:totalPages,
      parsed:parsedCount,parsed_total:parsedTotal,accepted:saved.seen,accepted_total:acceptedTotal,
      all_empty_verified:allEmptyVerified,complete,verified_empty:verifiedEmpty,last_checked_at:iso()
    }
  };
}
