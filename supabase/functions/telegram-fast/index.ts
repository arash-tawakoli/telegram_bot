import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleTelegramUpdate } from "../telegram-ui/handler.ts";

const BASE_URL = Deno.env.get("SUPABASE_URL")!;
const KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SERVICE_KEY = KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORE = `${BASE_URL}/functions/v1/telegram-ui`;
const PREMIUM_LINK = "https://buy.stripe.com/dRm9AM7DSajfgYK2qVfYY01";
const PREMIUM_IMAGE = `${BASE_URL}/storage/v1/object/public/telegram-assets/premium/50-off-hd.jpg?v=20260903hd4`;
const ADMINS = [8538226539, 414638980];

const COMMAND_ACTIONS: Record<string, string> = {
  "/start": "home", "/hilfe": "help", "/help": "help", "/einstellungen": "settings", "/settings": "settings",
  "/premium": "premium", "/pause": "pause", "/resume": "resume", "/suche": "new", "/profile": "profile",
  "/gespeichert": "saved", "/saved": "saved", "/status": "status",
};
const CALLBACK_ACTIONS: Record<string, string> = {
  home: "home", settings: "settings", help: "help", status: "status", profile: "profile", profiles: "profile",
  new: "new", saved: "saved", premium: "premium",
};

let cachedWebhookSecret: { value: string; expiresAt: number } | null = null;
let cachedBotToken: { value: string; expiresAt: number } | null = null;

