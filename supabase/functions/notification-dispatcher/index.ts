import {telegramRequest,TelegramFailure} from "./telegram-request.ts";
import {waitForDispatchSlot} from "./pacing.ts";
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
  if (l.address && String(l.address).trim()) return String(l.address).trim();
  const p = [l.postal_code, l.district, l.city || "Hamburg"].filter(Boolean);
  return p.length ? p.join(" ") : null;
}
function cap(l: any, lang: string) {
  return `🏠 <b>${esc(String(l.title || "Listing").slice(0, 180))}</b>\n\n${l.warm_rent != null ? `💶 <b>${label(lang, "warm")}:</b> ${l.warm_rent} €\n` : ""}${l.cold_rent != null ? `❄️ <b>${label(lang, "cold")}:</b> ${l.cold_rent} €\n` : ""}${l.area_sqm != null ? `📐 <b>${label(lang, "area")}:</b> ${l.area_sqm} m²\n` : ""}${l.rooms != null ? `🚪 <b>${label(lang, "rooms")}:</b> ${l.rooms}\n` : ""}${loc(l) ? `📍 <b>${label(lang, "address")}:</b> ${esc(loc(l))}` : ""}`.trim();
}
function kb(l: any, lang: string, p: boolean) {
  const r: any[] = [
      [
        !p && String(l.sources?.source_type || "") === "Baugenossenschaft"
          ? { text: "🔒 Angebot öffnen · 💎 Premium", callback_data: "premium" }
          : {
              text: l.sources?.button_label
                ? `Zu ${l.sources.button_label}`
                : label(lang, "offer"),
              url: l.canonical_url,
            },
      ],
    ],
    q = loc(l);
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
async function tg(t:string,m:string,b:any){return telegramRequest(`https://api.telegram.org/bot${t}/${m}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});}
function absolute(base: string, v: any) {
  try {
    return v ? new URL(String(v), base).href : null;
  } catch {
    return null;
  }
}
function walk(v: any, out: any) {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (const x of v) walk(x, out);
    return;
  }
  const a = v.address && typeof v.address === "object" ? v.address : null;
  if (a) {
    out.address ||=
      a.streetAddress ||
      [a.street, a.houseNumber].filter(Boolean).join(" ") ||
      null;
    out.postal_code ||= a.postalCode || a.zipCode || null;
    out.district ||= a.district || null;
  }
  if (!out.image) {
    const im = v.image;
    if (typeof im === "string") out.image = im;
    else if (Array.isArray(im)) {
      const x = im[0];
      out.image = typeof x === "string" ? x : x?.url || x?.contentUrl;
    } else if (im && typeof im === "object")
      out.image = im.url || im.contentUrl;
  }
  for (const x of Object.values(v)) walk(x, out);
}
async function enrich(l: any) {
  if (
    !l.canonical_url ||
    ((l.address || l.enrichment_checked_at) &&
      (l.resolved_image_url || l.image_status === "failed"))
  )
    return l;
  const out = { ...l },
    patch: any = { enrichment_checked_at: new Date().toISOString() };
  try {
    const r = await fetch(String(l.canonical_url), {
      redirect: "follow",
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,*/*",
        "accept-language": "de-DE,de;q=0.9",
      },
      signal: AbortSignal.timeout(6500),
    });
    if (r.ok) {
      const h = await r.text(),
        facts: any = {};
      for (const m of h.matchAll(
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
      ))
        try {
          walk(JSON.parse(m[1]), facts);
        } catch {}
      facts.image ||=
        h.match(
          /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i,
        )?.[1] ||
        h.match(
          /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
        )?.[1];
      if (!facts.address) {
        const text = h
          .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
          .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ");
        facts.address =
          text.match(
            /([A-ZÄÖÜ][A-Za-zÄÖÜäöüß .'-]{1,60}(?:straße|strasse|str\.|weg|allee|ring|platz|chaussee|damm|kamp|stieg|ufer|twiete|gasse)\s+[0-9]{1,4}[a-zA-Z]?)/i,
          )?.[1] || null;
      }
      if (facts.address && !out.address) {
        out.address = String(facts.address).trim();
        patch.address = out.address;
      }
      if (facts.postal_code && !out.postal_code) {
        out.postal_code = String(facts.postal_code);
        patch.postal_code = out.postal_code;
      }
      if (facts.district && !out.district) {
        out.district = String(facts.district);
        patch.district = out.district;
      }
      if (facts.image && !out.resolved_image_url) {
        const u = absolute(r.url, facts.image);
        if (u) {
          out.resolved_image_url = u;
          out.image_url ||= u;
          patch.resolved_image_url = u;
          if (!l.image_url) patch.image_url = u;
          patch.image_status = "direct";
          patch.image_source = "detail_page";
          patch.image_error = null;
          patch.image_last_checked_at = new Date().toISOString();
        }
      }
    }
  } catch {}
  if (Object.keys(patch).length)
    await db.from("listings").update(patch).eq("id", l.id);
  return out;
}
async function multipartPhoto(
  t: string,
  chat: number,
  image: string,
  l: any,
  lang: string,
  p: boolean,
) {
  const r = await fetch(image, {
    redirect: "follow",
    headers: { "user-agent": UA, accept: "image/*,*/*" },
    signal: AbortSignal.timeout(6500),
  });
  if (!r.ok) throw new Error(`image HTTP ${r.status}`);
  const ct = r.headers.get("content-type") || "image/jpeg";
  if (!ct.startsWith("image/") || ct.includes("avif"))
    throw new Error(`unsupported image ${ct}`);
  const blob = await r.blob(),
    f = new FormData();
  f.set("chat_id", String(chat));
  f.set(
    "photo",
    blob,
    ct.includes("png")
      ? "listing.png"
      : ct.includes("webp")
        ? "listing.webp"
        : "listing.jpg",
  );
  f.set("caption", cap(l, lang));
  f.set("parse_mode", "HTML");
  f.set("reply_markup", JSON.stringify(kb(l, lang, p)));
  return telegramRequest(`https://api.telegram.org/bot${t}/sendPhoto`,{method:'POST',body:f});
}
async function recordImage(listingId:string,patch:any){
 try {const {error}=await db.from('listings').update(patch).eq('id',listingId);if(error)console.error('image_metadata',error.message);}
 catch{console.error('image_metadata_unavailable');}
}
async function send(t:string,chat:number,l:any,lang:string,p:boolean){
 const imgs=[l.resolved_image_url,l.image_url].filter(Boolean).map(String).filter((x,i,a)=>a.indexOf(x)===i);
 let err:any;
 for(const image of imgs){
  try{
   const message=await tg(t,'sendPhoto',{chat_id:chat,photo:image,caption:cap(l,lang),parse_mode:'HTML',reply_markup:kb(l,lang,p)});
   await recordImage(l.id,{resolved_image_url:image,image_status:'direct',image_error:null,image_last_checked_at:new Date().toISOString()});
   return message;
  }catch(error){
   if(!(error instanceof TelegramFailure)||!error.allowImageFallback)throw error;
   err=error;
   try{
    const message=await multipartPhoto(t,chat,image,l,lang,p);
    await recordImage(l.id,{resolved_image_url:image,image_status:'direct',image_source:'dispatcher_upload',image_error:null,image_last_checked_at:new Date().toISOString()});
    return message;
   }catch(uploadError){if(uploadError instanceof TelegramFailure&&!uploadError.allowImageFallback)throw uploadError;err=uploadError;}
  }
 }
 if(imgs.length)await recordImage(l.id,{image_status:'failed',image_error:String(err).slice(0,300),image_last_checked_at:new Date().toISOString()});
 return tg(t,'sendMessage',{chat_id:chat,text:cap(l,lang),parse_mode:'HTML',disable_web_page_preview:true,reply_markup:kb(l,lang,p)});
}
Deno.serve(async (req) => {
  const owner=crypto.randomUUID();let acquired=false;
  try {
    if (req.method !== "POST")
      return new Response("method not allowed", { status: 405 });
    if (
      (req.headers.get("x-internal-secret") || "") !==
      (await sec("internal_worker_secret"))
    )
      return new Response("unauthorized", { status: 401 });
    if ((await req.json().catch(()=>({}))).dry_run) {
      const {error}=await db.from('delivery_events').select('id').limit(1);
      if(error)throw error;return Response.json({ok:true,dry_run:true,send_interval_seconds:15});
    }
    const {data:locked,error:lockError}=await db.rpc('acquire_dispatcher',{p_owner:owner});
    if(lockError) throw lockError;
    if(!locked) return Response.json({ok:true,busy:true});
    acquired=true;
    const deadline = Date.now() + 50_000;
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
    await recoverDeliveries(db);
    const now = new Date().toISOString();
    const { data: events, error } = await db
      .from("delivery_events")
      .select(
        "id,status,dispatch_attempts,recipient:bot_users!delivery_events_recipient_user_id_fkey(id,chat_id,is_active,ui_language),search_profiles!inner(id,profile_slot,is_active,owner:bot_users!search_profiles_user_id_fkey(id,is_active,plan_override,plan_override_expires_at,referral_bonus_until)),listings!inner(*,sources(button_label,source_type))",
      )
      .in("status", ["pending", "failed"]).eq("delivery_outcome_unknown",false)
      .lt("dispatch_attempts", 5)
      .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
      .order("created_at")
      .limit(200);
    if (error) throw error;
    let sent = 0,
      failed = 0,
      skipped = 0;
    const cache = new Map<string, Promise<any>>();
    for (const event of events || []) {
      if (!(await waitForDispatchSlot(db,owner,deadline))) break;
      const lease = await claimDelivery(db, event);
      if (!lease) continue;
      const profile = event.search_profiles as any,
        profileOwner = profile?.owner,
        recipient = event.recipient as any,
        raw = event.listings as any;
      const isPremium = premium(profileOwner, paid.has(String(profileOwner?.id || "")));
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
        const {error:slotError}=await db.rpc('dispatcher_slot',{p_owner:owner,p_complete:true});
        if(slotError) throw slotError;
        message = await send(
          token,
          Number(recipient.chat_id),
          listing,
          recipient.ui_language || "de",
          isPremium,
        );
      } catch (error) {
        await finishDelivery(db, lease, {
          status: "failed",
          delivery_outcome_unknown: error instanceof TelegramFailure && error.outcomeUnknown,
          next_retry_at: error instanceof TelegramFailure && error.outcomeUnknown ? null : new Date(Date.now()+Math.max(120000,error instanceof TelegramFailure ? error.retryAfter*1000 : 0)).toISOString(),
          error_message: String(error),
        });
        failed++;
        continue;
      }
      const {error:gapError}=await db.rpc('dispatcher_slot',{p_owner:owner,p_complete:true});
      if(gapError) throw gapError;
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
    if(acquired){const {error}=await db.rpc('release_dispatcher',{p_owner:owner});if(error)console.error('dispatcher_release',error.message);}
  }
});
