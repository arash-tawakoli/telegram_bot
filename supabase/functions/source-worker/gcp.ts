import {Candidate,Connector,Source,absolute,db,decode,deNum,fetchText,hhZip,imageFromHtml,iso,markFailure,markSuccess,strip,upsertCandidates} from './shared.ts';

const DEFAULT_PRIMARY_URL='https://www.grandcityproperty.de/wohnungssuche?city=&cityField=Hamburg&type=&price=&rooms=&size=&radius=100000&cityText=';
const DEFAULT_RECOMMENDATION_URL='https://www.grandcityproperty.de/objekt-vermietet?city=hamburg';

function adapter(c:Connector|undefined){return String(c?.config?.adapter||'')}
function connectorByAdapter(cs:Connector[],name:string){return cs.find(c=>adapter(c)===name)}
function urlOf(c:Connector|undefined,fallback:string){return String(c?.config?.url||fallback).trim()||fallback}
function attr(tag:string,name:string){return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`,'i'))?.[1]||null}
function keyFromUrl(url:string){try{return new URL(url).pathname.split('/').filter(Boolean).at(-1)||null}catch{return null}}
function detailUrls(html:string,base:string){
  const out=new Map<string,string>();
  for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)){
    const url=absolute(base,m[1]);
    if(!url)continue;
    let u:URL;try{u=new URL(url)}catch{continue}
    if(!/(?:^|\.)grandcityproperty\.de$/i.test(u.hostname))continue;
    const path=u.pathname.replace(/\/+$/,'');
    if(!/^\/wohnungssuche\/hamburg\/.+\/(?:expose\/)?[^/]+$/i.test(path))continue;
    const key=keyFromUrl(url);if(key)out.set(key,url);
  }
  return [...out.entries()].map(([key,url])=>({key,url}));
}
function moneyAfter(text:string,labels:string){return deNum(text.match(new RegExp(`(?:${labels})\\s*:?\\s*([\\d.]+(?:,\\d{1,2})?)\\s*(?:€|EUR)`,'i'))?.[1])}
function isoDate(text:string){const m=text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:null}
function section(text:string,label:string,next:string){const m=text.match(new RegExp(`${label}\\s+([\\s\\S]{1,2200}?)(?=${next}|$)`,'i'));return m?.[1]?.replace(/\s+/g,' ').trim().slice(0,1800)||null}
function cleanPlace(v:string|null|undefined){return v?.trim().replace(/[.,;:]+$/,'')||null}
function pageAddress(html:string,zip:string|null){
  for(const m of html.matchAll(/<img\b[^>]*>/gi)){
    const alt=decode(attr(m[0],'alt')||'').replace(/\s+/g,' ').trim();
    const a=alt.match(/(?:^|\s)([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.'’\-]*(?:\s+[A-Za-zÄÖÜäöüß.'’\-]+){0,4}\s+\d+[a-zA-Z]?)\s*,?\s*(2\d{4})\s+Hamburg\b/i);
    if(a&&(!zip||a[2]===zip))return `${a[1].trim()}, ${a[2]} Hamburg`;
  }
  return null;
}
function gcpImage(html:string,base:string,zip:string|null){
  for(const m of html.matchAll(/<img\b[^>]*>/gi)){
    const tag=m[0],alt=decode(attr(tag,'alt')||'');
    if(!/Hamburg/i.test(alt)||(zip&&!alt.includes(zip)))continue;
    for(const name of ['data-src','data-original','src']){const raw=attr(tag,name);if(raw){const url=absolute(base,raw);if(url&&!/\.(?:svg)(?:[?#]|$)|(?:logo|favicon|sprite|placeholder)(?:[_.\/-]|$)/i.test(url))return url}}
  }
  return imageFromHtml(html,base);
}
async function parseDetail(url:string,key:string,lane:string):Promise<Candidate|null>{
  const r=await fetchText(url,undefined,10000);
  if(/\/objekt-vermietet(?:\?|$)/i.test(r.url))return null;
  const plain=strip(r.text);
  if(/Dieses Objekt ist bereits vermietet/i.test(plain))return null;
  const title=strip(r.text.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||'').slice(0,240)||'Grand City Property Wohnungsangebot';
  if(/\b(?:Gewerbe|Gewerbeeinheit|Gewerbefläche|Verkaufsfläche|Einzelhandelsfläche|Büro|Praxis|Laden|Ladenfläche|Lager|Stellplatz|Garage)\b/i.test(title))return null;
  const zip=r.text.match(/\b(2\d{4})\s+Hamburg\b/i)?.[1]||null;
  if(zip&&!hhZip(zip))return null;
  const address=pageAddress(r.text,zip);
  const cold=moneyAfter(plain,'Kaltmiete|Nettokaltmiete|Grundmiete|Nettomiete'),warm=moneyAfter(plain,'Gesamtmiete|Warmmiete|Bruttowarmmiete|Bruttomiete'),additional=moneyAfter(plain,'Nebenkosten|Nebenkostenvorauszahlung|sonstige Kosten'),operating=moneyAfter(plain,'Betriebskosten|Betriebskostenvorauszahlung'),heating=moneyAfter(plain,'Heizkosten|Heizungskosten|Heizkostenvorauszahlung'),deposit=moneyAfter(plain,'Kaution|Mietkaution|Mietsicherheit');
  const depositText=deposit==null?(plain.match(/(?:Kaution|Mietkaution|Mietsicherheit)\s*:?\s*(.{2,100}?)(?=Wohnfläche|Fläche|Etage|Stock|Zimmer|Ausweistyp|Energieträger|Baujahr|Objektbeschreibung)/i)?.[1]?.trim().slice(0,120)||null):null;
  const rooms=deNum(plain.match(/([\d.,]+)\s*[-–]?\s*Zimmer/i)?.[1]),area=deNum(plain.match(/([\d.,]+)\s*m(?:²|2)/i)?.[1]);
  const locationText=section(plain,'Lage','Sonstiges|Bei uns in guten Wänden');
  const loc=locationText?.match(/(?:Hamburger\s+)?Stadtteil\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]+)\s+im\s+Bezirk\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]+)/i);
  const locationDistrict=locationText?.match(/\bHamburg[-–]\s*([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]+)/i)?.[1]||locationText?.match(/\bStadtteil\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]+)/i)?.[1]||null;
  const districtMatch=title.match(/Hamburg\s*[-–]?\s*([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]+)/i)?.[1]||null,titleDistrict=districtMatch&&!/^(?:Wohnung|Apartment|Appartement|mit|in|zu|zum)$/i.test(districtMatch)?districtMatch:null;
  const district=cleanPlace(loc?.[1]||locationDistrict||titleDistrict),borough=cleanPlace(loc?.[2]);
  const objectId=plain.match(/(?:Objekt|Wohnungs)[ -]?ID\s*:?\s*([0-9/]+)/i)?.[1]||null;
  const floor=plain.match(/\b(\d+)\.\s*Stock\b/i)?.[1]||plain.match(/Etage\s*:?\s*(\d+)/i)?.[1]||null;
  const year=plain.match(/Baujahr\s*:?\s*(\d{4})/i)?.[1]||null;
  const condition=plain.match(/Zustand\s*:?\s*(.{2,80}?)(?=Wesentliche Energieträger|Gesetzliche Pflichtangaben|Energieausweis|Objektbeschreibung)/i)?.[1]?.trim()||null;
  const energyCarrier=plain.match(/(?:Wesentliche\s+)?Energieträger\s*:?\s*(.{2,80}?)(?=Gesetzliche Pflichtangaben|Energieausweis|Objektbeschreibung|Verbrauch|Bedarf|Baujahr)/i)?.[1]?.trim()||null;
  const availableText=plain.match(/Verfügbar\s+ab:\s*(.{1,80}?)(?=\d+[.,]?\d*\s*m(?:²|2)|\d+\.\s*Stock|\d+[.,]?\d*\s+Zimmer)/i)?.[1]?.trim()||null;
  return {key,url:r.url,title,address,district,zip,warm,cold,additional,operating,heating,deposit,depositText,rooms,area,available:availableText?isoDate(availableText):null,type:'Wohnung',wbs:/\bWBS\b|Wohnberechtigungsschein/i.test(plain),image:gcpImage(r.text,r.url,zip),raw:{provider:'grand_city_property',discovery_lane:lane,object_id:objectId,borough,floor:floor?Number(floor):null,baujahr:year?Number(year):null,zustand:condition,energietraeger:energyCarrier,available_text:availableText,description:section(plain,'Objektbeschreibung','Ausstattung|Lage|Sonstiges'),features:section(plain,'Ausstattung','Lage|Sonstiges'),location:locationText}};
}
async function discover(url:string,lane:string){
  const r=await fetchText(url,undefined,10000),links=detailUrls(r.text,r.url),out:Candidate[]=[],errors:string[]=[];
  for(let i=0;i<links.length;i+=8){const batch=links.slice(i,i+8),rs=await Promise.allSettled(batch.map(x=>parseDetail(x.url,x.key,lane)));rs.forEach((x,j)=>{if(x.status==='fulfilled'){if(x.value)out.push(x.value)}else errors.push(`${batch[j].key}: ${x.reason instanceof Error?x.reason.message:String(x.reason)}`)})}
  return{url:r.url,discovered:links.length,candidates:out,errors};
}
async function existingFreshness(sourceId:number,keys:string[]){
  const out=new Map<string,boolean>();
  for(let i=0;i<keys.length;i+=300){const{data,error}=await db.from('listings').select('source_listing_key,fresh_delivery_eligible').eq('source_id',sourceId).in('source_listing_key',keys.slice(i,i+300));if(error)throw error;for(const row of data||[])out.set(String(row.source_listing_key),row.fresh_delivery_eligible===true)}
  return out;
}
function n(v:any){const x=Number(v);return Number.isFinite(x)?x:null}
function sameNum(a:any,b:any,tol:number){const x=n(a),y=n(b);return x!=null&&y!=null&&Math.abs(x-y)<=tol}
async function scoutMirrorStatus(sourceId:number,basis:Candidate[]){
  let checked=basis;
  if(!checked.length){const{data,error}=await db.from('listings').select('source_listing_key,title,district,postal_code,cold_rent,warm_rent,rooms,area_sqm,canonical_url,raw').eq('source_id',sourceId).eq('is_active',true).neq('quality_status','rejected').eq('raw->>provider','grand_city_property').order('last_seen_at',{ascending:false}).limit(20);if(error)throw error;checked=(data||[]).map((x:any)=>({key:String(x.source_listing_key),url:String(x.canonical_url),title:x.title,district:x.district,zip:x.postal_code,cold:n(x.cold_rent),warm:n(x.warm_rent),rooms:n(x.rooms),area:n(x.area_sqm),raw:x.raw} as Candidate))}
  const fields='source_listing_key,title,district,postal_code,cold_rent,warm_rent,rooms,area_sqm,canonical_url,last_seen_at';
  const titles=[...new Set(checked.map(x=>String(x.title||'').trim()).filter(Boolean))],zips=[...new Set(checked.map(x=>String(x.zip||'').trim()).filter(Boolean))];
  let scout:any[]=[];
  if(titles.length){const{data,error}=await db.from('listings').select(fields).eq('source_id',1).eq('is_active',true).in('title',titles).limit(100);if(error)throw error;scout.push(...(data||[]))}
  if(zips.length){const{data,error}=await db.from('listings').select(fields).eq('source_id',1).eq('is_active',true).in('postal_code',zips).limit(500);if(error)throw error;for(const row of data||[])if(!scout.some(x=>x.source_listing_key===row.source_listing_key))scout.push(row)}
  const matches:any[]=[],used=new Set<string>();
  for(const g of checked){const gt=String(g.title||'').trim().toLowerCase(),available=(s:any)=>!used.has(String(s.source_listing_key));const exact=scout.find((s:any)=>available(s)&&String(s.title||'').trim().toLowerCase()===gt);const m=exact||scout.find((s:any)=>available(s)&&(!g.zip||String(s.postal_code||'')===String(g.zip))&&(!g.district||String(s.district||'').toLowerCase()===String(g.district||'').toLowerCase())&&sameNum(s.rooms,g.rooms,0.25)&&sameNum(s.area_sqm,g.area,1)&&sameNum(s.cold_rent,g.cold,2));if(m){used.add(String(m.source_listing_key));matches.push({gcp_key:g.key,scout_key:m.source_listing_key,scout_url:m.canonical_url})}}
  return{checked:checked.length,scout_rows:scout.length,matches};
}

export async function runGcp(source:Source,connectors:Connector[]){
  const started=iso();
  try{
    const primaryConnector=connectorByAdapter(connectors,'source-worker/gcp-primary')||connectorByAdapter(connectors,'source-worker/gcp')||connectors.find(c=>c.priority===1)||connectors[0];
    const scoutConnector=connectorByAdapter(connectors,'source-worker/gcp-scout-mirror');
    const recommendationConnector=connectorByAdapter(connectors,'source-worker/gcp-recommendations');
    const primaryUrl=urlOf(primaryConnector,DEFAULT_PRIMARY_URL),recommendationUrl=urlOf(recommendationConnector,DEFAULT_RECOMMENDATION_URL);
    const attempts:any[]=[];
    let primary:{url:string;discovered:number;candidates:Candidate[];errors:string[]}|null=null,recommendation:{url:string;discovered:number;candidates:Candidate[];errors:string[]}|null=null;
    try{primary=await discover(primaryUrl,'gcp_primary');attempts.push({priority:primaryConnector?.priority||1,label:primaryConnector?.label||'GCP primary',role:'primary',status:'ok',discovered:primary.discovered,parsed:primary.candidates.length})}catch(e){attempts.push({priority:primaryConnector?.priority||1,label:primaryConnector?.label||'GCP primary',role:'primary',status:'error',error:e instanceof Error?e.message:String(e)})}
    if(recommendationConnector||!primary||!primary.candidates.length){try{recommendation=await discover(recommendationUrl,'gcp_recommendations');attempts.push({priority:recommendationConnector?.priority||3,label:recommendationConnector?.label||'GCP recommendations',role:'fallback_2',status:'ok',discovered:recommendation.discovered,parsed:recommendation.candidates.length})}catch(e){attempts.push({priority:recommendationConnector?.priority||3,label:recommendationConnector?.label||'GCP recommendations',role:'fallback_2',status:'error',error:e instanceof Error?e.message:String(e)})}}
    const byKey=new Map<string,Candidate>(),primaryKeys=new Set<string>();
    for(const c of primary?.candidates||[]){const k=String(c.key);primaryKeys.add(k);byKey.set(k,c)}
    for(const c of recommendation?.candidates||[])if(!byKey.has(String(c.key)))byKey.set(String(c.key),c);
    const candidates=[...byKey.values()];
    const mirror=await scoutMirrorStatus(source.id,candidates);
    attempts.push({priority:scoutConnector?.priority||2,label:scoutConnector?.label||'ImmoScout24 GCP mirror via Source 1',role:'fallback_1',status:mirror.matches.length?'ok':'no_match',checked:mirror.checked,matches:mirror.matches.length,delivery_mode:'source1_independent'});
    if(!candidates.length&&!mirror.matches.length)throw new Error(`GCP all lanes empty; ${attempts.map(x=>`${x.role}:${x.status}`).join(', ')}`);
    const keys=candidates.map(x=>String(x.key)),known=await existingFreshness(source.id,keys),hadBaseline=!!source.baseline_completed_at;
    const keepFresh=candidates.filter(x=>known.get(String(x.key))===true),keepBlocked=candidates.filter(x=>known.has(String(x.key))&&known.get(String(x.key))!==true),newPrimary=candidates.filter(x=>!known.has(String(x.key))&&primaryKeys.has(String(x.key))),newFallback=candidates.filter(x=>!known.has(String(x.key))&&!primaryKeys.has(String(x.key)));
    const a=keepFresh.length?await upsertCandidates(source,keepFresh,true):{seen:0,fresh:0},b=keepBlocked.length?await upsertCandidates(source,keepBlocked,false):{seen:0,fresh:0},p=newPrimary.length?await upsertCandidates(source,newPrimary,hadBaseline):{seen:0,fresh:0},f=newFallback.length?await upsertCandidates(source,newFallback,false):{seen:0,fresh:0};
    const t=iso(),freshCreated=p.fresh,requestCount=(primary?1+primary.discovered:0)+(recommendation?1+recommendation.discovered:0);
    const activeConnector=primary?.candidates.length?primaryConnector:(recommendation?.candidates.length?recommendationConnector:(scoutConnector||primaryConnector));
    await db.from('source_coverage_state').upsert({source_id:source.id,cycle_id:crypto.randomUUID(),strategy:'gcp_multi_lane',status:'running',cursor:{primary_url:primaryUrl,fallback_1:'source_1_immoscout_gcp_mirror',fallback_2_url:recommendationUrl,connector_attempts:attempts},expected_count:null,seen_count:candidates.length,request_count:requestCount,cycle_started_at:started,cycle_finished_at:null,last_complete_at:null,consecutive_errors:0,last_error:attempts.some(x=>x.status==='error')?'one or more GCP lanes degraded':null,updated_at:t});
    await markSuccess(source,started,activeConnector||null,candidates.length,a.fresh+b.fresh+p.fresh+f.fresh,{strategy:'gcp_multi_lane',connector_attempts:attempts,primary_discovered:primary?.discovered||0,primary_parsed:primary?.candidates.length||0,mirror_matches:mirror.matches,mirror_delivery_mode:'source1_independent',fallback_2_discovered:recommendation?.discovered||0,fallback_2_parsed:recommendation?.candidates.length||0,complete:false,fresh_delivery_mode:hadBaseline?'primary_new_ids_only':'baseline_only',fallback_new_ids_delivery_eligible:false});
    if(!hadBaseline)await db.from('sources').update({baseline_completed_at:t,warmed_up:true,coverage_status:'partial',updated_at:t}).eq('id',source.id);
    return{ok:true,source_id:source.id,fetched:candidates.length,new:freshCreated,complete:false,primary:primary?.candidates.length||0,mirror_matches:mirror.matches.length,fallback_2:recommendation?.candidates.length||0};
  }catch(e){return markFailure(source,started,e)}
}
