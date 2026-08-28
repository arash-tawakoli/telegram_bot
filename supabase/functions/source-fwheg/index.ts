import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const ADMIN_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, ADMIN_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const UA = "Mozilla/5.0 (compatible; TraumwohnungHamburgBot/3.0; +https://traumwohnunghamburg.de)";

type Estate = {
  id?: string;
  altText?: string;
  street?: string;
  houseNumber?: string;
  city?: string;
  postalcode?: string;
  baseRent?: number | string;
  numberOfRooms?: number | string;
  overallSpace?: number | string;
  district?: string;
  applicationLink?: string;
};

async function secret(name:string){
  const {data,error}=await db.rpc("get_bot_secret",{secret_name:name});
  if(error||!data) throw new Error(`secret ${name} unavailable`);
  return String(data);
}
function num(v:unknown){const n=Number(String(v??"").replace(",","."));return Number.isFinite(n)?n:null}
function hamburgPostal(v:string|null|undefined){if(!v||!/^\d{5}$/.test(v))return false;const n=Number(v);return (n>=20095&&n<=21149)||(n>=22041&&n<=22769)}
function validApply(v:string|null|undefined){try{const u=new URL(String(v));return u.protocol==="https:"&&u.hostname==="tenant.immomio.com"&&/^\/(?:de\/)?apply\/[0-9a-f-]{36}$/i.test(u.pathname)}catch{return false}}
async function sha256(v:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}

Deno.serve(async(req:Request)=>{
  const started=new Date().toISOString();
  let sourceId:number|null=null;
  let previousFailures=0;
  try{
    if(req.method!=="POST") return new Response("method not allowed",{status:405});
    if((req.headers.get("x-internal-secret")||"")!==await secret("internal_worker_secret")) return new Response("unauthorized",{status:401});
    const body=await req.json().catch(()=>({}));
    sourceId=Number(body.source_id);
    if(!sourceId) return Response.json({ok:false,error:"source_id required"},{status:400});

    const {data:source,error:se}=await db.from("sources").select("id,name,enabled,consecutive_failures").eq("id",sourceId).single();
    if(se||!source?.enabled) throw new Error(se?.message||"source disabled");
    previousFailures=Number(source.consecutive_failures||0);

    const {data:connector,error:ce}=await db.from("source_connectors")
      .select("priority,label,connector_kind,config")
      .eq("source_id",sourceId).eq("enabled",true).order("priority").limit(1).maybeSingle();
    if(ce||!connector) throw new Error(ce?.message||"no enabled connector");
    const url=String(connector.config?.url||"");
    if(!url) throw new Error("Finkenwaerder REST URL missing");

    const response=await fetch(url,{redirect:"follow",headers:{accept:"application/json","user-agent":UA,"cache-control":"no-cache"}});
    if(!response.ok) throw new Error(`Finkenwaerder REST HTTP ${response.status}`);
    const payload=await response.json();
    if(!Array.isArray(payload)) throw new Error("Finkenwaerder REST payload is not an array");

    const valid=(payload as Estate[]).filter(x=>
      String(x.city||"").toLowerCase()==="hamburg" &&
      hamburgPostal(x.postalcode) &&
      validApply(x.applicationLink) &&
      !!String(x.id||"").trim()
    );

    let inserted=0,updated=0;
    const keys:string[]=[];
    for(const x of valid){
      const key=String(x.id);
      keys.push(key);
      const rooms=num(x.numberOfRooms), area=num(x.overallSpace), cold=num(x.baseRent);
      const street=[x.street,x.houseNumber].filter(Boolean).join(" ").trim();
      const address=[street,x.postalcode,"Hamburg"].filter(Boolean).join(", ");
      const title=(x.altText&&/wohnung|apartment|haus/i.test(x.altText))
        ? x.altText
        : `${rooms??""}${rooms!=null?"-Zimmer-":""}Wohnung${x.district?` in ${x.district}`:""}`.replace(/^Wohnung/,"Wohnung");
      const row={
        source_id:sourceId,
        source_listing_key:key,
        external_id:key,
        canonical_url:x.applicationLink,
        title,
        address,
        district:x.district||null,
        postal_code:x.postalcode||null,
        city:"Hamburg",
        warm_rent:null,
        cold_rent:cold,
        rooms,
        area_sqm:area,
        available_from:null,
        property_type:"Wohnung",
        furnished:null,
        wbs_required:false,
        image_url:null,
        cross_source_hash:await sha256(`${address.toLowerCase()}|${cold??""}|${rooms??""}|${area??""}`),
        raw:{provider:"fwheg_rest",estate:x},
        last_seen_at:new Date().toISOString(),
        is_active:true
      };
      const {data:existing}=await db.from("listings").select("id").eq("source_id",sourceId).eq("source_listing_key",key).maybeSingle();
      const {error}=await db.from("listings").upsert(row,{onConflict:"source_id,source_listing_key"});
      if(error) throw error;
      existing?updated++:inserted++;
    }

    let deactivated=0;
    const {data:activeRows,error:ae}=await db.from("listings").select("id,source_listing_key,raw")
      .eq("source_id",sourceId).eq("is_active",true);
    if(ae) throw ae;
    const stale=(activeRows||[]).filter((r:any)=>r.raw?.provider==="fwheg_rest"&&!keys.includes(String(r.source_listing_key)));
    if(stale.length){
      const {error:de}=await db.from("listings").update({is_active:false,last_seen_at:new Date().toISOString()}).in("id",stale.map((x:any)=>x.id));
      if(de) throw de;
      deactivated=stale.length;
    }

    const now=new Date().toISOString();
    await db.from("sources").update({last_success_at:now,last_error_at:null,consecutive_failures:0,updated_at:now}).eq("id",sourceId);
    await db.from("crawl_runs").insert({
      source_id:sourceId,started_at:started,finished_at:now,success:true,connector_label:connector.label,
      fetched_count:valid.length,inserted_count:inserted,
      metadata:{mode:"fwheg-rest",endpoint_items:payload.length,valid_hamburg_flats:valid.length,updated,deactivated}
    });
    return Response.json({ok:true,source_id:sourceId,fetched:valid.length,inserted,updated,deactivated,endpoint_items:payload.length});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    if(sourceId){
      const now=new Date().toISOString();
      await db.from("sources").update({last_error_at:now,consecutive_failures:previousFailures+1,updated_at:now}).eq("id",sourceId);
      await db.from("crawl_runs").insert({source_id:sourceId,started_at:started,finished_at:now,success:false,fetched_count:0,inserted_count:0,error_message:msg,metadata:{mode:"fwheg-rest"}});
    }
    return Response.json({ok:false,error:msg},{status:500});
  }
});
