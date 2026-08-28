import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const ADMIN_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, ADMIN_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const UA = "Mozilla/5.0 (compatible; TraumwohnungHamburgBot/3.0; +https://traumwohnunghamburg.de)";
const GQL_URL = "https://gql-hp.immomio.com/homepage/graphql";
const QUERY = `query propertyList($input: HomepagePropertySearchRequest!) {
  propertyList(input: $input) {
    page { page size totalElements totalPages }
    nodes {
      name totalRooms size totalRentGross externalId wbs applicationLink objectId
      propertyType marketingType status
      address { city street houseNumber zipCode district }
      availableFrom { dateAvailable stringAvailable }
      titleImage { url }
    }
  }
}`;

async function secret(name:string){
  const {data,error}=await db.rpc("get_bot_secret",{secret_name:name});
  if(error||!data) throw new Error(`secret ${name} unavailable`);
  return String(data);
}
function tokenFromUrl(url:string){try{return new URL(url).searchParams.get("token")}catch{return null}}
function decodeHtml(s:string){return s.replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">")}
function absolute(base:string,href:string){try{return new URL(decodeHtml(href),base).href}catch{return null}}
function extractHomepageUrl(html:string,base:string){
  const src=html.match(/(?:src|href)=["']([^"']*homepage\.immomio\.com[^"']+)["']/i)?.[1]
    || html.match(/(https:\/\/homepage\.immomio\.com\/[^"'<>\s]+)/i)?.[1];
  return src?absolute(base,src):null;
}
function extractAjaxUrl(html:string,base:string){const raw=html.match(/data-ajaxurl=["']([^"']+)["']/i)?.[1];return raw?absolute(base,raw):null}
async function fetchText(url:string,init:RequestInit={}){
  const r=await fetch(url,{redirect:"follow",...init,headers:{"user-agent":UA,"accept-language":"de-DE,de;q=0.9",...(init.headers||{})}});
  if(!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} for ${url}`);
  return {text:await r.text(),url:r.url};
}
async function resolveHomepageUrl(configUrl:string){
  if(tokenFromUrl(configUrl)) return {url:configUrl,discovered:false};
  const page=await fetchText(configUrl,{headers:{accept:"text/html,application/xhtml+xml,*/*;q=0.8"}});
  const direct=extractHomepageUrl(page.text,page.url);
  if(direct&&tokenFromUrl(direct)) return {url:direct,discovered:true};
  const ajaxUrl=extractAjaxUrl(page.text,page.url);
  if(ajaxUrl){
    const unlocked=await fetchText(ajaxUrl,{method:"POST",headers:{accept:"text/html","cache-control":"no-cache","content-type":"application/x-www-form-urlencoded; charset=UTF-8",cookie:"waconcookiemanagement=max"},body:""});
    const embedded=extractHomepageUrl(unlocked.text,unlocked.url);
    if(embedded&&tokenFromUrl(embedded)) return {url:embedded,discovered:true};
  }
  throw new Error("Immomio homepage listing token not found");
}
function hamburgPostal(v:string|null|undefined){if(!v||!/^\d{5}$/.test(v))return false;const n=Number(v);return (n>=20095&&n<=21149)||(n>=22041&&n<=22769)}
function validApply(url:string|null|undefined){try{const u=new URL(String(url));return u.protocol==="https:"&&u.hostname==="tenant.immomio.com"&&/^\/(?:de\/)?apply\/[0-9a-f-]{36}$/i.test(u.pathname)}catch{return false}}
async function sha256(v:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}

Deno.serve(async(req:Request)=>{
  const started=new Date().toISOString();
  let sourceId:number|null=null;
  try{
    if(req.method!=="POST") return new Response("method not allowed",{status:405});
    if((req.headers.get("x-internal-secret")||"")!==await secret("internal_worker_secret")) return new Response("unauthorized",{status:401});
    const body=await req.json().catch(()=>({})); sourceId=Number(body.source_id);
    if(!sourceId) return Response.json({ok:false,error:"source_id required"},{status:400});

    const {data:source,error:se}=await db.from("sources").select("id,name,enabled").eq("id",sourceId).single();
    if(se||!source?.enabled) throw new Error(se?.message||"source disabled");
    const {data:connector,error:ce}=await db.from("source_connectors").select("priority,label,connector_kind,config").eq("source_id",sourceId).eq("enabled",true).eq("connector_kind","immomio_tenant").order("priority").limit(1).maybeSingle();
    if(ce||!connector) throw new Error(ce?.message||"no immomio_tenant connector");

    const configuredUrl=String(connector.config?.url||"");
    if(!configuredUrl) throw new Error("Immomio connector URL missing");
    const resolved=await resolveHomepageUrl(configuredUrl);
    const token=tokenFromUrl(resolved.url);
    if(!token) throw new Error("Immomio homepage token missing");

    const res=await fetch(GQL_URL,{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify({query:QUERY,variables:{input:{page:0,size:250,token,sort:["created,desc"],marketingType:"RENT"}}})});
    if(!res.ok) throw new Error(`Immomio GraphQL HTTP ${res.status}`);
    const payload=await res.json();
    if(payload.errors?.length) throw new Error(`Immomio GraphQL: ${payload.errors[0]?.message||"unknown error"}`);

    const nodes=payload.data?.propertyList?.nodes||[];
    const valid=nodes.filter((n:any)=>n?.propertyType==="FLAT"&&n?.marketingType==="RENT"&&n?.status!=="RENTED"&&validApply(n?.applicationLink)&&String(n?.address?.city||"").toLowerCase()==="hamburg"&&hamburgPostal(n?.address?.zipCode));
    let inserted=0,updated=0;
    for(const n of valid){
      const key=String(n.objectId||n.externalId||await sha256(n.applicationLink));
      const address=[n.address?.street,n.address?.houseNumber].filter(Boolean).join(" ")+(n.address?.zipCode?`, ${n.address.zipCode} Hamburg`:"");
      const row={source_id:sourceId,source_listing_key:key,external_id:n.externalId||n.objectId||null,canonical_url:n.applicationLink,title:n.name||"Wohnungsangebot",address,district:n.address?.district||null,postal_code:n.address?.zipCode||null,city:"Hamburg",warm_rent:n.totalRentGross??null,cold_rent:null,rooms:n.totalRooms??null,area_sqm:n.size??null,available_from:n.availableFrom?.dateAvailable||null,property_type:"Wohnung",furnished:null,wbs_required:!!n.wbs,image_url:n.titleImage?.url||null,cross_source_hash:await sha256(`${address.toLowerCase()}|${n.totalRentGross??""}|${n.totalRooms??""}|${n.size??""}`),raw:{provider:"immomio",tenant_apply_url:n.applicationLink,object_id:n.objectId,external_id:n.externalId,status:n.status},last_seen_at:new Date().toISOString(),is_active:true};
      const {data:existing}=await db.from("listings").select("id").eq("source_id",sourceId).eq("source_listing_key",key).maybeSingle();
      const {error}=await db.from("listings").upsert(row,{onConflict:"source_id,source_listing_key"});
      if(error) throw error;
      existing?updated++:inserted++;
    }

    const now=new Date().toISOString();
    await db.from("sources").update({last_success_at:now,last_error_at:null,consecutive_failures:0,updated_at:now}).eq("id",sourceId);
    await db.from("crawl_runs").insert({source_id:sourceId,started_at:started,finished_at:now,success:true,connector_label:connector.label,fetched_count:valid.length,inserted_count:inserted,metadata:{mode:"immomio-tenant-graphql",token_discovered:resolved.discovered,total_elements:payload.data?.propertyList?.page?.totalElements??nodes.length,valid_flats:valid.length,updated}});
    return Response.json({ok:true,source_id:sourceId,fetched:valid.length,inserted,updated,token_discovered:resolved.discovered});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    if(sourceId){const now=new Date().toISOString();await db.from("sources").update({last_error_at:now,consecutive_failures:1,updated_at:now}).eq("id",sourceId);await db.from("crawl_runs").insert({source_id:sourceId,started_at:started,finished_at:now,success:false,fetched_count:0,inserted_count:0,error_message:msg,metadata:{mode:"immomio-tenant-graphql"}})}
    return Response.json({ok:false,error:msg},{status:500});
  }
});
