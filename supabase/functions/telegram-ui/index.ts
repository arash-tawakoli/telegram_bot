import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { LANGS, msg, typeLabel } from "./ui-text.ts";

type U = { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string };
type M = { message_id: number; from?: U; chat: { id: number; type: string }; text?: string };
type Q = { id: string; from: U; message?: M; data?: string };
type S = {
  property_types: string[];
  borough_ids: number[];
  neighborhood_ids: number[];
  neighborhood_page: number;
  location_mode: string | null;
  max_warm_rent: number | null;
  min_rooms: number;
  min_area_sqm: number;
  wbs_only: boolean;
  furnished_preference: string;
  profile_name: string | null;
  edit_return?: boolean;
};
type Geo = {
  boroughs: Array<{ id: number; name: string; sort_order?: number }>;
  neighborhoods: Array<{ id: number; name: string; borough_id: number }>;
};
type CoreStep = "types" | "location" | "boroughs" | "neighborhoods" | "rent" | "rooms" | "area";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const db = createClient(URL, KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const FALLBACK = `${URL}/functions/v1/telegram-fallback-logo`;
const TYPES = ["Wohnung", "Haus", "WG", "Tauschwohnung"];
const NPAGE = 10;
const AREA_PRESETS = new Set([30, 50, 70, 90]);
const SECRET_TTL_MS = 5 * 60_000;
const GEO_TTL_MS = 30 * 60_000;

const secretCache = new Map<string, { value: string; expiresAt: number }>();
const secretPending = new Map<string, Promise<string>>();
let geoCache: { value: Geo; expiresAt: number } | null = null;
let geoPending: Promise<Geo> | null = null;

const empty = (): S => ({
  property_types: [],
  borough_ids: [],
  neighborhood_ids: [],
  neighborhood_page: 0,
  location_mode: null,
  max_warm_rent: null,
  min_rooms: 0,
  min_area_sqm: 0,
  wbs_only: false,
  furnished_preference: "any",
  profile_name: null,
});

function cb(text: string, data: string) { return { text, callback_data: data }; }
function esc(v: any) { return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function money(v: any) {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(x)} €` : String(v);
}
function num(v: any, m = 1) {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? new Intl.NumberFormat("de-DE", { maximumFractionDigits: m }).format(x) : String(v);
}
function short(v: any, n = 44) {
  const s = String(v || "Listing").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function stepMsg(u: any, key: string) {
  return msg(u.ui_language, key).replace(/\/8\b/, "/5");
}
function stripNavIcon(v: string) {
  return v.replace(/^⬅️\s*/, "").replace(/\s*➡️$/, "").trim();
}
function rentPrompt(u: any) {
  return `${msg(u.ui_language, "enterRent")}\n\n<b>Max. 5.000 €</b>`;
}
function helpText(u: any) {
  return msg(u.ui_language, "helpText").split("\n").filter((line: string) => !line.trim().startsWith("/profile")).join("\n");
}
function coreOnly(s: S) {
  s.wbs_only = false;
  s.furnished_preference = "any";
  s.profile_name = null;
  return s;
}
function coreIssue(s: S): CoreStep | null {
  if (!s.property_types.length) return "types";
  if (!s.location_mode) return "location";
  if (s.location_mode === "boroughs" && !s.borough_ids.length) return "boroughs";
  if (s.location_mode === "neighborhoods" && !s.neighborhood_ids.length) return "neighborhoods";
  if (s.max_warm_rent == null || !Number.isFinite(s.max_warm_rent) || s.max_warm_rent < 100 || s.max_warm_rent > 5000) return "rent";
  if (!Number.isFinite(s.min_rooms) || s.min_rooms < 1 || s.min_rooms > 4) return "rooms";
  if (!AREA_PRESETS.has(s.min_area_sqm)) return "area";
  return null;
}

async function secret(name: string, force = false) {
  const now = Date.now();
  if (!force) {
    const hit = secretCache.get(name);
    if (hit && hit.expiresAt > now) return hit.value;
    const pending = secretPending.get(name);
    if (pending) return pending;
  }
  const load = (async () => {
    const { data, error } = await db.rpc("get_bot_secret", { secret_name: name });
    if (error || !data) throw new Error(`secret ${name} unavailable`);
    const value = String(data);
    secretCache.set(name, { value, expiresAt: Date.now() + SECRET_TTL_MS });
    return value;
  })().finally(() => secretPending.delete(name));
  secretPending.set(name, load);
  return load;
}

async function tg(method: string, body: any, retry = true): Promise<any> {
  const token = await secret("telegram_bot_token_runtime");
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if ((!r.ok || !j.ok) && r.status === 401 && retry) {
    secretCache.delete("telegram_bot_token_runtime");
    await secret("telegram_bot_token_runtime", true);
    return tg(method, body, false);
  }
  if (!r.ok || !j.ok) throw new Error(String(j?.description || `Telegram ${r.status}`));
  return j.result;
}
async function send(c: number, text: string, markup?: any) {
  return tg("sendMessage", { chat_id: c, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: markup });
}
async function edit(c: number, m: number, text: string, markup?: any) {
  try {
    return await tg("editMessageText", { chat_id: c, message_id: m, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: markup });
  } catch {
    return send(c, text, markup);
  }
}
async function ack(id: string, text?: string) {
  try { await tg("answerCallbackQuery", { callback_query_id: id, text }); } catch { /* ignore expired callback */ }
}

async function ensure(f: U, c: number) {
  const { data: existing, error } = await db.from("bot_users").select("*").eq("telegram_user_id", f.id).maybeSingle();
  if (error) throw error;
  if (existing) {
    const patch: Record<string, any> = {};
    if (existing.chat_id !== c) patch.chat_id = c;
    if ((existing.username || null) !== (f.username || null)) patch.username = f.username || null;
    if ((existing.first_name || null) !== (f.first_name || null)) patch.first_name = f.first_name || null;
    if ((existing.last_name || null) !== (f.last_name || null)) patch.last_name = f.last_name || null;
    if ((existing.language_code || null) !== (f.language_code || null)) patch.language_code = f.language_code || null;
    if (!existing.is_active) patch.is_active = true;
    if (Object.keys(patch).length === 0) return existing;
    patch.updated_at = new Date().toISOString();
    const { data, error: updateError } = await db.from("bot_users").update(patch).eq("id", existing.id).select("*").single();
    if (updateError) throw updateError;
    return data;
  }
  const { data, error: insertError } = await db.from("bot_users").upsert({
    telegram_user_id: f.id,
    chat_id: c,
    username: f.username || null,
    first_name: f.first_name || null,
    last_name: f.last_name || null,
    language_code: f.language_code || null,
    is_active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "telegram_user_id" }).select("*").single();
  if (insertError) throw insertError;
  return data;
}

async function st(id: string, step: string | null, s: any) {
  const { error } = await db.from("bot_users").update({ onboarding_step: step, onboarding_state: s, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}
async function renderState(id: string, step: string | null, s: any, telegramCall: Promise<any>) {
  const [stateResult, telegramResult] = await Promise.allSettled([st(id, step, s), telegramCall]);
  if (stateResult.status === "rejected") throw stateResult.reason;
  if (telegramResult.status === "rejected") throw telegramResult.reason;
  return telegramResult.value;
}

async function geo(): Promise<Geo> {
  const now = Date.now();
  if (geoCache && geoCache.expiresAt > now) return geoCache.value;
  if (geoPending) return geoPending;
  geoPending = (async () => {
    const [b, n] = await Promise.all([
      db.from("hamburg_boroughs").select("id,name,sort_order").order("sort_order"),
      db.from("hamburg_neighborhoods").select("id,name,borough_id").order("id"),
    ]);
    if (b.error) throw b.error;
    if (n.error) throw n.error;
    const value: Geo = { boroughs: (b.data || []) as any, neighborhoods: (n.data || []) as any };
    geoCache = { value, expiresAt: Date.now() + GEO_TTL_MS };
    return value;
  })().finally(() => { geoPending = null; });
  return geoPending;
}

function nav(u: any, b: string, n?: string) {
  const r = [cb(`← ${stripNavIcon(msg(u.ui_language, "back"))}`, b)];
  if (n) r.push(cb(`${stripNavIcon(msg(u.ui_language, "confirm"))} →`, n));
  return r;
}
function later(u: any) { return [cb(msg(u.ui_language, "later"), "home")]; }
function hm(u: any) {
  const r: any[] = [];
  if (u.onboarding_step && Object.keys(u.onboarding_state || {}).length) r.push([cb(msg(u.ui_language, "continueDraft"), "draft")]);
  r.push(
    [cb(msg(u.ui_language, "create"), "new")],
    [cb(msg(u.ui_language, "saved"), "saved:0")],
    [cb(msg(u.ui_language, "settings"), "settings"), cb(msg(u.ui_language, "help"), "help")],
  );
  return { inline_keyboard: r };
}
async function home(u: any, c: number, m?: number) {
  const x = msg(u.ui_language, "welcome") + (u.onboarding_step ? `\n\n${msg(u.ui_language, "draft")}` : "");
  return m ? edit(c, m, x, hm(u)) : send(c, x, hm(u));
}

function tm(u: any, s: S) {
  const r: any[] = TYPES.map(v => [cb(`${s.property_types.includes(v) ? "✅ " : ""}${typeLabel(u.ui_language, v)}`, `type:${v}`)]);
  r.push([cb(msg(u.ui_language, "selectAll"), "type:all")], nav(u, "home", "type:done"), later(u));
  return { inline_keyboard: r };
}
async function types(u: any, c: number, m: number, s: S) {
  return renderState(u.id, "types", s, edit(c, m, stepMsg(u, "typeStep"), tm(u, s)));
}
function lm(u: any) {
  return { inline_keyboard: [
    [cb(msg(u.ui_language, "allHamburg"), "loc:all")],
    [cb(msg(u.ui_language, "boroughs"), "loc:b")],
    [cb(msg(u.ui_language, "neighborhoods"), "loc:n")],
    nav(u, "types"),
    later(u),
  ] };
}
async function loc(u: any, c: number, m: number, s: S) {
  return renderState(u.id, "location", s, edit(c, m, stepMsg(u, "locationStep"), lm(u)));
}
async function bm(u: any, s: S) {
  const { boroughs } = await geo();
  const r: any[] = [];
  for (let i = 0; i < boroughs.length; i += 2) {
    r.push(boroughs.slice(i, i + 2).map(x => cb(`${s.borough_ids.includes(x.id) ? "✅ " : ""}${x.name}`, `bor:${x.id}`)));
  }
  r.push([cb(msg(u.ui_language, "selectAll"), "bor:all")], nav(u, "location", "bor:done"), later(u));
  return { inline_keyboard: r };
}
async function borough(u: any, c: number, m: number, s: S) {
  const markup = await bm(u, s);
  return renderState(u.id, "boroughs", s, edit(c, m, msg(u.ui_language, "chooseB"), markup));
}
async function nm(u: any, s: S) {
  const { neighborhoods } = await geo();
  const pages = Math.max(1, Math.ceil(neighborhoods.length / NPAGE));
  const p = Math.max(0, Math.min(s.neighborhood_page, pages - 1));
  const part = neighborhoods.slice(p * NPAGE, (p + 1) * NPAGE);
  const r: any[] = [];
  for (let i = 0; i < part.length; i += 2) {
    r.push(part.slice(i, i + 2).map(x => cb(`${s.neighborhood_ids.includes(x.id) ? "✅ " : ""}${x.name}`, `nei:${x.id}`)));
  }
  r.push(
    [cb(msg(u.ui_language, "selectAll"), "nei:all"), cb(msg(u.ui_language, "clear"), "nei:clear")],
    [cb("←", "nei:prev"), cb(`${p + 1}/${pages}`, "noop"), cb("→", "nei:next")],
    nav(u, "location", "nei:done"),
    later(u),
  );
  return { inline_keyboard: r };
}
async function neigh(u: any, c: number, m: number, s: S) {
  const markup = await nm(u, s);
  return renderState(u.id, "neighborhoods", s, edit(c, m, `${msg(u.ui_language, "chooseN")}\n\n<b>${s.neighborhood_ids.length}/104</b>`, markup));
}
function rm(u: any) {
  return { inline_keyboard: [
    [cb("800 €", "rent:800"), cb("1.000 €", "rent:1000")],
    [cb("1.250 €", "rent:1250"), cb("1.500 €", "rent:1500")],
    [cb(msg(u.ui_language, "custom"), "rent:custom")],
    nav(u, "location"),
    later(u),
  ] };
}
async function rent(u: any, c: number, m: number, s: S) {
  return renderState(u.id, "rent", s, edit(c, m, stepMsg(u, "rentStep"), rm(u)));
}
function rmm(u: any) {
  return { inline_keyboard: [
    [cb("1+", "rooms:1"), cb("2+", "rooms:2")],
    [cb("3+", "rooms:3"), cb("4+", "rooms:4")],
    nav(u, "rent"), later(u),
  ] };
}
async function rooms(u: any, c: number, m: number, s: S) {
  return renderState(u.id, "rooms", s, edit(c, m, stepMsg(u, "roomsStep"), rmm(u)));
}
function am(u: any) {
  return { inline_keyboard: [
    [cb("30 m²", "area:30"), cb("50 m²", "area:50")],
    [cb("70 m²", "area:70"), cb("90 m²", "area:90")],
    nav(u, "rooms"), later(u),
  ] };
}
async function area(u: any, c: number, m: number, s: S) {
  return renderState(u.id, "area", s, edit(c, m, stepMsg(u, "areaStep"), am(u)));
}

async function places(s: S) {
  const g = await geo();
  let location = "Hamburg", districts = ["Ganz Hamburg"], bs: string[] = [], ns: string[] = [];
  if (s.location_mode === "boroughs") {
    const selected = new Set(s.borough_ids);
    bs = g.boroughs.filter(x => selected.has(x.id)).map(x => x.name);
    districts = g.neighborhoods.filter(x => selected.has(x.borough_id)).map(x => x.name);
    location = bs.join(", ");
  } else if (s.location_mode === "neighborhoods") {
    const selected = new Set(s.neighborhood_ids);
    ns = g.neighborhoods.filter(x => selected.has(x.id)).map(x => x.name).sort((a, b) => a.localeCompare(b, "de"));
    districts = ns;
    location = ns.length > 12 ? ns.slice(0, 12).join(", ") + ` … (+${ns.length - 12})` : ns.join(", ");
  }
  return { location, districts, bs, ns };
}
function auto(u: any) {
  return msg(u.ui_language, "profileBase");
}
async function review(u: any, c: number, m: number, s: S) {
  coreOnly(s);
  const issue = coreIssue(s);
  if (issue) return renderCoreStep(u, c, m, s, issue);
  const p = await places(s);
  const tt = s.property_types.map(v => typeLabel(u.ui_language, v)).join(", ");
  const rr = money(s.max_warm_rent);
  const ro = `${num(s.min_rooms)}+`;
  const aa = `${num(s.min_area_sqm)} m²+`;
  const text = `${msg(u.ui_language, "review")}\n\n<b>${esc(auto(u))}</b>\n\n🏠 <b>${esc(msg(u.ui_language, "fieldType"))}:</b> ${esc(tt)}\n📍 <b>${esc(msg(u.ui_language, "fieldLocation"))}:</b> ${esc(p.location)}\n💶 <b>${esc(msg(u.ui_language, "fieldRent"))}:</b> ${esc(rr)}\n🚪 <b>${esc(msg(u.ui_language, "fieldRooms"))}:</b> ${esc(ro)}\n📐 <b>${esc(msg(u.ui_language, "fieldArea"))}:</b> ${esc(aa)}`;
  const markup = { inline_keyboard: [
    [cb(msg(u.ui_language, "activate"), "saveProfile")],
    [cb(`🏠 ${msg(u.ui_language, "fieldType")}`, "edit:types"), cb(`📍 ${msg(u.ui_language, "fieldLocation")}`, "edit:location")],
    [cb(`💶 ${msg(u.ui_language, "fieldRent")}`, "edit:rent"), cb(`🚪 ${msg(u.ui_language, "fieldRooms")}`, "edit:rooms")],
    [cb(`📐 ${msg(u.ui_language, "fieldArea")}`, "edit:area")],
    later(u),
  ] };
  return renderState(u.id, "review", s, edit(c, m, text, markup));
}
async function after(u: any, c: number, m: number, s: S, n: (u: any, c: number, m: number, s: S) => Promise<any>) {
  if (s.edit_return) { delete s.edit_return; return review(u, c, m, s); }
  return n(u, c, m, s);
}
async function renderCoreStep(u: any, c: number, m: number, s: S, step: CoreStep) {
  return step === "types" ? types(u, c, m, s)
    : step === "location" ? loc(u, c, m, s)
    : step === "boroughs" ? borough(u, c, m, s)
    : step === "neighborhoods" ? neigh(u, c, m, s)
    : step === "rent" ? rent(u, c, m, s)
    : step === "rooms" ? rooms(u, c, m, s)
    : area(u, c, m, s);
}
async function resumeStep(u: any, c: number, m: number, s: S) {
  coreOnly(s);
  if (u.onboarding_step === "types") return types(u, c, m, s);
  if (u.onboarding_step === "location") return loc(u, c, m, s);
  if (u.onboarding_step === "boroughs") return borough(u, c, m, s);
  if (u.onboarding_step === "neighborhoods") return neigh(u, c, m, s);
  if (["rent", "custom_rent"].includes(u.onboarding_step)) return rent(u, c, m, s);
  const issue = coreIssue(s);
  if (issue) return renderCoreStep(u, c, m, s, issue);
  return review(u, c, m, s);
}

function addr(l: any) {
  if (l.address && String(l.address).trim()) return String(l.address).trim();
  const p = [l.district, l.postal_code, l.city || "Hamburg"].filter(Boolean);
  return p.length ? p.join(", ") : null;
}
function cap(u: any, l: any) {
  const x = [`🏠 <b>${esc(short(l.title, 180))}</b>`, ""];
  for (const [e, k, v] of [["💶", "warm", l.warm_rent], ["❄️", "cold", l.cold_rent], ["🧾", "additional", l.additional_costs], ["🏢", "operating", l.operating_costs], ["🔥", "heating", l.heating_costs]] as any[]) {
    const q = money(v); if (q) x.push(`${e} <b>${esc(msg(u.ui_language, k))}:</b> ${esc(q)}`);
  }
  const d = l.deposit_text ? String(l.deposit_text).trim() : money(l.deposit);
  if (d) x.push(`🔐 <b>${esc(msg(u.ui_language, "deposit"))}:</b> ${esc(d)}`);
  if (l.area_sqm != null) x.push(`📐 <b>${esc(msg(u.ui_language, "area"))}:</b> ${esc(num(l.area_sqm))} m²`);
  if (l.rooms != null) x.push(`🚪 <b>${esc(msg(u.ui_language, "rooms"))}:</b> ${esc(num(l.rooms))}`);
  const a = addr(l); if (a) x.push(`📍 <b>${esc(msg(u.ui_language, "address"))}:</b> ${esc(a)}`);
  return x.join("\n");
}
function lmk(u: any, l: any, s = false) {
  const r: any[] = [[{ text: l.sources?.button_label ? `🔗 Zu ${l.sources.button_label}` : msg(u.ui_language, "offer"), url: l.canonical_url }]], a = addr(l);
  if (a) r.push([{ text: msg(u.ui_language, "maps"), url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}` }]);
  r.push([cb(s ? msg(u.ui_language, "savedState") : msg(u.ui_language, "save"), `save:${l.id}`)]);
  return { inline_keyboard: r };
}
async function card(u: any, c: number, l: any, s = false) {
  let last: any;
  for (const p of [l.image_status !== "fallback" ? l.resolved_image_url : null, l.image_url, l.resolved_image_url, FALLBACK].filter(Boolean).map(String).filter((x: string, i: number, a: string[]) => a.indexOf(x) === i)) {
    try { return await tg("sendPhoto", { chat_id: c, photo: p, caption: cap(u, l), parse_mode: "HTML", reply_markup: lmk(u, l, s) }); }
    catch (e) { last = e; }
  }
  throw last;
}

