import {Candidate, Connector, Source, db, fetchText, iso, markFailure, markSuccess, upsertCandidates} from './shared.ts';

export const NESTPICK_URL='https://www.nestpick.com/search/api/?city=hamburg&location=101748841&currency=EUR&order=relevance';
const positive=(v:unknown)=>v!==null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
export function parseNestpickPage(text:string, page:number) {
  const body=JSON.parse(text),p=body.pages;
  if(!Array.isArray(body.items)||!p||p.page!==page||!Number.isInteger(p.total_items)||p.total_items<0||!Number.isInteger(p.total_pages)||p.total_pages<1||p.total_pages>30||!Number.isInteger(p.limit)||p.limit<1||p.total_pages!==Math.max(1,Math.ceil(p.total_items/p.limit)))throw new Error('Nestpick pagination schema invalid');
  if(body.items.length!==Math.min(p.limit,Math.max(0,p.total_items-(page-1)*p.limit)))throw new Error('Nestpick truncated page');
  const ids:string[]=[],candidates:Candidate[]=[];
  for(const x of body.items){
    if(!/^\d+$/.test(String(x.id)))throw new Error('Nestpick listing identity missing');
    ids.push(String(x.id));
    // Sponsored placements are a separate API collection and are never inventory.
    if(x.city?.code!=='hamburg'||!['apartment','studio','room'].includes(x.category))continue;
    if(!x.name||x.property_details_url!==`/pick/${x.id}/`)throw new Error('Nestpick listing schema invalid');
    const price=x.price?.currency==='EUR'?positive(x.price.price):null;
    candidates.push({key:String(x.id),url:`https://www.nestpick.com/pick/${x.id}/`,title:x.name,address:x.address||'Hamburg',area:positive(x.apartment_size),type:x.category==='room'?'WG':'Wohnung',image:x.photos?.find((v:any)=>v.main)?.thumbnail,
      // Bedrooms are not total rooms; a card price does not establish warm/cold rent.
      raw:{provider:'nestpick_public_api',native_new:Array.isArray(x.history)&&x.history.some((h:any)=>h.new===true),advertised_monthly_price:price,price_currency:price?'EUR':null,price_components_verified:false,bedrooms:positive(x.number_of_bedrooms),partner:x.provider?.code||null,address:typeof x.address==='string'?x.address:null,available_from:typeof x.available_from==='string'?x.available_from:typeof x.availableFrom==='string'?x.availableFrom:null,minimum_stay:x.minimum_stay??x.minimumStay??x.minimum_rental_duration??null,amenities:Array.isArray(x.amenities)?x.amenities:null,furnished:typeof x.furnished==='boolean'?x.furnished:null,district:x.neighborhood?.name??x.district?.name??null}});
  }
  return {candidates,ids,pages:p.total_pages,total:p.total_items,limit:p.limit};
}
export async function collectNestpick(fetchPage:(page:number)=>Promise<string>) {
  const first=parseNestpickPage(await fetchPage(1),1),pages=[first];
  for(let start=2;start<=first.pages;start+=4){
    const batch=await Promise.all(Array.from({length:Math.min(4,first.pages-start+1)},(_,i)=>start+i).map(async page=>parseNestpickPage(await fetchPage(page),page)));
    for(const p of batch)if(p.pages!==first.pages||p.total!==first.total||p.limit!==first.limit)throw new Error('Nestpick inventory changed during pagination');
    pages.push(...batch);
  }
  const ids=new Set(pages.flatMap(p=>p.ids)),rows=new Map<string,Candidate>();
  for(const c of pages.flatMap(p=>p.candidates)){
    const old=rows.get(String(c.key));
    if(old)c.raw.native_new=old.raw?.native_new===true&&c.raw.native_new===true;
    rows.set(String(c.key),c);
  }
  return {candidates:[...rows.values()],enumerated:ids.size,total:first.total,requests:pages.length,complete:ids.size===first.total};
}
export async function runNestpick(source:Source,connector:Connector){
  const started=iso(),adapter='source-worker/nestpick-public';
  try{
    const parsed=await collectNestpick(async page=>(await fetchText(`${NESTPICK_URL}&page=${page}`,'application/json',8000)).text);
    const {data:state}=await db.from('source_coverage_state').select('cursor').eq('source_id',source.id).maybeSingle().throwOnError();
    const warmed=!!source.baseline_completed_at&&state?.cursor?.adapter===adapter&&state?.cursor?.url===NESTPICK_URL;
    const fresh=parsed.candidates.filter(c=>warmed&&c.raw?.native_new===true),blocked=parsed.candidates.filter(c=>!fresh.includes(c));
    const a=await upsertCandidates(source,fresh,true),b=await upsertCandidates(source,blocked,false);
    // Relevance pagination can repeat IDs: an absent ID is not proof of removal.
    await db.from('source_coverage_state').upsert({source_id:source.id,cycle_id:crypto.randomUUID(),strategy:'verified_public_inventory',status:parsed.complete?'complete':'running',cursor:{adapter,url:NESTPICK_URL},seen_count:parsed.enumerated,request_count:parsed.requests,cycle_started_at:started,cycle_finished_at:parsed.complete?iso():null,last_complete_at:parsed.complete?iso():null,updated_at:iso(),last_error:null}).throwOnError();
    await markSuccess(source,started,connector,parsed.candidates.length,a.fresh+b.fresh,{adapter,complete:parsed.complete,enumerated:parsed.enumerated,reported_total:parsed.total,request_count:parsed.requests,fallback_warmed:warmed,price_components_verified:false});
    return {ok:true,source_id:source.id,fetched:parsed.candidates.length,new:a.fresh,complete:parsed.complete};
  }catch(error){return markFailure(source,started,error);}
}
