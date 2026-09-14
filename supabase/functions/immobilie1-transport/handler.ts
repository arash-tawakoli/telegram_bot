import { HH_ZIPS } from "../_shared/hamburg.ts";
// The same handler serves direct worker calls and the compatibility endpoint.
export async function handle(request: Request): Promise<Response> {
  // Cancel every provider request when the caller's deadline expires.
  const fetch = (input: RequestInfo | URL, init: RequestInit = {}) => globalThis.fetch(input, {
    ...init, signal: AbortSignal.any([request.signal, ...(init.signal ? [init.signal] : [])]),
  });

const UA="Mozilla/5.0 (compatible; TraumwohnungHamburgBot/13.0; +https://traumwohnung-hamburg.de)";
const BASE="https://www.immobilie1.de/immobilien/hamburg/hamburg/wohnung/mieten";


function decode(s:string){return s.replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&sup2;|&#178;/gi,'²').replace(/&euro;|&#8364;/gi,'€').replace(/&auml;/gi,'ä').replace(/&ouml;/gi,'ö').replace(/&uuml;/gi,'ü').replace(/&szlig;/gi,'ß')}
function strip(h:string){return decode(h).replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function num(v:string|undefined){if(!v)return null;let s=v.replace(/\s/g,'').replace(/[^\d.,-]/g,'');if(!s)return null;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');else if(/^\d{1,3}\.\d{3}$/.test(s))s=s.replace('.','');const n=Number(s);return Number.isFinite(n)?n:null}
function image(card:string){const m=card.match(/<(?:img|source)\b[^>]*(?:src|srcset)=["']([^"']+)["']/i);return m?.[1]||null}
function parse(html:string){const out:any[]=[],seen=new Set<string>();for(const m of html.matchAll(/<a\b[^>]*href=["'](https:\/\/www\.immobilie1\.de\/([^"']*-[0-9]{8}))["'][^>]*>([\s\S]*?)<\/a>/gi)){const url=m[1],slug=m[2];if(seen.has(slug))continue;const zipCode=slug.match(/^(\d{5})-/)?.[1]||null;if(!zipCode||!HH_ZIPS.has(zipCode))continue;const card=m[0],plain=strip(card).slice(0,14000),title=decode(card.match(/\btitle=["']([^"']+)["']/i)?.[1]||'Wohnungsangebot').slice(0,240),coldRent=num(plain.match(/([\d.]+(?:,\d{1,2})?)\s*€\s*Miete\s*zzgl\.?\s*(?:NK|Nebenkosten)/i)?.[1]),rooms=num(plain.match(/([\d.,]+)\s*Zimmer/i)?.[1]),size=num(plain.match(/([\d.,]+)\s*m(?:²|2)\s*Wohnfläche/i)?.[1]||plain.match(/Wohnfläche\s*([\d.,]+)\s*m(?:²|2)/i)?.[1]);if(rooms==null&&size==null&&coldRent==null)continue;out.push({id:slug,url,title,zipCode,coldRent,rooms,size,imageUrl:image(card),provider:'immobilie1.de'});seen.add(slug)}return out}
async function load(page:number){const url=page===1?BASE:`${BASE}?page=${page}`;const r=await fetch(url,{redirect:'follow',headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml,*/*','accept-language':'de-DE,de;q=0.9','cache-control':'no-cache'},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`HTTP ${r.status} page ${page}`);return{text:await r.text(),url:r.url}}


return await (async(req:Request)=>{if(req.method!=='GET')return new Response('method not allowed',{status:405});try{const first=await load(1),total=Number(first.text.match(/&quot;total&quot;:(\d+)/)?.[1]||0),lastPage=Number(first.text.match(/&quot;last_page&quot;:(\d+)/)?.[1]||0);if(!total||!lastPage)throw new Error('immobilie1 pagination metadata missing');const map=new Map<string,any>();for(const item of parse(first.text))map.set(item.id,item);for(let start=2;start<=lastPage;start+=3){const batch=await Promise.all(Array.from({length:Math.min(3,lastPage-start+1)},(_,i)=>load(start+i)));for(const page of batch)for(const item of parse(page.text))map.set(item.id,item);}const items=[...map.values()];if(items.length!==total)throw new Error(`immobilie1 incomplete snapshot ${items.length}/${total}`);return Response.json({ok:true,provider:'immobilie1.de',mode:'full_snapshot',count:items.length,total,lastPage,items},{headers:{'cache-control':'no-store'}})}catch(e){return Response.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:502})}})(request);
}
