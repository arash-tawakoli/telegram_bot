import { HH_ZIPS } from "../_shared/hamburg.ts";
// The same handler serves direct worker calls and the compatibility endpoint.
export async function handle(request: Request): Promise<Response> {
  // Cancel every provider request when the caller's deadline expires.
  const fetch = (input: RequestInfo | URL, init: RequestInit = {}) => globalThis.fetch(input, {
    ...init, signal: AbortSignal.any([request.signal, ...(init.signal ? [init.signal] : [])]),
  });

const UA="Mozilla/5.0 (compatible; TraumwohnungHamburgBot/13.0; +https://traumwonunghamburg.de)";
const SEARCH_URL='https://www.meravis.de/mieten/wohnungssuche/';

async function get(url:string){const r=await fetch(url,{redirect:'follow',headers:{'user-agent':UA,'accept':'text/html,*/*','accept-language':'de-DE,de;q=0.9','cache-control':'no-cache'},signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);return{text:await r.text(),url:r.url}}
function dec(s:string){return s.replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&euro;|&#8364;/gi,'€').replace(/&auml;/gi,'ä').replace(/&ouml;/gi,'ö').replace(/&uuml;/gi,'ü').replace(/&szlig;/gi,'ß')}
function strip(h:string){return dec(h).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function money(v:string|null|undefined){if(!v)return null;let s=v.replace(/\s/g,'').replace(/[^\d.,-]/g,'');if(!s)return null;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');const n=Number(s);return Number.isFinite(n)?n:null}
function num(v:string|null|undefined){if(!v)return null;const n=Number(v.replace(',','.'));return Number.isFinite(n)?n:null}
function abs(base:string,href:string){const v=dec(href);try{return v.startsWith('/')?`https://www.meravis.de${v}`:new URL(v,base).href}catch{return null}}

return await (async req=>{try{if(req.method!=='GET')return new Response('method not allowed',{status:405});const r=await get(SEARCH_URL),entries:any[]=[];for(const seg of r.text.split('<div class="immo-list-teaser">').slice(1)){const card=seg.split('</a>')[0]||'';const href=card.match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1]||'',id=href.match(/apartmentRent%5D=(\d+)/i)?.[1];if(!id)continue;const title=strip(card.match(/<span class="h3">([\s\S]*?)<\/span>/i)?.[1]||'')||`meravis Wohnung ${id}`,addr=strip(card.match(/<div class="immo-list-teaser-text">[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1]||''),am=addr.match(/^(.*?),\s*(2\d{4})\s+Hamburg$/i),street=am?.[1]?.trim()||null,zip=am?.[2]||null;if(!zip||!HH_ZIPS.has(zip))continue;const info=strip(card.match(/<span class="immo-info">([\s\S]*?)<\/span>\s*<\/span>?/i)?.[1]||card),warm=money(info.match(/([\d.]+,\d{2})\s*€\s*Gesamtmiete/i)?.[1]),area=num(info.match(/([\d.,]+)\s*m\s*2\s*Wohnfläche/i)?.[1]||info.match(/([\d.,]+)\s*m²\s*Wohnfläche/i)?.[1]),rooms=num(info.match(/([\d.,]+)\s*Zimmer/i)?.[1]);if(warm==null||area==null||rooms==null)continue;const img=card.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1];entries.push({id,url:abs(r.url,href),title,streetAddress:street,postalCode:zip,addressLocality:'Hamburg',warmRent:warm,rooms,area,provider:'meravis',apartment_id:Number(id),imageUrl:img?abs(r.url,img):null})}return Response.json({source_id:48,entries,count:entries.length,complete:true})}catch(e){return Response.json({error:e instanceof Error?e.message:String(e)},{status:500})}})(request);
}
