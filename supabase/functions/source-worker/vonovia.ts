import {Candidate,Connector,Source,absolute,db,fetchText,imageFromHtml,iso,markFailure,markSuccess,parseFields,strip,upsertCandidates} from './shared.ts';

const AREAS=[
  'https://www.immowelt.de/suche/mieten/wohnung/hamburg/hamburg-20095/ad08de1113',
  'https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/altona-22589/ad09de70',
  'https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/bergedorf-21035/ad09de74',
  'https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/eimsbuttel-22457/ad09de71',
  'https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/harburg-21077/ad09de75',
  'https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/mitte-22119/ad09de69',
  'https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/nord-22415/ad09de72',
  'https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/wandsbek-22159/ad09de73'
];
const STRATEGY='vonovia_immowelt_provider_mirror_v1';
const PROVIDER='Vonovia Kundenservice GmbH';
const MIRROR:Connector={priority:1,label:'Immowelt Vonovia Provider Mirror',connector_kind:'html_discovery',enumerable:false,shadow_only:false,config:{provider:PROVIDER}};

function cards(html:string,base:string){
  const out:Candidate[]=[];
  for(const v of html.split('<div id="classified-card-').slice(1)){
    const text=strip(v).slice(0,10000);
    if(!text.includes(PROVIDER))continue;
    const link=v.match(/<a\b[^>]*href=["']([^"']*\/expose\/[^"']+)["'][^>]*>/i);
    if(!link)continue;
    const url=absolute(base,link[1]);
    if(!url)continue;
    const key=url.match(/\/expose\/([0-9a-f-]{36})/i)?.[1]||undefined;
    const titleAttr=link[0].match(/\btitle=["']([^"']+)["']/i)?.[1]||'';
    const imgAlt=[...v.matchAll(/<img\b[^>]*alt=["']([^"']+)["'][^>]*>/gi)].map(x=>x[1]).find(x=>/€/.test(x)&&/(Zimmer|m²|Wohnung|Apartment)/i.test(x))||'';
    const f=parseFields(`${titleAttr} ${imgAlt} ${text}`);
    const title=(titleAttr||imgAlt||text.match(/(?:Neu\s+)?(.{8,180}?)\s+[\d.]+(?:,\d+)?\s*€/)?.[1]||'Vonovia Wohnungsangebot').slice(0,240);
    out.push({key,url,title,zip:f.zip,warm:f.warm,cold:f.cold,additional:f.additional,operating:f.operating,heating:f.heating,deposit:f.deposit,rooms:f.rooms,area:f.area,wbs:f.wbs,furnished:f.furnished,image:imageFromHtml(v,base),raw:{provider:'immowelt_vonovia_mirror',provider_name:PROVIDER,native_new:/data-testid=["']cardmfe-tag-testid-new["']/i.test(v),text:text.slice(0,3000)}});
  }
  return out;
}

async function upsertMirror(source:Source,cands:Candidate[],allowNew:boolean){
  if(!cands.length)return{seen:0,fresh:0,newEligible:0};
  const keys=[...new Set(cands.map(c=>String(c.key||c.url.split('/').filter(Boolean).at(-1)||'')).filter(Boolean))],existing=new Map<string,boolean>();
  for(let i=0;i<keys.length;i+=300){
    const{data,error}=await db.from('listings').select('source_listing_key,fresh_delivery_eligible').eq('source_id',source.id).in('source_listing_key',keys.slice(i,i+300));
    if(error)throw error;
    for(const x of data||[])existing.set(String(x.source_listing_key),x.fresh_delivery_eligible===true);
  }
  const oldTrue:Candidate[]=[],oldFalse:Candidate[]=[],fresh:Candidate[]=[];
  for(const c of cands){const k=String(c.key||c.url.split('/').filter(Boolean).at(-1)||'');if(existing.has(k))(existing.get(k)?oldTrue:oldFalse).push(c);else fresh.push(c)}
  const a=oldTrue.length?await upsertCandidates(source,oldTrue,true):{seen:0,fresh:0};
  const b=oldFalse.length?await upsertCandidates(source,oldFalse,false):{seen:0,fresh:0};
  const n=fresh.length?await upsertCandidates(source,fresh,allowNew):{seen:0,fresh:0};
  return{seen:a.seen+b.seen+n.seen,fresh:a.fresh+b.fresh+n.fresh,newEligible:allowNew?n.fresh:0};
}

export async function runVonovia(source:Source){
  const started=iso();
  try{
    const{data:state}=await db.from('source_coverage_state').select('*').eq('source_id',source.id).maybeSingle();
    const warmed=state?.strategy===STRATEGY&&Number(state?.cursor?.v||0)===1&&state?.cursor?.baseline_done===true;
    const rs=await Promise.all(AREAS.map(u=>fetchText(u)));
    const map=new Map<string,Candidate>();
    for(const r of rs)for(const c of cards(r.text,r.url))map.set(String(c.key||c.url),c);
    const cands=[...map.values()];
    if(!cands.length)throw new Error('Vonovia provider mirror returned no verified Hamburg listings');
    const saved=await upsertMirror(source,cands,warmed&&!!source.baseline_completed_at),t=iso(),cycle=crypto.randomUUID();
    await db.from('source_coverage_state').upsert({source_id:source.id,cycle_id:cycle,strategy:STRATEGY,status:'running',cursor:{v:1,baseline_done:true},cycle_started_at:started,cycle_finished_at:t,last_complete_at:t,seen_count:cands.length,request_count:AREAS.length,consecutive_errors:0,backoff_until:null,last_error:null,updated_at:t});
    await markSuccess(source,started,MIRROR,cands.length,saved.fresh,{strategy:STRATEGY,provider:PROVIDER,pages_checked:AREAS.length,mirror_baseline_was_done:warmed,new_eligible:saved.newEligible,fresh_delivery_mode:warmed?'new_only':'warmup',complete:false});
    return{ok:true,source_id:source.id,fetched:cands.length,new:saved.fresh,new_eligible:saved.newEligible,warmed,complete:false};
  }catch(e){return markFailure(source,started,e)}
}