async function settings(u: any, c: number, m?: number) {
  const r = Object.entries(LANGS).map(([k, v]) => [cb(`${u.ui_language === k ? "✅ " : ""}${v}`, `lang:${k}`)]);
  r.push([cb(msg(u.ui_language, "back"), "home")]);
  const x = `${msg(u.ui_language, "settings")}\n\n🌐 ${LANGS[u.ui_language] || LANGS.de}`;
  return m ? edit(c, m, x, { inline_keyboard: r }) : send(c, x, { inline_keyboard: r });
}
async function saved(u: any, c: number, m?: number, p = 0) {
  const { count } = await db.from("saved_listings").select("id", { count: "exact", head: true }).eq("user_id", u.id);
  if (!count) {
    const k = { inline_keyboard: [[cb(msg(u.ui_language, "back"), "home")]] };
    return m ? edit(c, m, msg(u.ui_language, "noSaved"), k) : send(c, msg(u.ui_language, "noSaved"), k);
  }
  const ps = Math.ceil(count / 8); p = Math.max(0, Math.min(p, ps - 1));
  const { data } = await db.from("saved_listings").select("listing_id,created_at,listings(title,duplicate_of_listing_id)").eq("user_id", u.id).order("created_at", { ascending: false }).range(p * 8, p * 8 + 7);
  const r = (data || []).map((x: any, i: number) => [cb(`🏠 ${p * 8 + i + 1}. ${short(x.listings?.title, 40)}`, `savedOpen:${x.listings?.duplicate_of_listing_id || x.listing_id}`)]);
  r.push([cb("←", `saved:${Math.max(0, p - 1)}`), cb(`${p + 1}/${ps}`, "noop"), cb("→", `saved:${Math.min(ps - 1, p + 1)}`)], [cb(msg(u.ui_language, "back"), "home")]);
  const text = `${msg(u.ui_language, "saved")}\n\n${count} · ${msg(u.ui_language, "page")} ${p + 1}/${ps}`;
  return m ? edit(c, m, text, { inline_keyboard: r }) : send(c, text, { inline_keyboard: r });
}

