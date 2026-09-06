import {Candidate,Connector,Source,db,deNum,fetchText,hhZip,iso,markFailure,markSuccess,strip,upsertCandidates} from './shared.ts';
const positive=(v:any)=>{const n=deNum(v);return n!=null&&n>0?n:null};
type Page={candidates:Candidate[];keys:string[];page:number;pages:number;total:number};
export function parseCityCatalog(html:string):Page{
  const total=Number(html.match(/id=["']ciwo_result_count["'][^>]*>\s*(\d+)/)?.[1]);
  if(!Number.isInteger(total)||total<0||!html.includes('id="object_list"'))throw new Error('City-Wohnen inventory schema missing');
  const candidates:Candidate[]=[],keys:string[]=[];
  const blocks=[...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>([\s\S]*?)(?=<script[^>]+type=["']application\/ld\+json["']|$)/gi)];
  for(const m of blocks){
    let x:any;try{x=JSON.parse(m[1])}catch{continue}if(x['@type']!=='Apartment')continue;
    const u=new URL(x.url),id=u.pathname.match(/^\/hamburg\/(\d+)-/)?.[1];
    if(u.hostname!=='www.city-wohnen.de'||!id||!m[2].includes(`data-anr="${id}"`))throw new Error('City-Wohnen listing identity mismatch');
    keys.push(id);if(x.address?.addressLocality!=='Hamburg'||!hhZip(x.address?.postalCode))continue;
    const table=m[2].match(/<div class="object_meta">([\s\S]*?)<\/table>/)?.[1]||'',cells=[...table.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(v=>strip(v[1]));
    if(cells.length!==4||cells[3]!==id)throw new Error('City-Wohnen price table mismatch');
    candidates.push({key:id,url:u.href,title:x.name,address:`${x.address.streetAddress}, ${x.address.postalCode} Hamburg`,zip:x.address.postalCode,rooms:positive(x.numberOfRooms),area:positive(x.floorSize?.value),furnished:true,image:x.image,raw:{provider:'city_wohnen_catalog',advertised_monthly_price:positive(cells[0]),price_currency:'EUR',price_components_verified:false}});
  }
  if(!keys.length&&total!==0)throw new Error('City-Wohnen apartments missing');
  if(new Set(keys).size!==keys.length||keys.length>total)throw new Error('City-Wohnen duplicate inventory');
  return {candidates,keys,page:1,pages:Math.max(1,Math.ceil(total/Math.max(1,keys.length))),total};
}
export function parseWunderCatalog(html:string,page:number):Page{
  const encoded=html.match(/<script[^>]+id=["']data-hydrant["'][^>]*>([\s\S]*?)<\/script>/)?.[1];
  if(!encoded)throw new Error('Wunderflats public inventory missing');
  const r=JSON.parse(encoded)?.pageData?.listingResults;
  if(r?.region?.slug!=='hamburg'||r.page!==page-1||!Number.isInteger(r.total)||r.total<0||!Number.isInteger(r.itemsPerPage)||r.itemsPerPage<1||!Array.isArray(r.items))throw new Error('Wunderflats pagination schema invalid');
  if(r.items.length!==Math.min(r.itemsPerPage,Math.max(0,r.total-r.page*r.itemsPerPage)))throw new Error('Wunderflats truncated page');
  const candidates:Candidate[]=[],keys:string[]=[];
  for(const x of r.items){
    if(!/^[a-f0-9]{24}$/.test(x._id))throw new Error('Wunderflats listing identity missing');keys.push(x._id);
    if(x.address?.city!=='Hamburg')continue;
    const href=[...html.matchAll(/href=["']([^"']+)["']/g)].map(m=>m[1]).find(u=>u.includes(`/de/moebliertes-apartment/`)&&u.split('?')[0].endsWith('/'+x._id));
    if(!href)throw new Error('Wunderflats canonical URL missing');
    const u=new URL(href,'https://wunderflats.com');u.search='';
    candidates.push({key:x._id,url:u.href,title:x.title?.de||x.title?.en,address:x.address.street?`${x.address.street}, Hamburg`:'Hamburg',rooms:positive(x.rooms),area:positive(x.area),furnished:true,image:x.images?.[0]?.urls?.original,raw:{provider:'wunderflats_catalog',advertised_monthly_price:x.currency==='EUR'&&Number.isInteger(x.price)&&x.price>0?x.price/100:null,price_currency:x.currency,price_components_verified:false}});
  }
  return {candidates,keys,page,pages:Math.max(1,Math.ceil(r.total/r.itemsPerPage)),total:r.total};
}
export function parseSwapCatalog(html:string,page:number):Page{
  if(!/<link[^>]+href=["']https:\/\/www\.tauschwohnung\.com\/hamburg(?:\?[^"']*)?["'][^>]*rel=["']canonical["']|<link[^>]+rel=["']canonical["'][^>]*href=["']https:\/\/www\.tauschwohnung\.com\/hamburg(?:\?[^"']*)?["']/i.test(html))throw new Error('Tauschwohnung Hamburg scope missing');
  const encoded=html.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/)?.[1];if(!encoded)throw new Error('Tauschwohnung inventory missing');
  const t=JSON.parse(encoded),v=(ref:any)=>Number.isInteger(ref)&&ref>=0?t[ref]:null;
  const records=t.filter((x:any)=>x&&typeof x==='object'&&!Array.isArray(x)&&'offers'in x&&'totalCount'in x&&'perPage'in x);
  if(records.length!==1)throw new Error('Tauschwohnung ambiguous inventory');
  const r=records[0],offers=v(r.offers),total=v(r.totalCount),size=v(r.perPage);
  if(v(r.page)!==page||!Number.isInteger(total)||total<0||!Number.isInteger(size)||size<1||!Array.isArray(offers)||offers.length!==Math.min(size,Math.max(0,total-(page-1)*size)))throw new Error('Tauschwohnung pagination invalid');
  const candidates:Candidate[]=[],keys:string[]=[];
  for(const ref of offers){const h=v(v(ref)?.housing);if(!h||!Number.isInteger(v(h.id)))throw new Error('Tauschwohnung housing missing');const id=String(v(h.id));keys.push(id);const a=v(h.address),geo=v(h.geo),url=v(h.fullURL);
    if(v(h.isActive)!==true||v(geo?.cityName)!=='Hamburg'||!/^https:\/\/www\.tauschwohnung\.com\/wohnung-mieten\/hamburg\//.test(url))continue;
    const zip=v(a?.postalCode);if(!hhZip(zip))continue;
    candidates.push({key:id,url,title:v(h.title),address:[v(a?.street),v(a?.houseNumber),zip,'Hamburg'].filter(Boolean).join(' '),zip,district:v(geo?.directDescendantNameOfCity),cold:v(h.currency)==='€'?positive(v(h.rent)):null,additional:positive(v(h.sideCosts)),rooms:positive(v(h.rooms)),area:positive(v(h.size)),type:'Tauschwohnung',raw:{provider:'tauschwohnung_catalog',is_swap:true}});
  }
  return {candidates,keys,page,pages:Math.max(1,Math.ceil(total/size)),total};
}
export async function runCatalog(source:Source,c:Connector){
  const started=iso(),adapter=String(c.config?.adapter),base=String(c.config?.url||'');
  try{
    const load=async(page:number)=>{const u=new URL(base);if(source.id===10&&page>1)u.pathname=u.pathname.replace(/\/$/,'')+'/'+page;if(source.id===21&&page>1)u.searchParams.set('page',String(page));const r=await fetchText(u.href);return source.id===10?parseWunderCatalog(r.text,page):source.id===21?parseSwapCatalog(r.text,page):parseCityCatalog(r.text)};
    const deadline=Date.now()+25000;const front=await load(1);if(front.pages>1000)throw new Error('Catalog page count exceeds verified budget');
    const {data:st}=await db.from('source_coverage_state').select('cursor').eq('source_id',source.id).maybeSingle().throwOnError();
    const same=st?.cursor?.adapter===adapter&&st?.cursor?.url===base,old=same?st.cursor:{},warmed=old.baseline_done===true;
    let next=Number(old.next_page||2);const seen=new Set<string>(Array.isArray(old.seen_ids)?old.seen_ids:[]),pages=[front],errors:any[]=[];front.keys.forEach(k=>seen.add(k));
    // City-Wohnen's AJAX paging has not passed transport verification yet.
    const firstNext=next;if(source.id!==17)for(let start=next;start<=Math.min(front.pages,firstNext+31)&&Date.now()<deadline;start+=4){
      const batch=Array.from({length:Math.min(4,front.pages-start+1,firstNext+32-start)},(_,i)=>start+i);
      const results=await Promise.allSettled(batch.map(load));
      for(let i=0;i<results.length;i++){const result=results[i];if(result.status==='fulfilled'&&result.value.total===front.total&&result.value.pages===front.pages){pages.push(result.value);result.value.keys.forEach(k=>seen.add(k))}else errors.push({page:batch[i],error:String(result.status==='rejected'?result.reason:'inventory total changed').slice(0,250)})}
      if(errors.length)break;next=batch.at(-1)!+1;
    }
    const traversed=source.id===17?front.pages===1:next>front.pages,complete=traversed&&!errors.length&&seen.size===front.total;
    const rows=new Map<string,Candidate>();for(const page of pages)for(const row of page.candidates)rows.set(String(row.key),{...row,raw:{...row.raw,catalog_baseline_verified:warmed}});
    const saved=await upsertCandidates(source,[...rows.values()],warmed&&!!source.baseline_completed_at);
    await db.from('source_coverage_state').upsert({source_id:source.id,cycle_id:crypto.randomUUID(),strategy:'public_catalog',status:complete?'complete':'running',cursor:{adapter,url:base,next_page:traversed?2:next,seen_ids:traversed?[]:[...seen],baseline_done:warmed||complete},seen_count:seen.size,request_count:pages.length+errors.length,cycle_started_at:started,cycle_finished_at:complete?iso():null,last_complete_at:complete?iso():null,updated_at:iso(),last_error:errors.length?JSON.stringify(errors):null}).throwOnError();
    await markSuccess(source,started,c,rows.size,saved.fresh,{adapter,complete,reported_total:front.total,enumerated:seen.size,pages_total:front.pages,pages_checked:pages.length,coverage_errors:errors,baseline_verified:warmed,freshness_mode:'new_id_after_complete_route_baseline',outcome:complete?'success_with_listing':'partial_inventory'});
    return {ok:true,source_id:source.id,fetched:rows.size,new:saved.fresh,complete};
  }catch(e){return markFailure(source,started,e)}
}
