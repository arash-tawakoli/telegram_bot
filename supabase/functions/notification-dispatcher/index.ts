import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const ADMIN_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, ADMIN_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const FALLBACK_PHOTO = "https://placehold.co/1200x630/0aa7b8/ffffff/png?text=Traumwohnung+Hamburg";

async function secret(name: string) {
  const { data, error } = await db.rpc("get_bot_secret", { secret_name: name });
  if (error || !data) throw new Error(`secret ${name} unavailable`);
  return String(data);
}
function esc(v: unknown) { return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function money(v: any) {
  if (v === null || v === undefined || v === "") return "nicht angegeben";
  const n = Number(v);
  return Number.isFinite(n) ? `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(n)} €` : esc(v);
}
function addressOf(l: any) {
  if (l.address && String(l.address).trim()) return String(l.address).trim();
  return [l.district, l.postal_code, l.city || "Hamburg"].filter(Boolean).join(", ") || "Vom Anbieter nicht veröffentlicht";
}
function mapUrl(l: any) { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressOf(l))}`; }
function detectType(l: any) {
  const h = `${l.title || ""} ${JSON.stringify(l.raw || {}).slice(0, 3000)}`;
  if (/tauschwohnung|tauschangebot|wohnungstausch/i.test(h)) return "Tauschwohnung";
  if (/\bWG\b|WG-Zimmer|Zimmer zur Miete|roommate/i.test(h)) return "WG";
  if (/\bHaus\b|Einfamilienhaus|Reihenhaus|Doppelhaus|Villa/i.test(h)) return "Haus";
  return "Wohnung";
}
function matches(p: any, l: any) {
  const types: string[] = p.property_types || [];
  if (types.length && !types.includes(detectType(l))) return false;
  const rent = l.warm_rent ?? l.cold_rent;
  if (p.max_warm_rent != null && (rent == null || Number(rent) > Number(p.max_warm_rent))) return false;
  if (Number(p.min_area_sqm || 0) > 0 && (l.area_sqm == null || Number(l.area_sqm) < Number(p.min_area_sqm))) return false;
  const districts = (p.districts || []).map((x: string) => x.toLowerCase());
  if (districts.length && !districts.includes("ganz hamburg")) {
    const h = `${l.district || ""} ${l.address || ""} ${l.title || ""}`.toLowerCase();
    if (!districts.some((x: string) => h.includes(x))) return false;
  }
  return true;
}
function caption(l: any) {
  const title = String(l.title || "Neue Wohnung").slice(0, 180);
  return `🏠 <b>${esc(title)}</b>\n\n📍 <b>Adresse:</b> ${esc(addressOf(l))}\n💶 <b>Warmmiete:</b> ${money(l.warm_rent)}\n🔥 <b>Heizkosten:</b> ${money(l.heating_costs)}\n🧾 <b>Nebenkosten:</b> ${money(l.additional_costs)}\n🔐 <b>Kaution:</b> ${l.deposit_text ? esc(l.deposit_text) : money(l.deposit)}\n🚪 <b>Zimmer:</b> ${l.rooms ?? "nicht angegeben"}\n📐 <b>Fläche:</b> ${l.area_sqm != null ? `${esc(l.area_sqm)} m²` : "nicht angegeben"}`;
}
function saveLabel(lang: string) {
  return ({ en: "💾 Save", tr: "💾 Kaydet", ar: "💾 حفظ", fa: "💾 ذخیره", prs: "💾 ذخیره", ps: "💾 خوندي", ckb: "💾 پاشەکەوت", ku: "💾 Tomar bike", bad: "💾 Tomar bike" } as any)[lang] || "💾 Speichern";
}
function keyboard(l: any, s: any, lang: string) {
  const label = s?.button_label || s?.name || "Angebot";
  return { inline_keyboard: [[{ text: `🔗 ${label}`, url: l.canonical_url }], [{ text: saveLabel(lang), callback_data: `save:${l.id}` }, { text: "📍 Google Maps", url: mapUrl(l) }]] };
}
async function sendPhoto(token: string, chatId: number, l: any, s: any, lang: string) {
  const body = (photo: string) => ({ chat_id: chatId, photo, caption: caption(l), parse_mode: "HTML", reply_markup: keyboard(l, s, lang) });
  for (const photo of [l.image_url, FALLBACK_PHOTO].filter(Boolean)) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body(String(photo))) });
    const j = await r.json();
    if (r.ok && j.ok) return j.result?.message_id || null;
  }
  throw new Error("Telegram sendPhoto failed for listing and fallback image");
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const expected = await secret("internal_worker_secret");
    if ((req.headers.get("x-internal-secret") || "") !== expected) return new Response("unauthorized", { status: 401 });
    const token = await secret("telegram_bot_token_runtime");
    const now = new Date();
    const { data, error } = await db.from("delivery_events").select("id,status,dispatch_attempts,next_retry_at,created_at,search_profiles!inner(id,property_types,max_warm_rent,min_area_sqm,districts,is_active,bot_users!inner(chat_id,is_active,ui_language)),listings!inner(*,sources!inner(name,button_label))").in("status", ["pending", "failed"]).lt("dispatch_attempts", 5).order("created_at", { ascending: true }).limit(30);
    if (error) throw error;
    const results: any[] = [];
    for (const e of data || []) {
      if (e.next_retry_at && new Date(e.next_retry_at) > now) continue;
      const p = e.search_profiles, l = e.listings, u = p?.bot_users, s = l?.sources;
      if (!p?.is_active || !u?.is_active || !matches(p, l)) {
        await db.from("delivery_events").update({ status: "skipped", last_attempt_at: now.toISOString() }).eq("id", e.id);
        results.push({ id: e.id, status: "skipped" });
        continue;
      }
      try {
        const mid = await sendPhoto(token, Number(u.chat_id), l, s, u.ui_language || "de");
        await db.from("delivery_events").update({ status: "sent", telegram_message_id: mid, sent_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(), dispatch_attempts: Number(e.dispatch_attempts || 0) + 1, error_message: null }).eq("id", e.id);
        results.push({ id: e.id, status: "sent", message_id: mid });
      } catch (err) {
        const attempts = Number(e.dispatch_attempts || 0) + 1;
        await db.from("delivery_events").update({ status: "failed", dispatch_attempts: attempts, last_attempt_at: new Date().toISOString(), next_retry_at: new Date(Date.now() + Math.min(60, Math.pow(2, attempts)) * 60000).toISOString(), error_message: err instanceof Error ? err.message : String(err) }).eq("id", e.id);
        results.push({ id: e.id, status: "failed" });
      }
    }
    return Response.json({ ok: true, processed: results.length, results });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});