function canEarlyAck(data: string) {
  if (!data) return false;
  if (data === "type:done" || data === "bor:done" || data === "nei:done" || data === "saveProfile") return false;
  if (data.startsWith("save:") || data.startsWith("savedOpen:")) return false;
  return true;
}

async function callback(q: Q, u0: any, preAcked = false) {
  const c = q.message?.chat.id, m = q.message?.message_id, d = q.data || "";
  const qa = (text?: string) => preAcked ? Promise.resolve() : ack(q.id, text);
  if (!c || !m) return qa();
  let u = u0, s = coreOnly({ ...empty(), ...(u.onboarding_state || {}) } as S);
  if (d === "noop") return qa();
  if (d.startsWith("lang:")) {
    const x = d.slice(5);
    if (LANGS[x]) {
      const { error } = await db.from("bot_users").update({ ui_language: x, updated_at: new Date().toISOString() }).eq("id", u.id);
      if (error) throw error;
      u = { ...u, ui_language: x };
    }
    await qa(); return settings(u, c, m);
  }
  if (d === "home" || d === "profiles") { await qa(); return home(u, c, m); }
  if (d === "new") { s = empty(); await qa(); return types(u, c, m, s); }
  if (d === "draft") { await qa(); return resumeStep(u, c, m, s); }
  if (d === "settings") { await qa(); return settings(u, c, m); }
  if (d === "help") { await qa(); return edit(c, m, `${msg(u.ui_language, "help")}\n\n${helpText(u)}`, { inline_keyboard: [[cb(msg(u.ui_language, "back"), "home")]] }); }
  if (["types", "location", "rent", "rooms", "area"].includes(d)) {
    await qa();
    return d === "types" ? types(u, c, m, s) : d === "location" ? loc(u, c, m, s) : d === "rent" ? rent(u, c, m, s) : d === "rooms" ? rooms(u, c, m, s) : area(u, c, m, s);
  }
  if (d.startsWith("edit:")) {
    s.edit_return = true; await qa(); const x = d.slice(5);
    if (x === "types") return types(u, c, m, s);
    if (x === "location") return loc(u, c, m, s);
    if (x === "rent") return rent(u, c, m, s);
    if (x === "rooms") return rooms(u, c, m, s);
    if (x === "area") return area(u, c, m, s);
    delete s.edit_return;
    const issue = coreIssue(s);
    return issue ? renderCoreStep(u, c, m, s, issue) : review(u, c, m, s);
  }
  if (d.startsWith("type:")) {
    const x = d.slice(5);
    if (x === "all") s.property_types = [...TYPES];
    else if (x === "done") {
      if (!s.property_types.length) return qa(msg(u.ui_language, "chooseType"));
      await qa(); return after(u, c, m, s, loc);
    } else s.property_types = s.property_types.includes(x) ? s.property_types.filter(v => v !== x) : [...s.property_types, x];
    await qa(); return types(u, c, m, s);
  }
  if (d.startsWith("loc:")) {
    const x = d.slice(4);
    if (x === "all") { s.location_mode = "all_hamburg"; s.borough_ids = []; s.neighborhood_ids = []; await qa(); return after(u, c, m, s, rent); }
    s.location_mode = x === "b" ? "boroughs" : "neighborhoods"; await qa(); return x === "b" ? borough(u, c, m, s) : neigh(u, c, m, s);
  }
  if (d.startsWith("bor:")) {
    const x = d.slice(4);
    if (x === "all") s.borough_ids = (await geo()).boroughs.map(v => v.id);
    else if (x === "done") { if (!s.borough_ids.length) return qa(msg(u.ui_language, "chooseB")); await qa(); return after(u, c, m, s, rent); }
    else { const id = Number(x); s.borough_ids = s.borough_ids.includes(id) ? s.borough_ids.filter(v => v !== id) : [...s.borough_ids, id]; }
    await qa(); return borough(u, c, m, s);
  }
  if (d.startsWith("nei:")) {
    const x = d.slice(4);
    if (x === "all") s.neighborhood_ids = (await geo()).neighborhoods.map(v => v.id);
    else if (x === "clear") s.neighborhood_ids = [];
    else if (x === "prev") s.neighborhood_page = Math.max(0, s.neighborhood_page - 1);
    else if (x === "next") s.neighborhood_page++;
    else if (x === "done") { if (!s.neighborhood_ids.length) return qa(msg(u.ui_language, "chooseNOne")); await qa(); return after(u, c, m, s, rent); }
    else { const id = Number(x); s.neighborhood_ids = s.neighborhood_ids.includes(id) ? s.neighborhood_ids.filter(v => v !== id) : [...s.neighborhood_ids, id]; }
    await qa(); return neigh(u, c, m, s);
  }
  if (d.startsWith("rent:")) {
    const x = d.slice(5);
    if (x === "custom") {
      await qa();
      return renderState(u.id, "custom_rent", s, edit(c, m, rentPrompt(u), { inline_keyboard: [nav(u, "rent"), later(u)] }));
    }
    const value = Number(x);
    if (!Number.isFinite(value) || value < 100 || value > 5000) { await qa(); return rent(u, c, m, s); }
    s.max_warm_rent = value; await qa(); return after(u, c, m, s, rooms);
  }
  if (d.startsWith("rooms:")) {
    const value = Number(d.slice(6));
    if (!Number.isFinite(value) || value < 1 || value > 4) { await qa(); return rooms(u, c, m, s); }
    s.min_rooms = value; await qa(); return after(u, c, m, s, area);
  }
  if (d.startsWith("area:")) {
    const value = Number(d.slice(5));
    if (!AREA_PRESETS.has(value)) { await qa(); return area(u, c, m, s); }
    s.min_area_sqm = value; await qa(); return review(u, c, m, s);
  }
  if (d.startsWith("wbs:") || d.startsWith("furn:") || d.startsWith("name:")) {
    await qa();
    const issue = coreIssue(s);
    return issue ? renderCoreStep(u, c, m, s, issue) : review(u, c, m, s);
  }
  if (d === "saveProfile") {
    coreOnly(s);
    const issue = coreIssue(s);
    if (issue) { await qa(); return renderCoreStep(u, c, m, s, issue); }
    const p = await places(s);
    const { error } = await db.from("search_profiles").upsert({
      user_id: u.id,
      name: auto(u),
      property_types: s.property_types,
      max_warm_rent: s.max_warm_rent,
      min_rooms: s.min_rooms,
      min_area_sqm: s.min_area_sqm,
      districts: p.districts,
      location_mode: s.location_mode || "all_hamburg",
      boroughs: p.bs,
      neighborhoods: p.ns,
      wbs_only: false,
      furnished_preference: "any",
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw error;
    await st(u.id, null, {}); u = { ...u, onboarding_step: null, onboarding_state: {} }; await qa();
    return edit(c, m, msg(u.ui_language, "created"), hm(u));
  }
  if (d.startsWith("saved:")) { await qa(); return saved(u, c, m, Number(d.slice(6)) || 0); }
  if (d.startsWith("savedOpen:")) {
    const { data: l } = await db.from("listings").select("*,sources(button_label)").eq("id", d.slice(10)).single();
    if (!l) return qa(msg(u.ui_language, "listingUnavailable"));
    await qa(); return card(u, c, l, true);
  }
  if (d.startsWith("save:")) {
    const old = d.slice(5);
    const { data: l } = await db.from("listings").select("id,duplicate_of_listing_id").eq("id", old).single();
    const id = l?.duplicate_of_listing_id || old;
    const { data: e } = await db.from("saved_listings").select("id").eq("user_id", u.id).eq("listing_id", id).maybeSingle();
    if (e) { await db.from("saved_listings").delete().eq("id", e.id); await qa(msg(u.ui_language, "removed")); }
    else { await db.from("saved_listings").insert({ user_id: u.id, listing_id: id }); await qa(msg(u.ui_language, "savedState")); }
    return;
  }
  return qa();
}

async function message(m: M, u0: any) {
  const c = m.chat.id, text = (m.text || "").trim(), cmd = text.split(/\s+/)[0].toLowerCase().replace(/@traumwohnunghamburgbot$/i, ""), u = u0;
  if (cmd === "/start" || cmd === "/profile") return home(u, c);
  if (cmd === "/suche") {
    const s = empty();
    return renderState(u.id, "types", s, send(c, stepMsg(u, "typeStep"), tm(u, s)));
  }
  if (cmd === "/gespeichert" || cmd === "/saved") return saved(u, c);
  if (cmd === "/einstellungen" || cmd === "/settings") return settings(u, c);
  if (cmd === "/hilfe" || cmd === "/help") return send(c, `${msg(u.ui_language, "help")}\n\n${helpText(u)}`);
  if (cmd === "/pause") { await db.from("search_profiles").update({ is_active: false }).eq("user_id", u.id); return send(c, msg(u.ui_language, "paused")); }
  if (cmd === "/resume") { await db.from("search_profiles").update({ is_active: true }).eq("user_id", u.id); return send(c, msg(u.ui_language, "resumed")); }
  if (cmd === "/status") {
    const [{ count: p }, { count: s }] = await Promise.all([
      db.from("search_profiles").select("id", { count: "exact", head: true }).eq("user_id", u.id).eq("is_active", true),
      db.from("sources").select("id", { count: "exact", head: true }).eq("enabled", true),
    ]);
    return send(c, `${msg(u.ui_language, "status")}\n${msg(u.ui_language, "activeProfiles")}: ${p || 0}\n${msg(u.ui_language, "activeSources")}: ${s || 0}\n${msg(u.ui_language, "online")}`);
  }
  const s = coreOnly({ ...empty(), ...(u.onboarding_state || {}) } as S);
  if (u.onboarding_step === "custom_rent") {
    const x = Number(text.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(x) || x < 100 || x > 5000) return send(c, rentPrompt(u));
    s.max_warm_rent = x;
    if (s.edit_return) { delete s.edit_return; return review(u, c, m.message_id, s); }
    return renderState(u.id, "rooms", s, send(c, stepMsg(u, "roomsStep"), rmm(u)));
  }
  if (u.onboarding_step === "custom_area") {
    return renderState(u.id, "area", s, send(c, stepMsg(u, "areaStep"), am(u)));
  }
  if (["custom_name", "wbs", "furn", "name", "review"].includes(u.onboarding_step)) {
    const issue = coreIssue(s);
    if (issue) return renderCoreStep(u, c, m.message_id, s, issue);
    return review(u, c, m.message_id, s);
  }
  return send(c, msg(u.ui_language, "useButtons"));
}

Deno.serve(async (req: Request) => {
  const started = performance.now();
  let action = "other";
  try {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const b = await req.json().catch(() => ({}));
    action = b.callback_query?.data ? String(b.callback_query.data).split(":")[0] : b.message?.text ? "message" : "other";

    const botTokenWarm = b.callback_query ? secret("telegram_bot_token_runtime") : Promise.resolve("");
    let [webhookSecret] = await Promise.all([secret("telegram_webhook_secret"), botTokenWarm]);
    const suppliedWebhookSecret = req.headers.get("x-telegram-bot-api-secret-token") || "";
    if (suppliedWebhookSecret !== webhookSecret) {
      secretCache.delete("telegram_webhook_secret");
      secretPending.delete("telegram_webhook_secret");
      webhookSecret = await secret("telegram_webhook_secret", true);
      if (suppliedWebhookSecret !== webhookSecret) return new Response("unauthorized", { status: 401 });
    }

    const q = b.callback_query as Q | undefined;
    const preAcked = !!q?.id && canEarlyAck(q.data || "");
    const earlyAck = preAcked ? ack(q!.id) : Promise.resolve();

    const eventPromise = db.from("bot_events").insert({
      telegram_update_id: b.update_id,
      event_type: b.callback_query ? "callback_query" : b.message ? "message" : "other",
      telegram_user_id: b.callback_query?.from?.id || b.message?.from?.id || null,
      payload: b,
    });
    const userPromise = q?.from && q.message
      ? ensure(q.from, q.message.chat.id)
      : b.message?.from && b.message.chat.type === "private" && b.message.text
        ? ensure(b.message.from, b.message.chat.id)
        : Promise.resolve(null);

    const [eventResult, u] = await Promise.all([eventPromise, userPromise, earlyAck]).then(([event, user]) => [event, user] as const);
    if (eventResult.error && (eventResult.error.code === "23505" || String(eventResult.error.message).toLowerCase().includes("duplicate"))) {
      return Response.json({ ok: true, duplicate: true });
    }
    if (eventResult.error) console.error("bot_events_insert", eventResult.error.message);

    if (q?.from && q.message && u) await callback(q, u, preAcked);
    else if (b.message?.from && b.message.chat.type === "private" && b.message.text && u) await message(b.message, u);
    return Response.json({ ok: true });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    console.log(JSON.stringify({ event: "telegram_ui_latency", action, ms: Math.round(performance.now() - started), region: Deno.env.get("SB_REGION") || "unknown" }));
  }
});