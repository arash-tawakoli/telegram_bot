import {inflateRawSync} from 'node:zlib';
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
  const canonicalTag=html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i)?.[0];
  const canonical=canonicalTag?.match(/\bhref=["']([^"']+)["']/i)?.[1];
  if(canonical&&!/^https:\/\/www\.tauschwohnung\.com\/hamburg(?:\?[^#]*)?$/.test(canonical))throw new Error('Tauschwohnung Hamburg scope missing');
  const encoded=html.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/)?.[1];if(!encoded)throw new Error('Tauschwohnung inventory missing');
  const t=JSON.parse(encoded),v=(ref:any)=>Number.isInteger(ref)&&ref>=0?t[ref]:null;
  const records=t.filter((x:any)=>x&&typeof x==='object'&&!Array.isArray(x)&&'offers'in x&&'totalCount'in x&&'perPage'in x);
  if(records.length!==1)throw new Error('Tauschwohnung ambiguous inventory');
  const r=records[0],offers=v(r.offers),total=v(r.totalCount),size=v(r.perPage);
  if(!canonical&&v(r.canonicalPath)!=='/hamburg')throw new Error('Tauschwohnung Hamburg scope missing');
  if(v(r.page)!==page||!Number.isInteger(total)||total<0||!Number.isInteger(size)||size<1||!Array.isArray(offers)||offers.length!==Math.min(size,Math.max(0,total-(page-1)*size)))throw new Error('Tauschwohnung pagination invalid');
  const candidates:Candidate[]=[],keys:string[]=[];
  for(const ref of offers){const h=v(v(ref)?.housing);if(!h||!Number.isInteger(v(h.id)))throw new Error('Tauschwohnung housing missing');const id=String(v(h.id));keys.push(id);const a=v(h.address),geo=v(h.geo),url=v(h.fullURL);
    if(v(h.isActive)!==true||v(geo?.cityName)!=='Hamburg'||!(new RegExp('^https://www\\.tauschwohnung\\.com/(?:wohnung-mieten/hamburg/[^?#]+|expose/'+id+')$')).test(url))continue;
    const zip=v(a?.postalCode);if(!hhZip(zip))continue;
    candidates.push({key:id,url,title:v(h.title),address:[v(a?.street),v(a?.houseNumber),zip,'Hamburg'].filter(Boolean).join(' '),zip,district:v(geo?.directDescendantNameOfCity),cold:v(h.currency)==='€'?positive(v(h.rent)):null,additional:positive(v(h.sideCosts)),rooms:positive(v(h.rooms)),area:positive(v(h.size)),type:'Tauschwohnung',raw:{provider:'tauschwohnung_catalog',is_swap:true}});
  }
  return {candidates,keys,page,pages:Math.max(1,Math.ceil(total/size)),total};
}
// This endpoint sends raw DEFLATE even when identity encoding is requested.
// Accept already-decoded JSON first; never try to interpret arbitrary HTML as inventory.
export async function decodeCityResponse(bytes:Uint8Array){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(inflateRawSync(bytes,{maxOutputLength:5000000})));
}
export function parseCityAjax(data:any,page:number,expectedTotal:number,size:number):Page{
  if(!data||!Number.isInteger(data.total)||data.total!==expectedTotal||typeof data.results!=='string'||typeof data.pager!=='string')throw new Error('City-Wohnen AJAX inventory invalid');
  const current=Number(data.pager.match(/<li>\s*<span>(\d+)<\/span>\s*<\/li>/)?.[1]);
  if(current!==page)throw new Error('City-Wohnen AJAX page mismatch');
  const parsed=parseCityCatalog(`<span id="ciwo_result_count">${data.total}</span><div id="object_list">${data.results}</div>`);
  if(parsed.keys.length!==Math.min(size,Math.max(0,data.total-(page-1)*size)))throw new Error('City-Wohnen truncated AJAX page');
  return {...parsed,page,pages:Math.max(1,Math.ceil(data.total/size))};
}
export async function runCatalog(source:Source,c:Connector){
  const started=iso(),adapter=String(c.config?.adapter),base=String(c.config?.url||'');
  try{
    const load=async(page:number):Promise<Page>=>{const u=new URL(base);if(source.id===10&&page>1)u.pathname=u.pathname.replace(/\/$/,'')+'/'+page;if(source.id===21&&page>1)u.searchParams.set('page',String(page));
      if(source.id===17&&page>1){
        const ajax=new URL('/rpc.php',base);ajax.search=new URLSearchParams({service:'ciwo',cmd:'search',action:'objectlist',pageid:'9',pagenr:String(page),pagesize:String(front.keys.length),lang:'deu'}).toString();
        const response=await fetch(ajax.href,{headers:{accept:'application/json','accept-encoding':'identity'},signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw new Error(`City-Wohnen HTTP ${response.status}`);
        return parseCityAjax(await decodeCityResponse(new Uint8Array(await response.arrayBuffer())),page,front.total,front.keys.length);
      }
      const r=await fetchText(u.href);return source.id===10?parseWunderCatalog(r.text,page):source.id===21?parseSwapCatalog(r.text,page):parseCityCatalog(r.text)};
    const deadline=Date.now()+25000;const front=await load(1);if(front.pages>1000)throw new Error('Catalog page count exceeds verified budget');
    const {data:st}=await db.from('source_coverage_state').select('cursor').eq('source_id',source.id).maybeSingle().throwOnError();
    const same=st?.cursor?.adapter===adapter&&st?.cursor?.url===base,old=same?st.cursor:{},warmed=old.baseline_done===true&&old.parser_revision==='2026-09-08-v2';
    let next=Number(warmed?old.next_page||2:old.parser_revision==='2026-09-08-v2'?old.next_page||2:2);const seen=new Set<string>(old.parser_revision==='2026-09-08-v2'&&Array.isArray(old.seen_ids)?old.seen_ids:[]),pages=[front],errors:any[]=[];front.keys.forEach(k=>seen.add(k));
    const firstNext=next;for(let start=next;start<=Math.min(front.pages,firstNext+31)&&Date.now()<deadline;start+=4){
      const batch=Array.from({length:Math.min(4,front.pages-start+1,firstNext+32-start)},(_,i)=>start+i);
      const results=await Promise.allSettled(batch.map(load));
      for(let i=0;i<results.length;i++){const result=results[i];if(result.status==='fulfilled'&&result.value.total===front.total&&result.value.pages===front.pages){pages.push(result.value);result.value.keys.forEach(k=>seen.add(k))}else errors.push({page:batch[i],error:String(result.status==='rejected'?result.reason:'inventory total changed').slice(0,250)})}
      if(errors.length)break;next=batch.at(-1)!+1;
    }
    const traversed=next>front.pages,complete=traversed&&!errors.length&&seen.size===front.total;
    const rows=new Map<string,Candidate>();for(const page of pages)for(const row of page.candidates)rows.set(String(row.key),{...row,raw:{...row.raw,catalog_baseline_verified:warmed&&source.id!==21}});
    const saved=await upsertCandidates(source,[...rows.values()],warmed&&source.id!==21&&!!source.baseline_completed_at);
    await db.from('source_coverage_state').upsert({source_id:source.id,cycle_id:crypto.randomUUID(),strategy:'public_catalog',status:complete?'complete':'running',cursor:{adapter,url:base,parser_revision:'2026-09-08-v2',next_page:traversed?2:next,seen_ids:traversed?[]:[...seen],baseline_done:warmed||complete},seen_count:seen.size,request_count:pages.length+errors.length,cycle_started_at:started,cycle_finished_at:complete?iso():null,last_complete_at:complete?iso():null,updated_at:iso(),last_error:errors.length?JSON.stringify(errors):null}).throwOnError();
    await markSuccess(source,started,c,rows.size,saved.fresh,{adapter,complete,reported_total:front.total,enumerated:seen.size,pages_total:front.pages,pages_checked:pages.length,coverage_errors:errors,baseline_verified:warmed,freshness_mode:source.id===21?'publication_time_unverified_no_delivery':'new_id_after_complete_route_baseline',outcome:complete?'success_with_listing':'partial_inventory'});
    return {ok:true,source_id:source.id,fetched:rows.size,new:saved.fresh,complete};
  }catch(e){return markFailure(source,started,e)}
}
