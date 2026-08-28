import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const ADMIN_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, ADMIN_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const UA = "Mozilla/5.0 (compatible; TraumwohnungHamburgBot/3.0; +https://traumwohnunghamburg.de)";
const ORIGIN = "https://www.bve.de";
const DEFAULT_ENDPOINT = `${ORIGIN}/Umbraco/Surface/BVEData/GetMapMarkersForWohnungsangebote?wohnanlageBaseUrl=%2Fwohnen-beim-bve%2Fwohnungsbestand%2Fwohnungsangebote%2Fwohnungsangebot%2F&mapsMarkerIconUrl=%2FWebsite%2FHtmlMedia%2Fimg%2Fic_maps_marker.png`;

type Marker = { title?: string; latitude?: number; longitude?: number; iconUrl?: string; infoWindowContent?: string };

async function secret(name:string){
  const {data,error}=await db.rpc("get_bot_secret",{secret_name:name});
  if(error||!data) throw new Error(`secret ${name} unavailable`);
  return String(data);
}
function decodeHtml(s:string){return s.replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&sup2;|&#178;/gi,"²").replace(/&euro;|&#8364;/gi,"€").replace(/&auml;/gi,"ä").replace(/&ouml;/gi,"ö").replace(/&uuml;/gi,"ü").replace(/&Auml;/g,"Ä").replace(/&Ouml;/g,"Ö").replace(/&Uuml;/g,"Ü").replace(/&szlig;/gi,"ß")}
function stripHtml(html:string){return decodeHtml(html).replace(/<script\b[\s\S]*?<\/script>/gi," ").replace(/<style\b[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?>/gi," ").replace(/<\/p>|<\/div>|<\/li>|<\/article>|<\/h\d>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()}
function deNum(v:string|number|null|undefined):number|null{if(v==null)return null;if(typeof v==="number")return Number.isFinite(v)?v:null;let s=v.trim().replace(/\s/g,"").replace(/[€]/g,"").replace(/[^\d.,-]/g,"");if(!s)return null;if(s.includes(","))s=s.replace(/\./g,"").replace(",",".");else if((s.match(/\./g)||[]).length>1)s=s.replace(/\./g,"");const n=Number(s);return Number.isFinite(n)?n:null}
function firstNum(text:string,patterns:RegExp[]){for(const p of patterns){const n=deNum(text.match(p)?.[1]);if(n!==null)return n}return null}
function parseFields(text:string){
  const t=text.replace(/\s+/g," ").trim();
  const warm=firstNum(t,[/(?:Warmmiete|Gesamtmiete|Miete\s*warm)\D{0,30}([\d.]+(?:,\d{1,2})?)\s*€/i,/([\d.]+(?:,\d{1,2})?)\s*€\s*(?:Warmmiete|Gesamtmiete)/i]);
  const cold=firstNum(t,[/(?:Kaltmiete|Nettokaltmiete|Grundmiete|Nutzungsentgelt)\D{0,30}([\d.]+(?:,\d{1,2})?)\s*€/i,/([\d.]+(?:,\d{1,2})?)\s*€\s*(?:Kaltmiete|Nettokaltmiete)/i]);
  const rooms=firstNum(t,[/(\d+(?:[,.]\d+)?)\s*(?:Zimmer|Zi\.?)(?:\s|\||·|$)/i]);
  const area=firstNum(t,[/(\d+(?:[,.]\d+)?)\s*m(?:²|2|\^\s*2)/i]);
  const postal=t.match(/\b(2\d{4})\b/)?.[1]||null;
  const standard=t.match(/([A-ZÄÖÜ][A-Za-zÄÖÜäöüß .'-]{2,70}\s+\d+[a-zA-Z]?)\s*,?\s*(2\d{4})\s+Hamburg\b/i);
  const address=standard?`${standard[1].trim()}, ${standard[2]} Hamburg`:null;
  return {warm,cold,rooms,area,postal,address};
}
function hamburgPostal(v:string|null|undefined){if(!v||!/^\d{5}$/.test(v))return false;const n=Number(v);return(n>=20095&&n<=21149)||(n>=22041&&n<=22769)}
function firstHref(html:string){const raw=html.match(/href=["']([^"']+)["']/i)?.[1];if(!raw)return null;try{return new URL(decodeHtml(raw),ORIGIN).href}catch{return null}}
function firstImage(html:string){const raw=html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];if(!raw)return null;try{return new URL(decodeHtml(raw),ORIGIN).href}catch{return null}}
function keyFromUrl(url:string){try{const u=new URL(url);return u.searchParams.get("ID")||u.searchParams.get("id")||u.pathname.split("/").filter(Boolean).at(-1)||url}catch{return url}}
async function sha256(v:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function fetchText(url:string){const r=await fetch(url,{redirect:"follow",headers:{"user-agent":UA,"accept-language":"de-DE,de;q=0.9","cache-control":"no-cache","accept":"text/html,application/xhtml+xml,*/*;q=0.8"}});if(!r.ok)throw new Error(`BVE HTTP ${r.status} ${url}`);return {text:await r.text(),url:r.url}}
async function fetchMarkers(url:string):Promise<Marker[]>{const r=await fetch(url,{headers:{"user-agent":UA,accept:"application/json","cache-control":"no-cache"}});if(!r.ok)throw new Error(`BVE API HTTP ${r.status}`);const j=await r.json();if(!Array.isArray(j))throw new Error("BVE offers API did not return an array");return j}

Deno.serve(async(req:Request)=>{
  const started=new Date().toISOString(); let sourceId:number|null=null; let previousFailures=0;
  try{
    if(req.method!=="POST")return new Response("method not allowed",{status:405});
    if((req.headers.get("x-internal-secret")||"")!==await secret("internal_worker_secret"))return new Response("unauthorized",{status:401});
    const body=await req.json().catch(()=>({}));sourceId=Number(body.source_id);if(!sourceId)return Response.json({ok:false,error:"source_id required"},{status:400});
    const {data:source,error:se}=await db.from("sources").select("id,name,enabled,consecutive_failures").eq("id",sourceId).single();if(se||!source?.enabled)throw new Error(se?.message||"source disabled");previousFailures=Number(source.consecutive_failures||0);
    const {data:connector,error:ce}=await db.from("source_connectors").select("label,config").eq("source_id",sourceId).eq("enabled",true).order("priority").limit(1).maybeSingle();if(ce||!connector)throw new Error(ce?.message||"no BVE connector");
    const endpoint=String(connector.config?.url||DEFAULT_ENDPOINT);const markers=await fetchMarkers(endpoint);let inserted=0,updated=0;const keys:string[]=[];
    for(const marker of markers){
      const markerHtml=String(marker.infoWindowContent||"");const canonical=firstHref(markerHtml);if(!canonical)continue;let detailText="";let detailHtml="";try{const d=await fetchText(canonical);detailHtml=d.text;detailText=stripHtml(d.text)}catch{detailText=stripHtml(markerHtml)}
      const combined=`${stripHtml(markerHtml)} ${detailText}`;const f=parseFields(combined);if(f.postal&&!hamburgPostal(f.postal))continue;
      const cityOk=/\bHamburg\b/i.test(combined)||hamburgPostal(f.postal);if(!cityOk)continue;
      const title=String(marker.title||stripHtml(markerHtml).slice(0,240)||"BVE Wohnungsangebot");const key=keyFromUrl(canonical);keys.push(key);const image=firstImage(detailHtml)||firstImage(markerHtml);
      const row={source_id:sourceId,source_listing_key:key,external_id:key,canonical_url:canonical,title,address:f.address,district:null,postal_code:f.postal,city:"Hamburg",warm_rent:f.warm,cold_rent:f.cold,rooms:f.rooms,area_sqm:f.area,available_from:null,property_type:"Wohnung",furnished:null,wbs_required:/\bWBS\b|Wohnberechtigungsschein/i.test(combined),image_url:image,cross_source_hash:f.address?await sha256(`${f.address.toLowerCase()}|${f.warm??f.cold??""}|${f.rooms??""}|${f.area??""}`):await sha256(canonical),raw:{provider:"bve_umbraco_offers",latitude:marker.latitude,longitude:marker.longitude,marker,detail_text:detailText.slice(0,10000)},last_seen_at:new Date().toISOString(),is_active:true};
      const {data:existing}=await db.from("listings").select("id").eq("source_id",sourceId).eq("source_listing_key",key).maybeSingle();const {error}=await db.from("listings").upsert(row,{onConflict:"source_id,source_listing_key"});if(error)throw error;existing?updated++:inserted++;
    }
    let deactivated=0;const {data:active,error:ae}=await db.from("listings").select("id,source_listing_key,raw").eq("source_id",sourceId).eq("is_active",true);if(ae)throw ae;const stale=(active||[]).filter((x:any)=>x.raw?.provider==="bve_umbraco_offers"&&!keys.includes(String(x.source_listing_key)));if(stale.length){const {error}=await db.from("listings").update({is_active:false,last_seen_at:new Date().toISOString()}).in("id",stale.map((x:any)=>x.id));if(error)throw error;deactivated=stale.length}
    const now=new Date().toISOString();await db.from("sources").update({last_success_at:now,last_error_at:null,consecutive_failures:0,updated_at:now}).eq("id",sourceId);await db.from("crawl_runs").insert({source_id:sourceId,started_at:started,finished_at:now,success:true,connector_label:connector.label,fetched_count:keys.length,inserted_count:inserted,metadata:{mode:"bve-umbraco-offers",endpoint_markers:markers.length,valid_hamburg_offers:keys.length,updated,deactivated}});return Response.json({ok:true,source_id:sourceId,endpoint_markers:markers.length,fetched:keys.length,inserted,updated,deactivated});
  }catch(e){const msg=e instanceof Error?e.message:String(e);if(sourceId){const now=new Date().toISOString();await db.from("sources").update({last_error_at:now,consecutive_failures:previousFailures+1,updated_at:now}).eq("id",sourceId);await db.from("crawl_runs").insert({source_id:sourceId,started_at:started,finished_at:now,success:false,fetched_count:0,inserted_count:0,error_message:msg,metadata:{mode:"bve-umbraco-offers"}})}return Response.json({ok:false,error:msg},{status:500})}
});
