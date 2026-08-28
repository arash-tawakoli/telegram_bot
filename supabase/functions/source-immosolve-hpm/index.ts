import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const ADMIN_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, ADMIN_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const UA = "Mozilla/5.0 (compatible; TraumwohnungHamburgBot/3.0; +https://traumwohnunghamburg.de)";
const CONFIG_BASE = "https://config.hpm.immosolve.eu/hpmconfigurationsservice/v1/configurations";

type HpmConfig = {
  mandatorConstants?: {
    mandatorId?: string;
    mandatorIdUnhashed?: string;
    server?: string;
  };
  presentationConfig?: Record<string, unknown> & { objectIdentifiers?: Array<number | string> };
};
type HpmObject = {
  id?: number | string;
  objectIdentifier?: number | string;
  labels?: Record<string, unknown>;
  teaserImage?: { filename?: string | null } | null;
};

async function secret(name:string){
  const {data,error}=await db.rpc("get_bot_secret",{secret_name:name});
  if(error||!data) throw new Error(`secret ${name} unavailable`);
  return String(data);
}
function deNum(v:unknown):number|null{
  if(v==null||v==="") return null;
  if(typeof v==="number") return Number.isFinite(v)?v:null;
  let s=String(v).trim().replace(/\s/g,"").replace(/[€]/g,"").replace(/[^\d.,-]/g,"");
  if(!s) return null;
  if(s.includes(",")) s=s.replace(/\./g,"").replace(",",".");
  else if((s.match(/\./g)||[]).length>1) s=s.replace(/\./g,"");
  const n=Number(s); return Number.isFinite(n)?n:null;
}
function germanDate(v:unknown):string|null{
  const m=String(v??"").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m?`${m[3]}-${m[2]}-${m[1]}`:null;
}
function hamburgPostal(v:string|null|undefined){
  if(!v||!/^\d{5}$/.test(v)) return false;
  const n=Number(v); return (n>=20095&&n<=21149)||(n>=22041&&n<=22769);
}
function isResidential(labels:Record<string,unknown>){
  const text=`${labels.category??""} ${labels.titel??""}`;
  if(/stellplatz|garage|parkplatz|fahrrad|gewerbe|büro|praxis|laden|halle|lager/i.test(text)) return false;
  return /wohnung|apartment|wohnraum|wohnhaus|zimmer/i.test(text);
}
function mandatorFromUrl(url:string){
  try{
    const u=new URL(url);
    const sub=u.hostname.match(/^(\d+)\.hpm\.immosolve\.eu$/i)?.[1];
    if(sub) return sub;
    return u.pathname.match(/\/modern\/(\d+)\//i)?.[1]||null;
  }catch{return null}
}
function slug(v:unknown){
  return String(v??"wohnung").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)||"wohnung";
}
async function sha256(v:string){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function fetchJson(url:string,init:RequestInit={}):Promise<any>{
  const r=await fetch(url,{redirect:"follow",...init,headers:{"user-agent":UA,accept:"application/json",...(init.headers||{})}});
  if(!r.ok) throw new Error(`ImmoSolve HTTP ${r.status} for ${url}`);
  return await r.json();
}
function postBody(presentationId:string,mandatorId:string,objectIdentifier:number|string,page=1){
  return {
    presentationId,mandatorId,objectIdentifier,allowedObjectIdentifiers:[objectIdentifier],calendarData:true,
    city:null,chosenLocation:null,radius:null,minimumLocation:null,maximumLocation:null,regions:null,personCount:null,
    dateStart:null,dateEnd:null,roomsStart:null,roomsEnd:null,priceStart:null,priceEnd:null,areaStart:null,areaEnd:null,
    floor:null,specialties:[],userCode:null,elementsPerPage:2000,currentPage:page,orderBy:null,objectId:null,objectCode:null,category:null
  };
}

Deno.serve(async(req:Request)=>{
  const started=new Date().toISOString();
  let sourceId:number|null=null;
  let previousFailures=0;
  try{
    if(req.method!=="POST") return new Response("method not allowed",{status:405});
    if((req.headers.get("x-internal-secret")||"")!==await secret("internal_worker_secret")) return new Response("unauthorized",{status:401});
    const requestBody=await req.json().catch(()=>({}));
    sourceId=Number(requestBody.source_id);
    if(!sourceId) return Response.json({ok:false,error:"source_id required"},{status:400});

    const {data:source,error:se}=await db.from("sources")
      .select("id,name,enabled,search_url,homepage_url,consecutive_failures")
      .eq("id",sourceId).single();
    if(se||!source?.enabled) throw new Error(se?.message||"source disabled");
    previousFailures=Number(source.consecutive_failures||0);

    const {data:connector,error:ce}=await db.from("source_connectors")
      .select("priority,label,connector_kind,config")
      .eq("source_id",sourceId).eq("enabled",true).order("priority").limit(1).maybeSingle();
    if(ce||!connector) throw new Error(ce?.message||"no enabled connector");

    const configuredUrl=String(connector.config?.url||source.search_url||source.homepage_url||"");
    const mandatorId=String(connector.config?.mandator_id||mandatorFromUrl(configuredUrl)||"");
    if(!mandatorId||!/^\d+$/.test(mandatorId)) throw new Error("ImmoSolve mandator id missing");

    const config:HpmConfig=await fetchJson(`${CONFIG_BASE}/${mandatorId}`);
    const server=String(config.mandatorConstants?.server||"");
    const mandatorHash=String(config.mandatorConstants?.mandatorId||"");
    const objectIdentifiers=config.presentationConfig?.objectIdentifiers||[];
    if(!server||!mandatorHash||!objectIdentifiers.length) throw new Error("ImmoSolve HPM configuration incomplete");

    const moduleUrl=`https://${mandatorId}.hpm.immosolve.eu/`;
    const listUrl=`https://${server}/immosolve2/api/rest/hpm/estates/list`;
    const detailUrl=`https://${server}/immosolve2/api/rest/hpm/estates/details`;
    const candidates:HpmObject[]=[];
    let enumerated=0;

    for(const rawIdentifier of objectIdentifiers){
      const objectIdentifier=typeof rawIdentifier==="string"&&/^\d+$/.test(rawIdentifier)?Number(rawIdentifier):rawIdentifier;
      const presentation=(config.presentationConfig as any)?.[`config_${objectIdentifier}`];
      const presentationId=String(presentation?.presentationId||"");
      if(!presentationId) continue;
      let page=1,totalPages=1;
      do{
        const payload=await fetchJson(listUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(postBody(presentationId,mandatorHash,objectIdentifier,page))});
        const objects=Array.isArray(payload?.immoObjects)?payload.immoObjects:[];
        enumerated+=objects.length;
        candidates.push(...objects);
        totalPages=Math.max(1,Number(payload?.totalPages||1));
        page++;
      }while(page<=totalPages&&page<=20);
    }

    const residential=candidates.filter(x=>{
      const l=x.labels||{};
      const postal=String(l.plz||"");
      return isResidential(l)&&hamburgPostal(postal)&&String(l.ort||"").toLowerCase().includes("hamburg")&&x.id!=null;
    });

    let inserted=0,updated=0;
    const keys:string[]=[];
    for(const item of residential){
      const objectIdentifier=Number(item.objectIdentifier||item.labels?.objectIdentifier||0);
      const presentation=(config.presentationConfig as any)?.[`config_${objectIdentifier}`];
      const presentationId=String(presentation?.presentationId||"");
      if(!presentationId) throw new Error(`presentation missing for objectIdentifier ${objectIdentifier}`);
      const id=String(item.id);
      const detail=await fetchJson(detailUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({presentationId,mandatorId:mandatorHash,userCode:null,id:item.id,code:null})});
      const labels=(detail?.immoObject?.labels||item.labels||{}) as Record<string,unknown>;
      if(!isResidential(labels)) continue;
      const postal=String(labels.plz||"");
      if(!hamburgPostal(postal)||!String(labels.ort||"").toLowerCase().includes("hamburg")) continue;

      const street=[labels.strasse,labels.hausnummer].filter(Boolean).join(" ").trim();
      const address=[street,postal,"Hamburg"].filter(Boolean).join(", ");
      const warm=deNum(labels.monatlGesamtkosten);
      const cold=deNum(labels.mietpreis);
      const rooms=deNum(labels.anzahlZimmer);
      const area=deNum(labels.wohnflaeche);
      const title=String(labels.titel||item.labels?.titel||"Wohnungsangebot");
      const imagePath=String(detail?.immoObject?.teaserImage?.filename||detail?.images?.[0]?.filename||item.teaserImage?.filename||"");
      const imageUrl=imagePath?new URL(imagePath,`https://${server}/`).href:null;
      const canonical=`${moduleUrl}#!/detail-expose-${objectIdentifier}-${encodeURIComponent(id)}-${slug(title)}`;
      const key=id;
      keys.push(key);
      const row={
        source_id:sourceId,source_listing_key:key,external_id:String(labels.code||id),canonical_url:canonical,title,address,
        district:String(labels.stadtteil||labels.searchRegion||"")||null,postal_code:postal,city:"Hamburg",
        warm_rent:warm,cold_rent:cold,rooms,area_sqm:area,available_from:germanDate(labels.availableStart),
        property_type:"Wohnung",furnished:null,wbs_required:String(labels.wohnberechtigungsschein||"0")!=="0",
        image_url:imageUrl,
        cross_source_hash:await sha256(`${address.toLowerCase()}|${warm??cold??""}|${rooms??""}|${area??""}`),
        raw:{provider:"immosolve_hpm_rest",mandator_id:mandatorId,object_identifier:objectIdentifier,detail},
        last_seen_at:new Date().toISOString(),is_active:true
      };
      const {data:existing}=await db.from("listings").select("id").eq("source_id",sourceId).eq("source_listing_key",key).maybeSingle();
      const {error}=await db.from("listings").upsert(row,{onConflict:"source_id,source_listing_key"});
      if(error) throw error;
      existing?updated++:inserted++;
    }

    let deactivated=0;
    const {data:activeRows,error:ae}=await db.from("listings").select("id,source_listing_key,raw").eq("source_id",sourceId).eq("is_active",true);
    if(ae) throw ae;
    const stale=(activeRows||[]).filter((r:any)=>r.raw?.provider==="immosolve_hpm_rest"&&!keys.includes(String(r.source_listing_key)));
    if(stale.length){
      const {error:de}=await db.from("listings").update({is_active:false,last_seen_at:new Date().toISOString()}).in("id",stale.map((x:any)=>x.id));
      if(de) throw de;
      deactivated=stale.length;
    }

    const now=new Date().toISOString();
    await db.from("sources").update({last_success_at:now,last_error_at:null,consecutive_failures:0,updated_at:now}).eq("id",sourceId);
    await db.from("crawl_runs").insert({source_id:sourceId,started_at:started,finished_at:now,success:true,connector_label:connector.label,
      fetched_count:residential.length,inserted_count:inserted,
      metadata:{mode:"immosolve-hpm-rest",mandator_id:mandatorId,server,object_identifiers:objectIdentifiers,enumerated,valid_hamburg_flats:residential.length,updated,deactivated}});
    return Response.json({ok:true,source_id:sourceId,mandator_id:mandatorId,enumerated,fetched:residential.length,inserted,updated,deactivated});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    if(sourceId){
      const now=new Date().toISOString();
      await db.from("sources").update({last_error_at:now,consecutive_failures:previousFailures+1,updated_at:now}).eq("id",sourceId);
      await db.from("crawl_runs").insert({source_id:sourceId,started_at:started,finished_at:now,success:false,fetched_count:0,inserted_count:0,error_message:msg,metadata:{mode:"immosolve-hpm-rest"}});
    }
    return Response.json({ok:false,error:msg},{status:500});
  }
});
