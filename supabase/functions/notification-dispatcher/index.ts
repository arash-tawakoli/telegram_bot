import {pageAvailability,recentInventory} from './availability.ts';
import {previewOperations,deliverPreview,sourcePhoto} from "./preview-delivery.ts";
import {present, textValue, exactAddress, structuredFacts, collectImages, htmlFacts} from "./source-facts.ts";
import { telegramRequest, TelegramFailure } from "./telegram-request.ts";
import { waitForDispatchSlot } from "./pacing.ts";
import {
  claimDelivery,
  finishDelivery,
  recoverDeliveries,
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
    "Mozilla/5.0 (compatible; TraumwohnungHamburgBot/15.0; +https://traumwohnunghamburg.de)";
async function sec(n: string) {
  const { data, error } = await db.rpc("get_bot_secret", { secret_name: n });
  if (error || !data) throw new Error("secret unavailable");
  return String(data);
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
  const out = {...l, ...direct, ...detail};
  // Old DB values can include inferred addresses, default types and calculated rents.
  out.address = loc(l);
  out.property_type = detail.property_type ?? direct.property_type ?? null;
  out.deposit_text = detail.deposit_text ?? direct.deposit_text ?? null;
  if (l.warm_rent_is_calculated && direct.warm_rent == null && detail.warm_rent == null) out.warm_rent = null;
  out.images = collectImages({images:[...(detail.images || []), ...(direct.images || []), l.resolved_image_url, l.image_url]},l.canonical_url);
  return out;
}
function cap(l: any, lang: string) {
  l = knownFacts(l);
  const lines = [
    `🏠 <b>${esc(String(l.title || "Listing").slice(0, 180))}</b>`,
    "",
  ];
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
    [
      "nestpick_public_api",
      "city_wohnen_catalog",
      "wunderflats_catalog",
    ].includes(l.raw?.provider) &&
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
  if (present(l.borough)) lines.push(`📍 <b>Bezirk:</b> ${esc(l.borough)}`);
  if (present(l.district)) lines.push(`📍 <b>Stadtteil:</b> ${esc(l.district)}`);
  if (present(l.published_text)) lines.push(`<b>Veröffentlicht laut Quelle:</b> ${esc(l.published_text)}`);
  if (l.features?.length) lines.push(`<b>Ausstattung:</b> ${l.features.map(esc).join(', ')}`);
  for(const [key,value] of Object.entries(l.extra_facts||{}))if(present(value))lines.push(`<b>${esc(key)}:</b> ${esc(value)}`);
  if (loc(l)) lines.push(`📍 <b>${label(lang, "address")}:</b> ${esc(loc(l))}`);
  return lines.join("\n").trim();
}
function offerTarget(l: any, lang: string) {
  const fallback = {url:l.canonical_url, text:l.sources?.button_label ? `Zu ${l.sources.button_label}` : label(lang,"offer")};
  if (l.sources?.source_type !== "Baugenossenschaft") return fallback;
  const tenant = (value:any, registration=false) => {
    if (typeof value !== "string") return null;
    try {
      const u=new URL(value);
      if(u.protocol!=="https:" || u.hostname!=="tenant.immomio.com" || u.port || u.username || u.password) return null;
      const valid=registration
        ? /^\/(?:de\/)?auth\/register\/propertyLocation\/?$/.test(u.pathname) && !!u.searchParams.get("token")
        : /^\/(?:de\/)?apply\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(u.pathname);
      return valid ? value : null;
    } catch { return null; }
  };
  const direct=tenant(l.canonical_url) || tenant(l.raw?.applicationLink);
  if(direct) return {url:direct,text:label(lang,"offer")};
  const connectors=[...(l.sources?.source_connectors || [])].filter((c:any)=>c.enabled).sort((a:any,b:any)=>a.priority-b.priority);
  for(const c of connectors) {
    const portal=tenant(c.config?.tenant_registration_url,true);
    if(portal) return {url:portal,text:"ImmoMio-Registrierung"};
  }
  return fallback;
}
function kb(l: any, lang: string, p: boolean) {
  const r: any[] = [
      [
        !p && String(l.sources?.source_type || "") === "Baugenossenschaft"
          ? { text: "🔒 Angebot öffnen · 💎 Premium", callback_data: "premium" }
          : {
              ...offerTarget(l,lang),
            },
      ],
    ],
    q = mapLoc(l);
  if (q)
    r.push([
      {
        text: label(lang, "maps"),
        url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
      },
    ]);
  r.push([
    p
      ? { text: label(lang, "save"), callback_data: `save:${l.id}` }
      : { text: `🔒 ${label(lang, "save")}`, callback_data: "premium" },
  ]);
  return { inline_keyboard: r };
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
    const state=pageAvailability(r.status,sameListing(r.url,l.canonical_url),h);
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
    if (persist) {
      const {error}=await db.from('listings').update({enrichment_evidence:evidence}).eq('id',l.id);
      if(error)console.error('preview_persist_failed',error.message);
    }
  } catch(error) {console.error('listing_detail_fetch_failed',String(error).slice(0,200));}
  return out;
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
async function send(t:string,chat:number,l:any,lang:string,p:boolean,lease:any,previous:any) {
  const facts=knownFacts(l),operations=previewOperations(facts.images,cap(l,lang),kb(l,lang,p));
  return deliverPreview(operations,previous,async state=>{
    const {data,error}=await db.from('delivery_events').update({preview_progress:state}).eq('id',lease.id).eq('status','processing').eq('dispatch_attempts',lease.attempt).eq('last_attempt_at',lease.claimedAt).select('id').maybeSingle();
    if(error||!data)throw new Error('Gallery checkpoint could not be saved');
  },(op,upload)=>upload?uploadOperation(t,chat,op):tg(t,op.method,{chat_id:chat,...op.body}));
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
    if (input.dry_run && input.listing_id) {
      const {data,error}=await db.from('listings').select('*,sources(button_label,source_type,source_connectors(config,enabled,priority))').eq('id',input.listing_id).single();
      if(error)throw error;
      const listing=await enrich(data,false),facts=knownFacts(listing);
      if(input.probe_image && facts.images.length){
        const response=await fetch(facts.images[0],{headers:{'user-agent':UA,accept:'image/*'},signal:AbortSignal.timeout(6500)});
        const declared_type=response.headers.get('content-type');
        try{const photo=await sourcePhoto(response);return Response.json({ok:true,dry_run:true,availability:listing._availability,image_probe:{declared_type,validated_type:photo.type,bytes:photo.size},operations:previewOperations(facts.images,cap(listing,'de'),kb(listing,'de',true)).map(x=>x.method)});}
        catch(e){return Response.json({ok:false,dry_run:true,image_probe:{declared_type,error:String(e)}});}
      }
      return Response.json({ok:true,dry_run:true,caption:cap(listing,'de'),keyboard:kb(listing,'de',true),images:facts.images,availability:listing._availability,address:loc(listing),operations:previewOperations(facts.images,cap(listing,'de'),kb(listing,'de',true)).map(x=>x.method)});
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
    await recoverDeliveries(db);
    const now = new Date().toISOString();
    const { data: events, error } = await db
      .from("delivery_events")
      .select(
        "id,status,dispatch_attempts,preview_progress,recipient:bot_users!delivery_events_recipient_user_id_fkey(id,chat_id,is_active,ui_language),search_profiles!inner(id,profile_slot,is_active,owner:bot_users!search_profiles_user_id_fkey(id,is_active,plan_override,plan_override_expires_at,referral_bonus_until)),listings!inner(*,sources(button_label,source_type,source_connectors(config,enabled,priority)))",
      )
      .in("status", ["pending", "failed"])
      .eq("delivery_outcome_unknown", false)
      .lt("dispatch_attempts", 5)
      .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
      .order("created_at")
      .limit(200);
    if (error) throw error;
    if (!events?.length) return Response.json({ok:true,totals:{sent:0,failed:0,skipped:0}});
    const token = await sec("telegram_bot_token_runtime");
    const { data: subs, error: subscriptionError } = await db
      .from("user_subscriptions")
      .select("user_id,status,current_period_end");
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
      try {
        let task = cache.get(String(raw.id));
        if (!task) {
          task = enrich(raw);
          cache.set(String(raw.id), task);
        }
        const listing = await task;
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
        message = await send(
          token,
          Number(recipient.chat_id),
          listing,
          recipient.ui_language || "de",
          isPremium,
          lease,
          event.preview_progress,
        );
      } catch (error) {
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
