import {Candidate,Connector,Source,absolute,db,decode,deNum,fetchText,hhZip,imageFromHtml,iso,markFailure,markSuccess,strip,upsertCandidates} from './shared.ts';

const DISCOVERY_URLS=[
  'https://www.grandcityproperty.de/wohnungssuche',
  'https://www.grandcityproperty.de/objekt-vermietet?city=hamburg',
];

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
function gcpImage(html:string,base:string,zip:string|null){
  for(const m of html.matchAll(/<img\b[^>]*>/gi)){
    const tag=m[0],alt=decode(attr(tag,'alt')||'');
    if(!/Hamburg/i.test(alt)||(zip&&!alt.includes(zip)))continue;
    for(const name of ['data-src','data-original','src']){const raw=attr(tag,name);if(raw){const url=absolute(base,raw);if(url&&!/\.(?:svg)(?:[?#]|$)|(?:logo|favicon|sprite|placeholder)(?:[_.\/-]|$)/i.test(url))return url}}
  }
  return imageFromHtml(html,base);
}
async function parseDetail(url:string,key:string):Promise<Candidate|null>{
  const r=await fetchText(url,undefined,10000);
  if(/\/objekt-vermietet(?:\?|$)/i.test(r.url))return null;
  const plain=strip(r.text);
  if(/Dieses Objekt ist bereits vermietet/i.test(plain))return null;
  const title=strip(r.text.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||'').slice(0,240)||'Grand City Property Wohnungsangebot';
  if(/\b(?:Gewerbe|Gewerbeeinheit|Büro|Praxis|Laden|Lager|Stellplatz|Garage)\b/i.test(title))return null;
  const body=plain.replace(title,' '),zip=r.text.match(/\b(2\d{4})\s+Hamburg\b/i)?.[1]||null;
  if(zip&&!hhZip(zip))return null;
  const street=body.match(/\b([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.'’\-]+(?:\s+[A-Za-zÄÖÜäöüß.'’\-]+){0,5}\s+\d+[a-zA-Z]?)\s*,\s*(?:2\d{4}\s+)?Hamburg\b/i)?.[1]?.trim()||null;
  const cold=moneyAfter(plain,'Kaltmiete|Nettokaltmiete|Grundmiete|Nettomiete'),warm=moneyAfter(plain,'Gesamtmiete|Warmmiete|Bruttowarmmiete|Bruttomiete'),additional=moneyAfter(plain,'Nebenkosten|Nebenkostenvorauszahlung|sonstige Kosten'),operating=moneyAfter(plain,'Betriebskosten|Betriebskostenvorauszahlung'),heating=moneyAfter(plain,'Heizkosten|Heizungskosten|Heizkostenvorauszahlung'),deposit=moneyAfter(plain,'Kaution|Mietkaution|Mietsicherheit');
  const depositText=deposit==null?(plain.match(/(?:Kaution|Mietkaution|Mietsicherheit)\s*:?\s*(.{2,100}?)(?=Wohnfläche|Fläche|Etage|Stock|Zimmer|Ausweistyp|Energieträger|Baujahr|Objektbeschreibung)/i)?.[1]?.trim().slice(0,120)||null):null;
  const rooms=deNum(plain.match(/([\d.,]+)\s*[-–]?\s*Zimmer/i)?.[1]),area=deNum(plain.match(/([\d.,]+)\s*m(?:²|2)/i)?.[1]);
  const loc=plain.match(/(?:Hamburger\s+)?Stadtteil\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]+)\s+im\s+Bezirk\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]+)/i);
  const districtMatch=title.match(/Hamburg\s*[-–]?\s*([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]+)/i)?.[1]||null,titleDistrict=districtMatch&&!/^(?:Wohnung|Apartment|Appartement|mit|in|zu|zum)$/i.test(districtMatch)?districtMatch:null;
  const district=loc?.[1]||titleDistrict,borough=loc?.[2]||null;
  const objectId=plain.match(/(?:Objekt|Wohnungs)[ -]?ID\s*:?\s*([0-9/]+)/i)?.[1]||null;
  const floor=plain.match(/\b(\d+)\.\s*Stock\b/i)?.[1]||plain.match(/Etage\s*:?\s*(\d+)/i)?.[1]||null;
  const year=plain.match(/Baujahr\s*:?\s*(\d{4})/i)?.[1]||null;
  const condition=plain.match(/Zustand\s*:?\s*(.{2,80}?)(?=Wesentliche Energieträger|Gesetzliche Pflichtangaben|Energieausweis|Objektbeschreibung)/i)?.[1]?.trim()||null;
  const energyCarrier=plain.match(/(?:Wesentliche\s+)?Energieträger\s*:?\s*(.{2,80}?)(?=Gesetzliche Pflichtangaben|Energieausweis|Objektbeschreibung|Verbrauch|Bedarf|Baujahr)/i)?.[1]?.trim()||null;
  const availableText=plain.match(/Verfügbar\s+ab:\s*(.{1,80}?)(?=\d+[.,]?\d*\s*m(?:²|2)|\d+\.\s*Stock|\d+[.,]?\d*\s+Zimmer)/i)?.[1]?.trim()||null;
  const address=street?(zip?`${street}, ${zip} Hamburg`:`${street}, Hamburg`):null;
  return {key,url:r.url,title,address,district,zip,warm,cold,additional,operating,heating,deposit,depositText,rooms,area,available:availableText?isoDate(availableText):null,type:'Wohnung',wbs:/\bWBS\b|Wohnberechtigungsschein/i.test(plain),image:gcpImage(r.text,r.url,zip),raw:{provider:'grand_city_property',object_id:objectId,borough,floor:floor?Number(floor):null,baujahr:year?Number(year):null,zustand:condition,energietraeger:energyCarrier,available_text:availableText,description:section(plain,'Objektbeschreibung','Ausstattung|Lage|Sonstiges'),features:section(plain,'Ausstattung','Lage|Sonstiges'),location:section(plain,'Lage','Sonstiges|Bei uns in guten Wänden')}};
}
async function existingFreshness(sourceId:number,keys:string[]){
  const out=new Map<string,boolean>();
  for(let i=0;i<keys.length;i+=300){const{data,error}=await db.from('listings').select('source_listing_key,fresh_delivery_eligible').eq('source_id',sourceId).in('source_listing_key',keys.slice(i,i+300));if(error)throw error;for(const row of data||[])out.set(String(row.source_listing_key),row.fresh_delivery_eligible===true)}
  return out;
}

