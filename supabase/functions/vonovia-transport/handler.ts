// The same handler serves direct worker calls and the compatibility endpoint.
export async function handle(request: Request): Promise<Response> {
  // Cancel every provider request when the caller's deadline expires.
  const fetch = (input: RequestInfo | URL, init: RequestInit = {}) => globalThis.fetch(input, {
    ...init, signal: AbortSignal.any([request.signal, ...(init.signal ? [init.signal] : [])]),
  });

const UA="Mozilla/5.0 (compatible; TraumwohnungHamburgBot/13.0; +https://traumwohnung-hamburg.de)";
const PROVIDER="Vonovia Kundenservice GmbH";
const AREAS=[
  "https://www.immowelt.de/suche/mieten/wohnung/hamburg/hamburg-20095/ad08de1113",
  "https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/altona-22589/ad09de70",
  "https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/bergedorf-21035/ad09de74",
  "https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/eimsbuttel-22457/ad09de71",
  "https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/harburg-21077/ad09de75",
  "https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/mitte-22119/ad09de69",
  "https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/nord-22415/ad09de72",
  "https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/wandsbek-22159/ad09de73"
];
function decode(s:string){return s.replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&sup2;|&#178;/gi,"²").replace(/&euro;|&#8364;/gi,"€").replace(/&auml;/gi,"ä").replace(/&ouml;/gi,"ö").replace(/&uuml;/gi,"ü").replace(/&szlig;/gi,"ß")}
function strip(h:string){return decode(h).replace(/<script\b[\s\S]*?<\/script>/gi," ").replace(/<style\b[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()}
function num(v:string|undefined){if(!v)return null;let s=v.replace(/\s/g,"").replace(/[^\d.,-]/g,"");if(!s)return null;if(s.includes(","))s=s.replace(/\./g,"").replace(",",".");else if(/^\d{1,3}\.\d{3}$/.test(s))s=s.replace(".","");const n=Number(s);return Number.isFinite(n)?n:null}
function cleanImage(raw:string|undefined,base:string){if(!raw)return null;try{const u=new URL(decode(raw.split(/\s+/)[0]),base).href;if(/\.svg(?:[?#]|$)|(?:logo|favicon|sprite|spinner|placeholder|avatar)/i.test(u))return null;return u}catch{return null}}
function firstImage(html:string,base:string){for(const m of html.matchAll(/<img\b[^>]*(?:data-src|src)=["']([^"']+)["'][^>]*>/gi)){const u=cleanImage(m[1],base);if(u)return u}return null}
function parseCards(html:string,base:string){const out:any[]=[];for(const chunk of html.split('<div id="classified-card-').slice(1)){if(!chunk.includes(PROVIDER))continue;const link=chunk.match(/<a\b[^>]*href=["']([^"']*\/expose\/[^"']+)["'][^>]*>/i);if(!link)continue;let url:string;try{url=new URL(decode(link[1]),base).href.replace(/#.*$/,"")}catch{continue}const id=url.match(/\/expose\/([0-9a-f-]{36})/i)?.[1];if(!id)continue;const plain=strip(chunk).slice(0,10000);const titleAttr=decode(link[0].match(/\btitle=["']([^"']+)["']/i)?.[1]||"").trim();const alt=[...chunk.matchAll(/<img\b[^>]*alt=["']([^"']+)["'][^>]*>/gi)].map(x=>decode(x[1])).find(x=>/€/.test(x)&&/(Zimmer|m²|Wohnung|Apartment)/i.test(x))||"";const title=(titleAttr||alt||plain.match(/(?:Neu\s+)?(.{8,180}?)\s+[\d.]+(?:,\d+)?\s*€/i)?.[1]||"Vonovia Wohnungsangebot").slice(0,240);const zipCode=plain.match(/\b(2\d{4})\s+Hamburg\b/i)?.[1]||plain.match(/\b(2\d{4})\b/)?.[1]||null;const coldRent=num(plain.match(/([\d.]+(?:,\d{1,2})?)\s*€\s*(?:Kaltmiete|Nettokaltmiete|Miete\s*zzgl)/i)?.[1]||plain.match(/([\d.]+(?:,\d{1,2})?)\s*€/i)?.[1]);const rooms=num(plain.match(/([\d.,]+)\s*(?:Zimmer|Zi\.?)/i)?.[1]);const size=num(plain.match(/([\d.,]+)\s*m(?:²|2)/i)?.[1]);out.push({id,url,title,zipCode,coldRent,rooms,size,imageUrl:firstImage(chunk,base),provider:PROVIDER,nativeNew:/data-testid=["']cardmfe-tag-testid-new["']/i.test(chunk)})}return out}
async function load(url:string){const r=await fetch(url,{redirect:"follow",headers:{"user-agent":UA,"accept":"text/html,application/xhtml+xml,*/*","accept-language":"de-DE,de;q=0.9","cache-control":"no-cache"},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);return{text:await r.text(),url:r.url}}

return await (async(req:Request)=>{if(req.method!=="GET")return new Response("method not allowed",{status:405});const settled=await Promise.allSettled(AREAS.map(load));const errors:string[]=[],map=new Map<string,any>();settled.forEach((r,i)=>{if(r.status==="rejected"){errors.push(`${i}:${r.reason instanceof Error?r.reason.message:String(r.reason)}`);return}for(const item of parseCards(r.value.text,r.value.url))map.set(item.id,item)});const items=[...map.values()];if(!items.length)return Response.json({ok:false,provider:PROVIDER,count:0,pagesOk:settled.length-errors.length,pagesFailed:errors.length,errors},{status:502});return Response.json({ok:true,provider:PROVIDER,count:items.length,pagesOk:settled.length-errors.length,pagesFailed:errors.length,errors,items},{headers:{"cache-control":"no-store"}})})(request);
}