function serviceHeaders(extra: Record<string, string> = {}) { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json", ...extra }; }
async function rpc(name: string, body: Record<string, unknown>) {
  const response = await fetch(`${BASE_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: serviceHeaders(), body: JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${name} ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
async function secret(name: string, force = false) {
  const cache = name === "telegram_webhook_secret" ? cachedWebhookSecret : cachedBotToken;
  if (!force && cache && cache.expiresAt > Date.now()) return cache.value;
  const value = String(await rpc("get_bot_secret", { secret_name: name }));
  if (!value) throw new Error(`${name} unavailable`);
  const entry = { value, expiresAt: Date.now() + 3_600_000 };
  if (name === "telegram_webhook_secret") cachedWebhookSecret = entry; else cachedBotToken = entry;
  return value;
}
async function telegram(method: string, params: Record<string, unknown>, retry = true) {
  const token = await secret("telegram_bot_token_runtime");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) });
  const data = await response.json().catch(() => ({}));
  if ((!response.ok || !data?.ok) && response.status === 401 && retry) { cachedBotToken = null; return telegram(method, params, false); }
  if (!response.ok || !data?.ok) throw new Error(String(data?.description || `Telegram ${response.status}`));
  return data.result;
}
function parse(body: string) { try { return JSON.parse(body); } catch { return null; } }
function commandOf(update: any) { return String(update?.message?.text || "").trim().split(/\s+/, 1)[0].toLowerCase().replace(/@traumwohnunghamburgbot$/i, ""); }
function argumentOf(update: any) { const parts = String(update?.message?.text || "").trim().split(/\s+/, 2); return parts[1] || ""; }
function button(text: string, callback_data: string) { return { text, callback_data }; }
function short(value: unknown, max = 42) { const text = String(value || "Inserat").replace(/\s+/g, " ").trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; }
function direct(method: string, params: Record<string, unknown>) { return Response.json({ method, ...params }); }
function textParams(chatId: number, text: string, reply_markup?: unknown) { return { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(reply_markup ? { reply_markup } : {}) }; }

function premiumContent(user: any) {
  const rows: any[] = []; let caption: string;
  if (user.is_premium) { caption = "💎 <b>Traumwohnung Premium</b>\n\n✅ <b>Premium ist aktiv.</b>\n\n<b>Deine Vorteile:</b>\n⚡ Sofortige Zustellung\n🔎 Bis zu 3 Suchprofile\n🔓 Baugenossenschafts-Angebote öffnen\n⭐️ Inserate speichern"; rows.push([button("💳 Abo verwalten", "portal")]); }
  else { caption = "💎 <b>Traumwohnung Premium</b>\n\n<b>Deine Vorteile:</b>\n⚡ Sofortige Zustellung\n🔎 Bis zu 3 Suchprofile\n🔓 Baugenossenschafts-Angebote öffnen\n⭐️ Inserate speichern\n\n<s>1,99 €</s> <b>0,99 € / Monat</b>\nKeine Mindestlaufzeit · jederzeit kündbar"; rows.push([{ text: "💎 Premium freischalten", url: `${PREMIUM_LINK}?client_reference_id=${encodeURIComponent(user.id)}` }]); }
  rows.push([button("← Zurück", "home")]); return { caption, reply_markup: { inline_keyboard: rows } };
}
function homeContent(user: any) { return { text: "🏠 <b>Traumwohnung Hamburg</b>\n\nFinde passende Mietangebote in Hamburg – automatisch und direkt per Telegram.\n\nWähle unten, was du machen möchtest.", reply_markup: { inline_keyboard: [[button("🔎 Suchprofil", "profile"), button(user.is_premium ? "⭐️ Gespeichert" : "🔒 ⭐️ Gespeichert", "saved")],[button("⚙️ Einstellungen", "settings"), button("❓ Hilfe", "help")],[button("💎 30 Tage Premium für 0 €", "referral")]] } }; }
function settingsContent(user: any) { return { text: "⚙️ <b>Einstellungen</b>\n\nVerwalte hier Premium, Sprache und Systemstatus.", reply_markup: { inline_keyboard: [[button("🔐 Plattformkonten / Auto-Bewerbung", "platforms")],[button(user.is_premium ? "💎 Premium aktiv" : "💎 Premium", "premium")],[button("🌐 Sprachen", "language"), button("📡 Systemstatus", "status")],[button("← Zurück", "home")]] } }; }
function helpContent() { return { text: "❓ <b>Hilfe & Befehle</b>\n\n🏠 /start – Startmenü\n🔎 /suche – Suchprofil erstellen oder ersetzen\n👤 /profile – Suchprofil anzeigen\n⭐️ /gespeichert – gespeicherte Inserate\n⚙️ /einstellungen – Einstellungen\n⏸ /pause – Suche pausieren\n▶️ /resume – Suche fortsetzen\n📡 /status – Systemstatus\n💎 /premium – Premium anzeigen\n❓ /hilfe – Hilfe", reply_markup: { inline_keyboard: [[button("← Zurück", "home")]] } }; }
function profileContent(user: any, data: any) {
  const profiles = Array.isArray(data?.profiles) ? data.profiles : []; const limit = Number(data?.profile_limit || (user.is_premium ? 3 : 1));
  const rows: any[] = profiles.map((row: any) => [button(`🔎 ${row.name || `Meine Suche ${row.profile_slot}`} · ${row.is_active ? "aktiv" : "pausiert"}`, `profile:view:${row.profile_slot}`)]);
  if (user.onboarding_step) rows.push([button("🔎 Entwurf fortsetzen", "draft")]); if (profiles.length < limit) rows.push([button("➕ Suchprofil erstellen", "new")]); if (!user.is_premium && profiles.length >= 1) rows.push([button("🔒 ➕ Weiteres Suchprofil · 💎 Premium", "premium")]); rows.push([button("← Zurück", "home")]);
  return { text: profiles.length ? `🔎 <b>Meine Suchprofile</b>\n\n${profiles.length}/${limit} Suchprofile angelegt.` : "🔎 <b>Meine Suchprofile</b>\n\nNoch kein Suchprofil angelegt.", reply_markup: { inline_keyboard: rows } };
}
function newContent(user: any, data: any) {
  if (data?.new_slot == null) return profileContent(user, data);
  const rows: any[] = ["Wohnung", "Haus", "WG", "Tauschwohnung"].map((value) => [button(value, `type:${value}`)]); rows.push([button("Alle auswählen", "type:all"), button("Auswahl löschen", "type:clear")]); rows.push([button("← Zurück", "home"), button("Weiter →", "type:done")]); rows.push([button("✖️ Abbrechen", "cancel")]);
  return { text: "1/5 · <b>Was suchst du?</b>\n\nWähle eine oder mehrere Wohnungsarten.", reply_markup: { inline_keyboard: rows } };
}
function statusContent(data: any) { return { text: `📡 <b>Systemstatus</b>\n\n🔎 Suchprofile aktiv: ${Number(data?.active_profiles || 0)}/${Number(data?.profile_limit || 1)}\n🌐 Quellen im System: ${Number(data?.source_count || 0)}\n💎 Erfolgreiche Empfehlungen: ${Number(data?.referral_count || 0)}\n✅ System: online`, reply_markup: { inline_keyboard: [[button("← Einstellungen", "settings")]] } }; }
function savedContent(user: any, data: any) {
  if (!user.is_premium) return null; const total = Number(data?.saved_count || 0); const saved = Array.isArray(data?.saved) ? data.saved : [];
  if (!total) return { text: "⭐️ <b>Gespeicherte Inserate</b>\n\nNoch keine Inserate gespeichert.", reply_markup: { inline_keyboard: [[button("← Zurück", "home")]] } };
  const rows: any[] = []; for (const [index, row] of saved.entries()) { const listing = row?.listing || {}; const label = `🏠 ${index + 1}. ${short(listing.title)}`; try { const url = new globalThis.URL(String(listing.canonical_url || "")); if (["http:", "https:"].includes(url.protocol)) { rows.push([{ text: label, url: url.href }]); continue; } } catch {} rows.push([button(label, "noop")]); }
  const pages = Math.max(1, Math.ceil(total / 8)); if (pages > 1) rows.push([button("← Zurück", "saved:0"), button(`1/${pages}`, "noop"), button("Weiter →", "saved:1")]); rows.push([button("✖️ Abbrechen", "home")]); return { text: `⭐️ <b>Gespeicherte Inserate</b>\n\n${total} · Seite 1/${pages}`, reply_markup: { inline_keyboard: rows } };
}
function contentFor(action: string, user: any, data: any) { if (action === "home") return homeContent(user); if (action === "settings") return settingsContent(user); if (action === "help") return helpContent(); if (action === "profile") return profileContent(user, data); if (action === "new") return newContent(user, data); if (action === "status") return statusContent(data); if (action === "saved") return savedContent(user, data); if (action === "pause") return { text: "⏸ Dein Suchprofil ist pausiert." }; if (action === "resume") return { text: "▶️ Dein Suchprofil ist wieder aktiv." }; return null; }

async function finish(updateId: number, attempt: number, success: boolean, error: string | null = null) { return rpc("finish_telegram_update", { p_update_id: updateId, p_attempt: attempt, p_success: success, p_error: error }); }
function finishBackground(updateId: number, attempt: number, success: boolean, error: string | null = null) { EdgeRuntime.waitUntil(finish(updateId, attempt, success, error).catch((e) => console.error("telegram_fast_finish", String(e)))); }
async function notifyAdminsNewUser(user: any) { const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || (user.username ? `@${user.username}` : String(user.telegram_user_id)); const username = user.username && name !== `@${user.username}` ? ` (@${user.username})` : ""; const text = `👤 Neuer Nutzer: ${name}${username}`; await Promise.all(ADMINS.filter((id) => id !== Number(user.telegram_user_id)).map((id) => telegram("sendMessage", { chat_id: id, text }).catch(() => {}))); }
async function forwardCore(body: string, supplied: string, callbackAcked = false) {
  // The shared handler authenticates the request; no second Edge invocation is needed.
  return handleTelegramUpdate(new Request(CORE, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": supplied, "x-callback-acked": callbackAcked ? "1" : "0" }, body }));
}
async function performCallback(query: any, action: string, user: any, data: any) {
  const chatId = Number(query.message?.chat?.id); const messageId = Number(query.message?.message_id); const hasPhoto = Array.isArray(query.message?.photo) && query.message.photo.length > 0;
  if (action === "premium" || (action === "saved" && !user.is_premium)) { const premium = premiumContent(user); if (hasPhoto) return telegram("editMessageMedia", { chat_id: chatId, message_id: messageId, media: { type: "photo", media: PREMIUM_IMAGE, caption: premium.caption, parse_mode: "HTML" }, reply_markup: premium.reply_markup }); await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {}); return telegram("sendPhoto", { chat_id: chatId, photo: PREMIUM_IMAGE, caption: premium.caption, parse_mode: "HTML", reply_markup: premium.reply_markup }); }
  const content = contentFor(action, user, data); if (!content) return; if (hasPhoto) { await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {}); return telegram("sendMessage", textParams(chatId, content.text, content.reply_markup)); } return telegram("editMessageText", { ...textParams(chatId, content.text, content.reply_markup), message_id: messageId });
}

Deno.serve(async (req: Request) => {
  let updateId: number | null = null; let attempt: number | null = null;
  try {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const supplied = req.headers.get("x-telegram-bot-api-secret-token") || ""; const body = await req.text(); const update = parse(body); const command = commandOf(update); const callback = String(update?.callback_query?.data || ""); const action = COMMAND_ACTIONS[command] || CALLBACK_ACTIONS[callback] || "";
    if (update?.callback_query?.id) {
      const query = update.callback_query;
      EdgeRuntime.waitUntil((async () => {
        let callbackUpdateId: number | null = null;
        let callbackAttempt: number | null = null;
        try {
          if (!action) {
            const response = await forwardCore(body, supplied, true);
            if (!response.ok) console.error("telegram_fast_core", response.status);
            return;
          }
          let prepared = await rpc("prepare_telegram_fast_request", { p_payload: update, p_action: action, p_supplied_secret: supplied });
          const retryUntil = Date.now() + 2000;
          while (prepared?.authorized === true && prepared?.claim < 0 && Date.now() < retryUntil) {
            await new Promise(resolve => setTimeout(resolve, 100));
            prepared = await rpc("prepare_telegram_fast_request", { p_payload: update, p_action: action, p_supplied_secret: supplied });
          }
          if (prepared?.authorized !== true) return;
          const claim = Number(prepared?.claim ?? 0);
          if (claim <= 0) return;
          callbackUpdateId = Number(update.update_id);
          callbackAttempt = claim;
          const user = { ...(prepared?.user || {}), is_premium: prepared?.is_premium === true, __is_new_user: prepared?.is_new_user === true };
          const data = prepared?.action_data || {};
          if (prepared?.fast_eligible === false) {
            await finish(callbackUpdateId, callbackAttempt, false, "fast_path_language_fallback");
            callbackUpdateId = null; callbackAttempt = null;
            const response = await forwardCore(body, supplied, true);
            if (!response.ok) console.error("telegram_fast_core", response.status);
            return;
          }
          if (!user.is_active && !ADMINS.includes(Number(user.telegram_user_id))) {
            await finish(callbackUpdateId, callbackAttempt, true);
            return;
          }
          await performCallback(query, action, user, data);
          await finish(callbackUpdateId, callbackAttempt, true);
        } catch (error) {
          console.error("telegram_fast_callback", String(error));
          if (callbackUpdateId !== null && callbackAttempt !== null)
            await finish(callbackUpdateId, callbackAttempt, false, String(error)).catch(() => {});
        }
      })());
      return direct("answerCallbackQuery", { callback_query_id: query.id });
    }
    if (!action) return forwardCore(body, supplied);
    const prepared = await rpc("prepare_telegram_fast_request", { p_payload: update, p_action: action, p_supplied_secret: supplied });
    if (prepared?.authorized !== true) return new Response("unauthorized", { status: 401 });
    const claim = Number(prepared?.claim ?? 0); if (claim === 0) return Response.json({ ok: true, duplicate: true }); if (claim < 0) return Response.json({ ok: false, busy: true }, { status: 503 });
    updateId = Number(update.update_id); attempt = claim; const user = { ...(prepared?.user || {}), is_premium: prepared?.is_premium === true, __is_new_user: prepared?.is_new_user === true }; const data = prepared?.action_data || {};
    if (prepared?.fast_eligible === false) { await finish(updateId, attempt, false, "fast_path_language_fallback"); updateId = null; attempt = null; return forwardCore(body, supplied); }
    if (!user.is_active && !ADMINS.includes(Number(user.telegram_user_id))) { finishBackground(updateId, attempt, true); return Response.json({ ok: true, blocked: true }); }
    const chatId = Number(update?.message?.chat?.id); if (!chatId) throw new Error("missing chat id");
    if (action === "home") { const argument = argumentOf(update); if (argument.startsWith("ref_") && user.__is_new_user) await rpc("redeem_referral_code", { p_referred_user_id: user.id, p_code: argument.slice(4) }).catch((e) => console.error("referral_register", String(e))); EdgeRuntime.waitUntil(telegram("setChatMenuButton", { chat_id: chatId, menu_button: { type: "commands" } }).catch(() => {})); if (user.__is_new_user) EdgeRuntime.waitUntil(notifyAdminsNewUser(user)); }
    let response: Response; if (action === "premium" || (action === "saved" && !user.is_premium)) { const premium = premiumContent(user); response = direct("sendPhoto", { chat_id: chatId, photo: PREMIUM_IMAGE, caption: premium.caption, parse_mode: "HTML", reply_markup: premium.reply_markup }); } else { const content = contentFor(action, user, data); if (!content) throw new Error(`unsupported fast action ${action}`); response = direct("sendMessage", textParams(chatId, content.text, content.reply_markup)); }
    finishBackground(updateId, attempt, true); return response;
  } catch (error) { if (updateId !== null && attempt !== null) finishBackground(updateId, attempt, false, String(error)); console.error("telegram_fast", String(error)); return Response.json({ ok: false, error: "telegram_fast_failure" }, { status: 502 }); }
});