export async function runGcp(source:Source,c:Connector){
  const started=iso();
  try{
    const pages=await Promise.allSettled(DISCOVERY_URLS.map(u=>fetchText(u,undefined,10000)));
    const urls=new Map<string,string>(),discoveryErrors:string[]=[];
    pages.forEach((p,i)=>{if(p.status==='rejected'){discoveryErrors.push(`${DISCOVERY_URLS[i]}: ${p.reason instanceof Error?p.reason.message:String(p.reason)}`);return}for(const x of detailUrls(p.value.text,p.value.url))urls.set(x.key,x.url)});
    if(!urls.size)throw new Error(`GCP discovery found 0 Hamburg listings${discoveryErrors.length?`; ${discoveryErrors.join(' | ')}`:''}`);
    const entries=[...urls.entries()],candidates:Candidate[]=[],detailErrors:string[]=[];
    for(let i=0;i<entries.length;i+=8){const batch=entries.slice(i,i+8),settled=await Promise.allSettled(batch.map(([key,url])=>parseDetail(url,key)));settled.forEach((r,j)=>{if(r.status==='fulfilled'){if(r.value)candidates.push(r.value)}else detailErrors.push(`${batch[j][0]}: ${r.reason instanceof Error?r.reason.message:String(r.reason)}`)})}
    if(!candidates.length)throw new Error(`GCP detail parser accepted 0/${urls.size}${detailErrors.length?`; ${detailErrors.slice(0,3).join(' | ')}`:''}`);
    const keys=candidates.map(x=>String(x.key)),known=await existingFreshness(source.id,keys),hadBaseline=!!source.baseline_completed_at;
    const keepFresh=candidates.filter(x=>known.get(String(x.key))===true),keepBlocked=candidates.filter(x=>known.has(String(x.key))&&known.get(String(x.key))!==true),fresh=candidates.filter(x=>!known.has(String(x.key)));
    const a=keepFresh.length?await upsertCandidates(source,keepFresh,true):{seen:0,fresh:0},b=keepBlocked.length?await upsertCandidates(source,keepBlocked,false):{seen:0,fresh:0},n=fresh.length?await upsertCandidates(source,fresh,hadBaseline):{seen:0,fresh:0};
    const t=iso(),requests=pages.filter(x=>x.status==='fulfilled').length+entries.length;
    await db.from('source_coverage_state').upsert({source_id:source.id,cycle_id:crypto.randomUUID(),strategy:'gcp_official_html',status:'running',cursor:{discovery_urls:DISCOVERY_URLS},expected_count:null,seen_count:candidates.length,request_count:requests,cycle_started_at:started,cycle_finished_at:null,last_complete_at:null,consecutive_errors:0,last_error:detailErrors.length?`${detailErrors.length} detail page errors`:null,updated_at:t});
    await markSuccess(source,started,c,candidates.length,a.fresh+b.fresh+n.fresh,{strategy:'gcp_official_html',discovery_urls:DISCOVERY_URLS,discovered:urls.size,parsed:candidates.length,detail_errors:detailErrors.slice(0,10),discovery_errors:discoveryErrors,complete:false,fresh_delivery_mode:hadBaseline?'new_ids_after_baseline':'baseline_only'});
    if(!hadBaseline)await db.from('sources').update({baseline_completed_at:t,warmed_up:true,coverage_status:'partial',updated_at:t}).eq('id',source.id);
    return{ok:true,source_id:source.id,fetched:candidates.length,new:n.fresh,complete:false,detail_errors:detailErrors.length};
  }catch(e){return markFailure(source,started,e)}
}
