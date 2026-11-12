import {pageAvailability,recentInventory} from './availability.ts';
import {deliveryNewness} from './newness.ts';
import {previewOperations,deliverPreview,sourcePhoto} from "./preview-delivery.ts";
import {present, textValue, exactAddress, structuredFacts, collectImages, htmlFacts} from "./source-facts.ts";
import { telegramRequest, TelegramFailure } from "./telegram-request.ts";
import { waitForDispatchSlot } from "./pacing.ts";
import {
  callCutoverBridge,
  claimDelivery,
  finishDelivery,
  recoverDeliveries,
  shouldProtectDelivery,
} from "./delivery-lease.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { label } from "./labels.ts";
const U = Deno.env.get("SUPABASE_URL")!,
  K =
    JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  db = createClient(U, K, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  UA =
    "Mozilla/5.0 (compatible; TraumwohnungHamburgBot/15.0; +https://traumwohnunghamburg.de)",
  PREMIUM_LINK = "https://buy.stripe.com/dRm9AM7DSajfgYK2qVfYY01";
async function sec(n: string) {
  const { data, error } = await db.rpc("get_bot_secret", { secret_name: n });
  if (error || !data) throw new Error("secret unavailable");
  return String(data);
}
async function deliveryNewnessCheck(l:any,eventType:any,publishedText:any=null) {
  if(String(eventType||'new_listing')==='new_listing' && l?.raw?.category_stream) {
    const {data,error}=await db.rpc('category_delivery_qualified',{p_listing_id:l.id});
    if(error)throw error;
    return data===true
      ? {ok:true,reason:'category_db_qualified'}
      : {ok:false,reason:'category_db_newness_unqualified'};
  }
  return deliveryNewness(l,eventType,publishedText);
}

function premium(u: any, s: boolean) {
  if (u?.plan_override === "free") return false;
  if (
    u?.plan_override === "premium" &&
    (!u.plan_override_expires_at ||
      new Date(u.plan_override_expires_at) > new Date())
  )
    return true;
  if (u?.referral_bonus_until && new Date(u.referral_bonus_until) > new Date())
    return true;
  return s;
}

function esc(v: any) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function loc(l: any) {
  const evidence = l.raw?.provider === 'immosolve_hpm_rest' ? null : l.enrichment_evidence?.preview;
  if (evidence && evidence.canonical_url === l.canonical_url && Object.hasOwn(evidence.facts || {},'address')) return textValue(evidence.facts.address);
  return structuredFacts(l.raw, l.canonical_url).address;
}
function mapLoc(l: any) {
  const exact = loc(l);
  if (exact) return exact;
  if (l.raw?.provider !== 'immowelt') return null;
  return textValue(l.postal_code) ?? textValue(l.city);
}
function factNumber(value: any) {
  if (value == null || !present(value) || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function availableText(l: any) {
  return textValue(l.available_text) ?? textValue(l.raw?.available_text) ?? textValue(l.raw?.availableFrom?.stringAvailable) ?? textValue(l.raw?.availableFrom?.dateAvailable) ?? textValue(l.available_from);
}
function sourceMoney(v: any) {
  if (typeof v === "number") return factNumber(v);
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s*(?:€|EUR)\s*$/i, "");
  if (!/^\d+(?:[.,]\d+)*$/.test(t)) return null;
  return factNumber(
    t.includes(",")
      ? t.replace(/\./g, "").replace(",", ".")
      : /^\d{1,3}(?:\.\d{3})+$/.test(t)
        ? t.replace(/\./g, "")
        : t,
  );
}
function knownFacts(l: any) {
  const direct = structuredFacts(l.raw, l.canonical_url);
  const evidence = l.raw?.provider === 'immosolve_hpm_rest' ? null : l.enrichment_evidence?.preview;
  const detail = evidence && evidence.canonical_url === l.canonical_url ? evidence.facts || {} : {};
  const sagaProbe=l.enrichment_evidence?.saga_probe || {};
  const sagaShared=l.enrichment_evidence?.saga_shared || {};
  const out = {...l, ...direct, ...detail};
  if(!present(out.provider_entity) && (sagaProbe.is_saga===true || sagaProbe.is_saga==="true" || sagaShared.verified===true))out.provider_entity="SAGA";
  if(!present(out.saga_object_ref))out.saga_object_ref=textValue(sagaProbe.saga_object_ref);
  const portalTargetChecked=[1,3].includes(Number(l.source_id)) && l.raw?.portal_application_target_checked===true;
  if(!present(out.applicationLink) && !portalTargetChecked)out.applicationLink=textValue(sagaProbe.application_url) ?? textValue(sagaShared.application_url);
  // Old DB values can include inferred addresses, default types and calculated rents.
  out.address = loc(l);
  out.district = textValue(detail.district) ?? textValue(direct.district) ?? textValue(l.district);
  out.borough = textValue(detail.borough) ?? textValue(direct.borough) ?? textValue(l.borough);
  out.property_type = detail.property_type ?? direct.property_type ?? null;
  out.deposit_text = detail.deposit_text ?? direct.deposit_text ?? null;
  if (l.warm_rent_is_calculated && direct.warm_rent == null && detail.warm_rent == null) out.warm_rent = null;
  out.images = collectImages({images:[...(detail.images || []), ...(direct.images || []), l.resolved_image_url, l.image_url]},l.canonical_url);
  return out;
}
let geoCache: Promise<Map<string,{district:string,borough:string}>> | null = null;
function geoKey(value:any) {
  return String(value ?? "").trim().toLocaleLowerCase("de-DE").replace(/^hamburg[\s,-]+/,"");
}
async function hamburgGeo() {
  if (!geoCache) geoCache = (async () => {
    const [{data:hoods,error:hErr},{data:boroughs,error:bErr}] = await Promise.all([
      db.from("hamburg_neighborhoods").select("name,borough_id"),
      db.from("hamburg_boroughs").select("id,name"),
    ]);
    if (hErr || bErr) throw hErr || bErr;
    const boroughById=new Map((boroughs||[]).map((b:any)=>[Number(b.id),String(b.name)]));
    const map=new Map<string,{district:string,borough:string}>();
    for(const h of hoods||[]){
      const borough=boroughById.get(Number(h.borough_id));
      if(borough)map.set(geoKey(h.name),{district:String(h.name),borough});
    }
    return map;
  })().catch(error=>{geoCache=null;throw error;});
  return geoCache;
}
async function withHamburgGeo(l:any) {
  const facts=knownFacts(l), district=textValue(facts.district);
  if(!district)return l;
  const explicitBorough=textValue(facts.borough);
  if(explicitBorough)return {...l,district,borough:explicitBorough};
  try{
    const match=(await hamburgGeo()).get(geoKey(district));
    return match ? {...l,district:match.district,borough:match.borough} : {...l,district};
  }catch{return {...l,district};}
}
function cap(l: any, lang: string, app: any = null) {
  l = knownFacts(l);
  const lines = [
    `🏠 <b>${esc(String(l.title || "Listing").slice(0, 180))}</b>`,
    "",
  ];
  if(l._saga_recovery===true)lines.push("🟢 <b>"+(lang==="de"?"Noch verfügbar":"Still available")+"</b>","");
  const number = (emoji: string, key: string, value: any, unit = " €") => {
    const n = factNumber(value);
    if (n != null)
      lines.push(`${emoji} <b>${label(lang, key)}:</b> ${n}${unit}`);
  };
  number(
    "💶",
    l.total_rent != null && factNumber(l.total_rent) === factNumber(l.warm_rent)
      ? "warm_total"
      : "warm",
    l.warm_rent,
  );
  if (
    l.total_rent != null &&
    factNumber(l.total_rent) !== factNumber(l.warm_rent)
  )
    number("💶", "total", l.total_rent);
  number("❄️", "cold", l.cold_rent);
  number("🧾", "additional", l.additional_costs);
  number("🏢", "operating", l.operating_costs);
  if (l.raw?.entry?.heatingCostsInServiceCharge === "YES")
    lines.push(
      `🔥 <b>${label(lang, "heating")}:</b> ${factNumber(l.heating_costs) != null ? factNumber(l.heating_costs) + " € · " : ""}${label(lang, "included")}`,
    );
  else if (present(l.heating_text)) lines.push(`🔥 <b>${label(lang, "heating")}:</b> ${esc(l.heating_text)}`);
  else number("🔥", "heating", l.heating_costs);
  const deposit = factNumber(l.deposit),
    depositText =
      textValue(l.deposit_text) || "";
  if (deposit != null || depositText)
    lines.push(
      `🔐 <b>${label(lang, "deposit")}:</b> ${deposit != null ? deposit + " €" : ""}${deposit != null && depositText ? " · " : ""}${esc(depositText)}`,
    );
  if (
    l.raw?.provider === "wunderflats_catalog" &&
    l.raw?.price_currency === "EUR" &&
    typeof l.raw.advertised_monthly_price === "number" &&
    l.raw.advertised_monthly_price > 0 &&
    factNumber(l.raw.advertised_monthly_price) != null &&
    l.warm_rent == null &&
    l.cold_rent == null
  )
    lines.push("💶 <b>"+(lang==="de"?"Warmmiete (pauschal)":"All-inclusive rent")+":</b> "+factNumber(l.raw.advertised_monthly_price)+" €");
  else if (
    ["nestpick_public_api","city_wohnen_catalog"].includes(l.raw?.provider) &&
    l.raw?.price_currency === "EUR" &&
    typeof l.raw.advertised_monthly_price === "number" &&
    l.raw.advertised_monthly_price > 0 &&
    factNumber(l.raw.advertised_monthly_price) != null &&
    l.warm_rent == null &&
    l.cold_rent == null
  )
    number("💶", "advertised", l.raw.advertised_monthly_price);
  number("🚪", "rooms", l.rooms, "");
  number("📐", "area", l.area_sqm, " m²");
  for (const [key, value] of [["floor", l.floor], ["property_type", l.property_type], ["move_in_date", l.move_in_date]]) {
    if (present(value)) lines.push(`<b>${label(lang, key)}:</b> ${esc(value)}`);
  }
  const available = availableText(l);
  if (available)
    lines.push(`📅 <b>${label(lang, "available")}:</b> ${esc(available)}`);
  if(typeof l.furnished==="boolean")
    lines.push("🛋️ <b>"+(lang==="de"?"Möblierung":"Furnishing")+":</b> "+(l.furnished?(lang==="de"?"möbliert":"furnished"):(lang==="de"?"unmöbliert":"unfurnished")));
  if(l.wbs_required===true)
    lines.push("🪪 <b>"+(lang==="de"?"WBS erforderlich":"WBS required")+":</b> "+(lang==="de"?"ja":"yes"));
  if (present(l.borough)) lines.push(`📍 <b>Bezirk:</b> ${esc(l.borough)}`);
  if (present(l.district)) lines.push(`📍 <b>Stadtteil:</b> ${esc(l.district)}`);
  if (present(l.published_text)) lines.push(`<b>Veröffentlicht laut Quelle:</b> ${esc(l.published_text)}`);
  if (l.features?.length) {
    const features=[...new Set(l.features.map((v:any)=>String(v).trim()).filter((v:string)=>v))];
    if(features.length)lines.push(`🛋️ <b>Ausstattung:</b> ${features.map(esc).join(', ')}`);
  }
  for(const [key,value] of Object.entries(l.extra_facts||{}))if(present(value))lines.push(`<b>${esc(key)}:</b> ${esc(value)}`);
  if (loc(l)) lines.push(`📍 <b>${label(lang, "address")}:</b> ${esc(loc(l))}`);
  const applicationView=applicationPresentation(app,autoApplyProvider(l),lang);
  if(applicationView?.caption)lines.push("",applicationView.caption);
  return lines.join("\n").trim();
}
function sourceButtonName(l:any) {
  const raw=String(l.sources?.button_label||l.sources?.name||"Angebot").trim();
  return raw.replace(/^Zu\s+/i,"").replace(/\.(?:de|com|net|org)$/i,"").replace(/\s+Hamburg$/i,"").trim()||"Angebot";
}
function offerTarget(l: any, lang: string) {
  const fallback = {url:l.canonical_url, text:label(lang,"offer"), target:"portal"};
  const facts=knownFacts(l);
  const tenant = (value:any, registration=false) => {
    if (typeof value !== "string") return null;
    try {
      const u=new URL(value);
      if(u.protocol!=="https:" || u.hostname!=="tenant.immomio.com" || u.port || u.username || u.password) return null;
      const valid=registration
        ? /^\/(?:de\/)?auth\/register\/propertyLocation\/?$/.test(u.pathname) && !!u.searchParams.get("token")
        : /^\/(?:de\/)?apply\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(u.pathname);
      return valid ? u.href : null;
    } catch { return null; }
  };
  const direct=tenant(facts.applicationLink) || tenant(l.raw?.applicationLink) || tenant(l.canonical_url);
  if(direct) return {url:direct,text:label(lang,"offer"),target:"immomio_apply"};
  if (l.sources?.source_type !== "Baugenossenschaft") return fallback;
  const connectors=[...(l.sources?.source_connectors || [])].filter((c:any)=>c.enabled).sort((a:any,b:any)=>a.priority-b.priority);
  for(const c of connectors) {
    const portal=tenant(c.config?.tenant_registration_url,true);
    if(portal) return {url:portal,text:label(lang,"offer"),target:"immomio_registration"};
  }
  return fallback;
}
function autoApplyProvider(l:any) {
  const raw=l?.raw||{}, ids=new Set<string>();
  for(const value of [
    raw.applicationLink,
    raw.application_link,
    raw.applicationUrl,
    raw.application_url,
    raw.tenant_apply_url,
    l?.applicationLink,
    l?.canonical_url,
  ]){
    if(typeof value!=="string" || value.length>4096 || /[\x00-\x1f\x7f]/.test(value))continue;
    const match=value.trim().match(/^https:\/\/tenant\.immomio\.com\/(?:de\/)?apply\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?(?:[?#][^\s\\]*)?$/i);
    if(match)ids.add(match[1].toLowerCase());
  }
  if(ids.size>1)return null;
  if(ids.size===1)return "immomio";
  const sourceId=Number(l?.source_id);
  if(sourceId===1)return "immoscout";
  if(sourceId===3)return "immowelt";
  return null;
}
function providerLabel(provider:any){return provider==="immoscout"?"ImmoScout24":provider==="immomio"?"Immomio":provider==="immowelt"?"Immowelt":String(provider||"Plattform");}
function applicationStatusKey(app:any){return app?JSON.stringify([app.status||null,app.last_error||null,app.wait_reason||null,app.provider_state||{}]):"none";}
function applicationPresentation(app:any,provider:any,lang="de"){
  if(!app||!provider)return null;
  const de=lang!=="en",status=String(app.status||""),error=String(app.last_error||""),state=app.provider_state&&typeof app.provider_state==="object"?app.provider_state:{},name=providerLabel(provider);
  if(status==="sent"){
    if(provider==="immomio"&&state.followUpRequired==="questions")return{caption:de?"⚠️ <b>Bewerbung versendet · Angaben erforderlich</b>":"⚠️ <b>Application sent · details required</b>"};
    if(provider==="immomio"&&state.followUpRequired==="sms_verification")return{caption:de?"⚠️ <b>Bewerbung versendet · Bestätigung erforderlich</b>":"⚠️ <b>Application sent · verification required</b>"};
    return{caption:de?"✅ <b>Automatisch beworben</b>":"✅ <b>Applied automatically</b>"};
  }
  if(error==="already_applied")return{caption:de?"✅ <b>Bereits beworben</b>":"✅ <b>Already applied</b>"};
  if(status==="pending"||status==="processing")return{caption:de?"⏳ <b>Bewerbung wird versendet …</b>":"⏳ <b>Application is being sent …</b>"};
  if(error==="plus_required")return{caption:`⚠️ <b>${esc(name)} Plus erforderlich</b>`};
  if(["needs_login","provider_disabled"].includes(error))return{caption:`🔐 <b>${esc(name)} erneut verbinden</b>`};
  if(error==="listing_unavailable")return{caption:de?"🚫 <b>Angebot nicht mehr verfügbar</b>":"🚫 <b>Listing no longer available</b>"};
  if(error.startsWith("required_profile_data_missing"))return{caption:de?"⚠️ <b>Bewerberprofil vervollständigen</b>":"⚠️ <b>Complete applicant profile</b>"};
  if(error==="conversation_exists")return{caption:de?"💬 <b>Unterhaltung bereits vorhanden</b>":"💬 <b>Conversation already exists</b>"};
  if(["submission_unconfirmed","xcf_submit_unconfirmed"].includes(error))return{caption:de?"⚠️ <b>Versand nicht bestätigt</b>":"⚠️ <b>Send not confirmed</b>"};
  if(provider==="immomio"&&["dynamic_questions_required","sms_verification_required","captcha_required"].includes(error))return{caption:de?"⚠️ <b>Aktion in Immomio erforderlich</b>":"⚠️ <b>Action required in Immomio</b>"};
  if(error==="provider_paused")return{caption:de?"⏸ <b>Auto-Bewerbung für diese Plattform pausiert</b>":"⏸ <b>Auto-apply paused for this platform</b>"};
  if(["not_eligible","send_not_authorized","auto_apply_disabled"].includes(error))return null;
  if(["manual_required","failed"].includes(status))return{caption:de?"⚠️ <b>Manuell bewerben</b>":"⚠️ <b>Apply manually</b>"};
  return null;
}
async function applicationState(userId:string,listingId:string){
  if(!/^[0-9a-f-]{36}$/i.test(userId)||!/^[0-9a-f-]{36}$/i.test(listingId))return null;
  const {data,error}=await db.from("applications").select("status,last_error,wait_reason,sent_at,provider_state,created_at").eq("user_id",userId).eq("listing_id",listingId).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(error){console.error("application_status_read_failed",error.message);return null;}
  return data||null;
}
function kb(l: any, lang: string, p: boolean, userId = "") {
  const checkout=`${PREMIUM_LINK}?client_reference_id=${encodeURIComponent(String(userId))}`;
  const facts=knownFacts(l);
  const sourceName=sourceButtonName(l);
  const cooperative=String(l.sources?.source_type || "") === "Baugenossenschaft";
  const target=offerTarget(l,lang);
  const normalOfferText=target.target==="immomio_apply"
    ? (lang==="de"?"Zu Immomio":"Open Immomio")
    : (lang==="de"
      ? `${cooperative ? "🏠 " : ""}Zu ${sourceName}`
      : `${cooperative ? "🏠 " : ""}${sourceName}`);
  const offer = cooperative
    ? (p
        ? { ...target, text: lang==="de" ? "💎 Premium-Angebot" : "💎 Premium listing" }
        : { text: lang==="de" ? "🔒 💎 Premium-Angebot" : "🔒 💎 Premium listing", url: checkout })
    : { ...target, text: normalOfferText };
  delete (offer as any).target;
  const save = p
    ? { text: `⭐ ${label(lang, "save")}`, callback_data: `save:${l.id}` }
    : { text: `⭐ ${label(lang, "save")}`, callback_data: "premium" };
  const q = mapLoc(l);
  const rows: any[] = [[offer],[save]];
  if (q) rows.push([{text:`🗺️ ${label(lang, "maps")}`,url:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`}]);
  return { inline_keyboard: rows };
}
async function tg(t: string, m: string, b: any) {
  return telegramRequest(`https://api.telegram.org/bot${t}/${m}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b),
  });
}
function sameListing(a: any, b: any) {
  try {
    const x = new URL(a),
      y = new URL(b);
    for (const u of [x, y])
      for (const k of [...u.searchParams.keys()])
        if (k.startsWith("utm_")) u.searchParams.delete(k);
    return x.href.replace(/\/$/, "") === y.href.replace(/\/$/, "");
  } catch {
    return false;
  }
}
function walk(v: any, out: any, target: string, parentScoped = false) {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (const x of v) walk(x, out, target, parentScoped);
    return;
  }
  const types = Array.isArray(v["@type"]) ? v["@type"] : [v["@type"]];
  if (
    types.some((t: any) =>
      [
        "Apartment",
        "RealEstateListing",
        "House",
        "Residence",
        "Accommodation",
        "SingleFamilyResidence",
      ].includes(t),
    ) &&
    (v.url || v["@id"] ? sameListing(v.url || v["@id"], target) : parentScoped)
  ) {
    const address = exactAddress(v.address);
    if (address) out.address = address;
    if(/(?:OutOfStock|SoldOut|Discontinued)$/.test(String(v.offers?.availability||'')))out.source_unavailable=true;
    Object.assign(out, Object.fromEntries(Object.entries(structuredFacts(v, target)).filter(([k,val]) => k !== 'address' && k !== 'images' && val != null)));
    out.images = [...new Set([...(out.images || []), ...collectImages(v, target)])];
    const names: any = {
      warmmiete: "warm_rent",
      gesamtmiete: "total_rent",
      kaltmiete: "cold_rent",
      heizkosten: "heating_costs",
      nebenkosten: "additional_costs",
      betriebskosten: "operating_costs",
      kaution: "deposit",
    };
    for (const p of Array.isArray(v.additionalProperty)
      ? v.additionalProperty
      : []) {
      const key =
        names[
          String(p.name || "")
            .toLowerCase()
            .trim()
        ];
      const n = sourceMoney(p.value);
      if (key && n != null) out[key] = n;
    }
    const area = sourceMoney(v.floorSize?.value),
      rooms = sourceMoney(v.numberOfRooms);
    if (area != null) out.area_sqm = area;
    if (rooms != null) out.rooms = rooms;
  }
  // Linked-data graphs may contain unrelated organization and related-offer nodes.
  if (v["@graph"]) walk(v["@graph"], out, target);
  const ownScope =
    parentScoped ||
    (types.some((t: any) => ["RealEstateListing", "Offer"].includes(t)) &&
      sameListing(v.url || v["@id"], target));
  if (v.mainEntity) walk(v.mainEntity, out, target, ownScope);
  if (v.itemOffered) walk(v.itemOffered, out, target, ownScope);
}
async function enrich(l: any, persist = true) {
  if (!l.canonical_url) return {...l,_availability:'unknown'};
  if (l.raw?.provider === 'immosolve_hpm_rest') return {...l,_availability:recentInventory(l)?'recent_inventory':'unknown'};
  const out = { ...l, _availability:recentInventory(l)?'recent_inventory':'unknown' };
  const previous = l.enrichment_evidence?.preview;
  // Reuse detail evidence only when the source snapshot has not changed.
  // Always recheck availability; a cached preview alone is not availability evidence.
  try {
    let facts:any;
    const immomioId=String(l.canonical_url).match(/^https:\/\/tenant\.immomio\.com\/(?:de\/)?apply\/([0-9a-f-]{36})$/i)?.[1];
    if(immomioId){
      // Same anonymous property query used by the public application page.
      const response=await fetch('https://gql-ps.immomio.com/tenant/graphql',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'query property($id: ID!) { property(id:$id) { id type totalRentGross titleImage {url type encrypted} data {name showAddress address {street houseNumber zipCode city} basePrice totalRentGross serviceCharge heatingCost heatingCostIncluded bailment rooms halfRooms size floor flatType availableFrom{dateAvailable stringAvailable} attachments{url title type encrypted extension} } } }',variables:{id:immomioId}}),signal:AbortSignal.timeout(6500)});
      if(response.status===404||response.status===410)return {...out,_availability:'unavailable'};
      if(!response.ok)return out;
      const j=await response.json();
      if(j.errors?.length || j.data?.property?.id!==immomioId)return out;
      out._availability='online';
      facts=structuredFacts({property:j.data.property},l.canonical_url);
      facts.images=[...new Set([...facts.images,...collectImages(j.data.property,l.canonical_url)])];
    }else{
    const r = await fetch(String(l.canonical_url), {redirect:'follow',headers:{'user-agent':UA,accept:'text/html,application/xhtml+xml,application/json','accept-language':'de-DE,de;q=0.9'},signal:AbortSignal.timeout(6500)});
    const h = await r.text();
    const same=sameListing(r.url,l.canonical_url);
    const state=pageAvailability(r.status,same,h);
    if(state==='unavailable')return {...out,_availability:state};
    if(state==='unknown')return out;
    out._availability='online';
    facts = htmlFacts(h,l.canonical_url);
    for (const m of h.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try { walk(JSON.parse(m[1]),facts,l.canonical_url); } catch {}
    }
    }
    if(facts.source_unavailable)return {...out,_availability:'unavailable'};
    const evidence={...l.enrichment_evidence,preview:{version:3,canonical_url:l.canonical_url,checked_at:new Date().toISOString(),source_seen_at:l.last_seen_at,facts}};
    out.enrichment_evidence=evidence;
    const portalTargetCheck=[1,3].includes(Number(l.source_id));
    let persistedRaw=l.raw||{};
    if(portalTargetCheck){
      persistedRaw={...persistedRaw,portal_application_target_checked:true};
      const directTenant=typeof facts.applicationLink==="string" && /^https:\/\/tenant\.immomio\.com\/(?:de\/)?apply\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(facts.applicationLink)
        ? facts.applicationLink
        : null;
      if(directTenant){
        persistedRaw.applicationLink=directTenant;
        persistedRaw.applicationLinkSource="portal_detail";
      }else if(persistedRaw.applicationLinkSource==="portal_detail"){
        const {applicationLink:_removed,applicationLinkSource:_removedSource,...rest}=persistedRaw;
        persistedRaw=rest;
      }
      out.raw=persistedRaw;
    }
    if (persist) {
      const payload:any={enrichment_evidence:evidence};
      if(portalTargetCheck)payload.raw=persistedRaw;
      const {error}=await db.from('listings').update(payload).eq('id',l.id);
      if(error)console.error('preview_persist_failed',error.message);
      else if(portalTargetCheck){
        const {error:reconcileError}=await db.rpc('reconcile_listing_applications',{p_listing_id:l.id});
        if(reconcileError)console.error('portal_application_reconcile_failed',reconcileError.message);
      }
    }
  } catch(error) {console.error('listing_detail_fetch_failed',String(error).slice(0,200));}
  return out;
}

function sagaMeta(l:any){
  const facts=knownFacts(l),provider=String(facts.provider_entity||"");
  const ref=textValue(facts.saga_object_ref);
  const application=textValue(facts.applicationLink);
  return{facts,isSaga:provider==="SAGA",ref,application};
}
async function immomioApplicationAvailability(value:any){
  if(typeof value!=="string")return "missing";
  const match=value.trim().match(/^https:\/\/tenant\.immomio\.com\/(?:de\/)?apply\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
  if(!match)return "missing";
  const id=match[1];
  try{
    const response=await fetch("https://gql-ps.immomio.com/tenant/graphql",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({query:"query sagaAvailability($id: ID!) { property(id:$id) { id } }",variables:{id}}),
      signal:AbortSignal.timeout(6500)
    });
    if(response.status===404||response.status===410)return "unavailable";
    if(!response.ok)return "unknown";
    const payload=await response.json().catch(()=>null);
    if(payload?.data?.property?.id===id)return "online";
    if(payload?.data && payload.data.property===null)return "unavailable";
    return "unknown";
  }catch{return "unknown";}
}
async function recordSagaProbe(l:any,meta:any,immomioStatus:string,errorMessage:string|null=null){
  const {data,error}=await db.rpc("record_saga_probe",{
    p_listing_id:l.id,
    p_is_saga:meta.isSaga,
    p_saga_ref:meta.ref,
    p_application_url:meta.application,
    p_immomio_status:immomioStatus,
    p_error:errorMessage
  });
  if(error)throw error;
  return data||{};
}
async function hydrateSagaListing(l:any){
  const meta=sagaMeta(l);
  if(!meta.isSaga)return{listing:l,meta,status:"not_saga",record:null};
  if(!meta.ref||!meta.application){
    const missing=!meta.ref?"missing_saga_reference":"missing_immomio_application";
    const record=await recordSagaProbe(l,meta,"missing",missing);
    const inherited=typeof record?.application_url==="string" ? record.application_url : null;
    const portalTargetChecked=[1,3].includes(Number(l.source_id)) && l.raw?.portal_application_target_checked===true;
    if(!portalTargetChecked && meta.ref && inherited && record?.immomio_status==="online"){
      const listing={...l,raw:{...(l.raw||{}),provider_entity:"SAGA",saga_object_ref:meta.ref,applicationLink:inherited}};
      return{listing,meta:sagaMeta(listing),status:"online",record};
    }
    return{listing:l,meta,status:"missing",record};
  }
  const status=await immomioApplicationAvailability(meta.application);
  const record=await recordSagaProbe(l,meta,status,status==="unknown"?"immomio_availability_unknown":null);
  return{listing:l,meta,status,record};
}
async function sagaAlreadyReceived(userId:string,ref:string,eventId:string){
  const {data,error}=await db.rpc("saga_delivery_already_received",{
    p_user_id:userId,p_saga_ref:ref,p_exclude_event_id:eventId
  });
  if(error)throw error;
  return data===true;
}
async function probeSagaRecoveryCandidate(){
  const {data:id,error:idError}=await db.rpc("next_saga_recovery_probe_candidate");
  if(idError)throw idError;
  if(!id)return{checked:0};
  const {data,error}=await db.from("listings")
    .select("*,sources(name,button_label,source_type,baseline_completed_at,enabled,runtime_mode,delivery_mode,source_connectors(config,enabled,priority))")
    .eq("id",id).single();
  if(error)throw error;
  const listing=data;
  const meta=sagaMeta(listing);
  if(!meta.isSaga || !meta.ref){
    return{checked:1,is_saga:meta.isSaga,queued:0,status:"missing"};
  }
  const hydrated=await hydrateSagaListing(listing);
  if(hydrated.status!=="online")return{checked:1,is_saga:true,queued:0,status:hydrated.status};
  const {data:queued,error:queueError}=await db.rpc("queue_saga_recovery",{p_listing_id:listing.id});
  if(queueError)throw queueError;
  return{checked:1,is_saga:true,queued:Number(queued||0),status:"online"};
}

async function uploadOperation(t:string,chat:number,op:any) {
  const f=new FormData(); f.set('chat_id',String(chat));
  const media=op.method==='sendMediaGroup'?op.body.media:[{type:'photo',media:op.body.photo}];
  for(let i=0;i<media.length;i++) {
    const r=await fetch(media[i].media,{headers:{'user-agent':UA,accept:'image/*'},signal:AbortSignal.timeout(6500)});
    const photo=await sourcePhoto(r);
    f.set(op.method==='sendPhoto'?'photo':`image${i}`,photo,`image${i}.${photo.type.split('/')[1]}`);
  }
  if(op.method==='sendMediaGroup')f.set('media',JSON.stringify(media.map((m:any,i:number)=>({...m,media:`attach://image${i}`}))));
  else for(const [k,v] of Object.entries(op.body))if(k!=='photo')f.set(k,typeof v==='string'?v:JSON.stringify(v));
  return telegramRequest(`https://api.telegram.org/bot${t}/${op.method}`,{method:'POST',body:f});
}
async function syncApplicationStatus(userId:string,listingId:string,tokenOverride:string|null=null){
  if(!/^[0-9a-f-]{36}$/i.test(userId)||!/^[0-9a-f-]{36}$/i.test(listingId))throw new Error("invalid_sync_target");
  const [{data:user,error:userError},{data:listing,error:listingError},{data:events,error:eventError},{data:sub,error:subError},app]=await Promise.all([
    db.from("bot_users").select("id,chat_id,is_active,ui_language,plan_override,plan_override_expires_at,referral_bonus_until").eq("id",userId).maybeSingle(),
    db.from("listings").select("*,sources(name,button_label,source_type,baseline_completed_at,enabled,runtime_mode,delivery_mode,source_connectors(config,enabled,priority))").eq("id",listingId).maybeSingle(),
    db.from("delivery_events").select("id,telegram_message_id,preview_progress,created_at").eq("recipient_user_id",userId).eq("listing_id",listingId).eq("event_type","new_listing").eq("channel","telegram").eq("status","sent").not("telegram_message_id","is",null).order("created_at",{ascending:false}).limit(5),
    db.from("user_subscriptions").select("status,current_period_end,updated_at").eq("user_id",userId).in("status",["active","trialing"]).order("updated_at",{ascending:false}).limit(1).maybeSingle(),
    applicationState(userId,listingId),
  ]);
  if(userError||listingError||eventError||subError)throw userError||listingError||eventError||subError;
  if(!user||!listing||!events?.length)return{ok:true,updated:0,pending_preview:true};
  const paid=!!sub&&(!sub.current_period_end||new Date(sub.current_period_end)>new Date()),isPremium=premium(user,paid),rendered=await withHamburgGeo(listing),statusKey=applicationStatusKey(app);
  const caption=cap(rendered,user.ui_language||"de",app),keyboard=kb(rendered,user.ui_language||"de",isPremium,userId),token=tokenOverride||await sec("telegram_bot_token_runtime");
  let updated=0,skipped=0;
  for(const event of events){
    const state=event.preview_progress&&typeof event.preview_progress==="object"?structuredClone(event.preview_progress):{};
    const operations=Array.isArray(state.operations)?state.operations:[],storedMarkup=JSON.stringify(operations.map((op:any)=>op?.body?.reply_markup||null));
    const hasLegacyApplicationControls=/Auto-Bewerbung|Automatisch beworben|Plus erforderlich|Bewerbung läuft|Manuell bewerben|Profil vervollständigen|Postfach prüfen|Bereits beworben|Immomio öffnen/.test(storedMarkup);
    if(state.application_status_key===statusKey&&Number(state.preview_ui_revision||0)===2&&!hasLegacyApplicationControls){skipped++;continue;}
    const next=Math.max(0,Math.min(Number(state.next||operations.length),operations.length)),last=operations.length?operations[Math.max(0,next-1)]:null;
    const isPhoto=last?.method==="sendPhoto"&&!!last?.body?.caption;
    try{
      await tg(token,isPhoto?"editMessageCaption":"editMessageText",isPhoto
        ?{chat_id:Number(user.chat_id),message_id:Number(event.telegram_message_id),caption,parse_mode:"HTML",reply_markup:keyboard}
        :{chat_id:Number(user.chat_id),message_id:Number(event.telegram_message_id),text:caption,parse_mode:"HTML",disable_web_page_preview:true,reply_markup:keyboard});
    }catch(error:any){
      if(!/message is not modified/i.test(String(error?.message||error)))throw error;
    }
    state.application_status_key=statusKey;
    state.preview_ui_revision=2;
    if(last?.body){
      if(isPhoto)last.body.caption=caption;
      else if(last?.method==="sendMessage")last.body.text=caption;
      last.body.reply_markup=keyboard;
    }
    await db.from("delivery_events").update({preview_progress:state}).eq("id",event.id);
    updated++;
  }
  return{ok:true,updated,skipped,statusKey};
}
async function send(t:string,chat:number,l:any,lang:string,p:boolean,userId:string,lease:any,previous:any) {
  l=await withHamburgGeo(l);
  const app=await applicationState(userId,String(l.id)),statusKey=applicationStatusKey(app);
  const facts=knownFacts(l),keyboard=kb(l,lang,p,userId),operations=previewOperations(facts.images,cap(l,lang,app),keyboard);
  const result=await deliverPreview(operations,previous,async state=>{
    const {data,error}=await db.from('delivery_events').update({preview_progress:{...state,application_status_key:statusKey,preview_ui_revision:2}}).eq('id',lease.id).eq('status','processing').eq('dispatch_attempts',lease.attempt).eq('last_attempt_at',lease.claimedAt).select('id').maybeSingle();
    if(error||!data)throw new Error('Gallery checkpoint could not be saved');
  },(op,upload)=>upload?uploadOperation(t,chat,op):tg(t,op.method,{chat_id:chat,...op.body}));
  return{...result,application_status_key:statusKey};
}
Deno.serve(async (req) => {
  const owner = crypto.randomUUID();
  let acquired = false;
  try {
    if (req.method !== "POST")
      return new Response("method not allowed", { status: 405 });
    if (
      (req.headers.get("x-internal-secret") || "") !==
      (await sec("internal_worker_secret"))
    )
      return new Response("unauthorized", { status: 401 });
    const input = await req.json().catch(() => ({}));
    if (input.action === "sync_application_status") return Response.json(await syncApplicationStatus(String(input.userId||""),String(input.listingId||"")));
    if (input.dry_run && input.listing_id) {
      const {data,error}=await db.from('listings').select('*,sources(name,button_label,source_type,baseline_completed_at,enabled,runtime_mode,delivery_mode,source_connectors(config,enabled,priority))').eq('id',input.listing_id).single();
      if(error)throw error;
      let listing=await enrich(data,false);
      listing=await withHamburgGeo(listing);
      const facts=knownFacts(listing),newness=await deliveryNewnessCheck(listing,'new_listing',facts.published_text);
      const probePremium=input.premium!==false,probeUserId=String(input.user_id||"probe"),validProbeUser=/^[0-9a-f-]{36}$/i.test(probeUserId),probeApp=validProbeUser?await applicationState(probeUserId,String(listing.id)):null;
      if(input.probe_image && facts.images.length){
        const response=await fetch(facts.images[0],{headers:{'user-agent':UA,accept:'image/*'},signal:AbortSignal.timeout(6500)});
        const declared_type=response.headers.get('content-type');
        try{const photo=await sourcePhoto(response);return Response.json({ok:true,dry_run:true,availability:listing._availability,image_probe:{declared_type,validated_type:photo.type,bytes:photo.size},operations:previewOperations(facts.images,cap(listing,'de',probeApp),kb(listing,'de',probePremium,probeUserId)).map(x=>x.method)});}
        catch(e){return Response.json({ok:false,dry_run:true,image_probe:{declared_type,error:String(e)}});}
      }
      return Response.json({ok:true,dry_run:true,caption:cap(listing,'de',probeApp),keyboard:kb(listing,'de',probePremium,probeUserId),images:facts.images,availability:listing._availability,newness,address:loc(listing),operations:previewOperations(facts.images,cap(listing,'de',probeApp),kb(listing,'de',probePremium,probeUserId)).map(x=>x.method)});
    }
    if (input.dry_run) {
      const { error } = await db.from("delivery_events").select("id").limit(1);
      if (error) throw error;
      return Response.json({
        ok: true,
        dry_run: true,
        send_interval_seconds: 15,
      });
    }
    const { data: locked, error: lockError } = await db.rpc(
      "acquire_dispatcher",
      { p_owner: owner },
    );
    if (lockError) throw lockError;
    if (!locked) return Response.json({ ok: true, busy: true });
    acquired = true;
    const deadline = Date.now() + 50_000;
    // SAGA candidate discovery is paused until the database query path is indexed
    // and scheduled independently; it previously caused 100-150s dispatcher runs.
    await recoverDeliveries(db);
    const now = new Date().toISOString();
    const { data: events, error } = await db
      .from("delivery_events")
      .select(
        "id,status,event_type,dispatch_attempts,preview_progress,recipient:bot_users!delivery_events_recipient_user_id_fkey(id,chat_id,is_active,ui_language),search_profiles!inner(id,profile_slot,is_active,owner:bot_users!search_profiles_user_id_fkey(id,is_active,plan_override,plan_override_expires_at,referral_bonus_until)),listings!inner(*,sources(name,button_label,source_type,baseline_completed_at,enabled,runtime_mode,delivery_mode,source_connectors(config,enabled,priority)))",
      )
      .in("status", ["pending", "failed"])
      .eq("channel", "telegram")
      .eq("delivery_outcome_unknown", false)
      .lt("dispatch_attempts", 5)
      .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
      .order("dispatch_attempts", { ascending: true })
      .order("created_at")
      .limit(25);
    if (error) throw error;
    if (!events?.length) return Response.json({ok:true,totals:{sent:0,failed:0,skipped:0}});
    const token = await sec("telegram_bot_token_runtime");
    const { data: cutoverEnabled, error: cutoverEnabledError } = await db.rpc("get_bot_secret", { secret_name: "delivery_cutover_bridge_enabled" });
    if (cutoverEnabledError) throw cutoverEnabledError;
    const cutoverSecret = String(cutoverEnabled || "") === "1" ? await sec("delivery_cutover_bridge_secret") : null;
    const ownerIds = [...new Set(events.map((event: any) => event.search_profiles?.owner?.id).filter(Boolean))];
    const { data: subs, error: subscriptionError } = ownerIds.length
      ? await db.from("user_subscriptions")
        .select("user_id,status,current_period_end")
        .in("user_id", ownerIds)
      : { data: [], error: null };
    if (subscriptionError) throw subscriptionError;
    const paid = new Set(
      (subs || [])
        .filter(
          (s: any) =>
            ["active", "trialing"].includes(s.status) &&
            (!s.current_period_end ||
              new Date(s.current_period_end) > new Date()),
        )
        .map((s: any) => String(s.user_id)),
    );
    let sent = 0,
      failed = 0,
      skipped = 0;
    const cache = new Map<string, Promise<any>>();
    for (const event of events || []) {
      if (!(await waitForDispatchSlot(db, owner, deadline))) break;
      const lease = await claimDelivery(db, event);
      if (!lease) continue;
      const profile = event.search_profiles as any,
        profileOwner = profile?.owner,
        recipient = event.recipient as any,
        raw = event.listings as any;
      const isPremium = premium(
        profileOwner,
        paid.has(String(profileOwner?.id || "")),
      );
      if (
        !profile?.is_active ||
        !profileOwner?.is_active ||
        !recipient?.is_active ||
        (!isPremium && Number(profile.profile_slot || 1) > 1)
      ) {
        await finishDelivery(db, lease, {
          status: "skipped",
          next_retry_at: null,
        });
        skipped++;
        continue;
      }
      let message: any;
      let cutover: ((action: string) => Promise<string>) | null = null;
      let cutoverOwned = false, sendAttempted = false;
      try {
        let task = cache.get(String(raw.id));
        if (!task) {
          task = enrich(raw);
          cache.set(String(raw.id), task);
        }
        let listing = await task;
        const saga=await hydrateSagaListing(listing);
        listing=saga.listing;
        if(saga.meta.ref && await sagaAlreadyReceived(String(recipient.id),saga.meta.ref,String(event.id))){
          await finishDelivery(db,lease,{status:'skipped',next_retry_at:null,error_message:'SAGA object already delivered via another portal'});
          skipped++;continue;
        }
        if(String(event.event_type)==='still_active'){
          if(!saga.meta.isSaga || !saga.meta.ref || !saga.meta.application){
            await finishDelivery(db,lease,{status:'skipped',next_retry_at:null,error_message:'SAGA recovery metadata incomplete'});
            skipped++;continue;
          }
          if(saga.status==='unavailable'){
            await finishDelivery(db,lease,{status:'skipped',next_retry_at:null,error_message:'Immomio confirms SAGA application unavailable'});
            skipped++;continue;
          }
          if(saga.status!=='online')throw new TelegramFailure('SAGA Immomio availability could not be verified; retry later',false,false,300);
          listing={...listing,_saga_recovery:true};
        }
        const newness=await deliveryNewnessCheck(listing,event.event_type,knownFacts(listing).published_text);
        if(!newness.ok){
          await finishDelivery(db,lease,{status:'skipped',next_retry_at:null,error_message:`Newness guard: ${newness.reason}`});
          skipped++;continue;
        }
        if(listing.source_id===21 || listing._availability==='unavailable') {
          if(listing._availability==='unavailable') {
            const {error}=await db.from('listings').update({is_active:false}).eq('id',listing.id);
            if(error)throw error;
          }
          await finishDelivery(db,lease,{status:'skipped',next_retry_at:null,error_message:listing.source_id===21?'Publication freshness unverified':'Source confirms listing unavailable'});
          skipped++;continue;
        }
        if(!['online','recent_inventory'].includes(listing._availability))throw new TelegramFailure('Listing availability could not be verified; retry later',false,false,300);
        const { error: slotError } = await db.rpc("dispatcher_slot", {
          p_owner: owner,
          p_complete: true,
        });
        if (slotError) throw slotError;
        if (cutoverSecret && shouldProtectDelivery(event.event_type, raw.source_id, raw.canonical_url)) {
          cutover = (action: string) => callCutoverBridge(cutoverSecret, action, String(recipient.id), String(raw.canonical_url || ""), String(event.id));
          const previous = event.preview_progress && typeof event.preview_progress === "object" ? event.preview_progress : null;
          let reservation = !previous || (previous.version === 1 && !previous.in_flight)
            ? await cutover(previous?.version === 1 && Number(previous.next || 0) > 0 ? "resume_partial" : "resume")
            : "not_owner";
          if (reservation === "sending") cutoverOwned = true;
          else {
            reservation = await cutover("claim");
            if (reservation === "already_sent") {
              await finishDelivery(db, lease, { status: "skipped", next_retry_at: null, error_message: "Already delivered during Cloudflare cutover" });
              skipped++; continue;
            }
            if (reservation === "unknown") throw new TelegramFailure("Cutover delivery outcome is unknown", true);
            if (reservation !== "claimed") throw new TelegramFailure("Cutover delivery is in progress", false, false, 120);
            cutoverOwned = true;
            if (await cutover("begin") !== "sending") throw new TelegramFailure("Cutover reservation expired", false, false, 120);
          }
        }
        sendAttempted = true;
        message = await send(
          token,
          Number(recipient.chat_id),
          listing,
          recipient.ui_language || "de",
          isPremium,
          String(profileOwner?.id || recipient?.id || ""),
          lease,
          event.preview_progress,
        );
      } catch (error) {
        if (cutover && cutoverOwned) {
          if (!sendAttempted) await cutover("release").catch(() => {});
          else {
            const { data: current, error: progressError } = await db.from("delivery_events").select("preview_progress").eq("id", lease.id).maybeSingle().catch(() => ({ data: null, error: true }));
            const progress = current?.preview_progress;
            if (progressError || !(error instanceof TelegramFailure) || error.outcomeUnknown || progress?.in_flight) await cutover("unknown").catch(() => {});
            else if (progress?.version === 1 && Number(progress.next || 0) > 0) {
              if (await cutover("sent").catch(() => "unavailable") !== "sent") console.error("cutover_delivery_confirmation_failed");
            }
            else await cutover("release").catch(() => {});
          }
        }
        await finishDelivery(db, lease, {
          status: "failed",
          delivery_outcome_unknown:
            error instanceof TelegramFailure && error.outcomeUnknown,
          next_retry_at:
            error instanceof TelegramFailure && error.outcomeUnknown
              ? null
              : new Date(
                  Date.now() +
                    Math.max(
                      120000,
                      error instanceof TelegramFailure
                        ? error.retryAfter * 1000
                        : 0,
                    ),
                ).toISOString(),
          error_message: String(error),
        });
        failed++;
        continue;
      }
      if (cutover && cutoverOwned && await cutover("sent").catch(() => "unavailable") !== "sent") console.error("cutover_delivery_confirmation_failed");
      const { error: gapError } = await db.rpc("dispatcher_slot", {
        p_owner: owner,
        p_complete: true,
      });
      if (gapError) throw gapError;
      // A sent message and a failed DB acknowledgement are different failures.
      // Leave the lease for recovery instead of immediately sending again.
      await finishDelivery(db, lease, {
        status: "sent",
        telegram_message_id: message?.message_id || null,
        sent_at: new Date().toISOString(),
        error_message: null,
        next_retry_at: null,
      });
      try{await syncApplicationStatus(String(recipient?.id||profileOwner?.id||""),String(raw.id),token);}catch(error){console.error("application_status_sync_after_delivery_failed",String(error).slice(0,200));}
      sent++;
    }
    return Response.json({ ok: true, totals: { sent, failed, skipped } });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  } finally {
    if (acquired) {
      const { error } = await db.rpc("release_dispatcher", { p_owner: owner });
      if (error) console.error("dispatcher_release", error.message);
    }
  }
});
