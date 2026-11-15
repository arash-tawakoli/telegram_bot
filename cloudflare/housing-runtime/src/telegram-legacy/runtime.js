import { createD1Supabase } from "./d1-supabase.js";

export let db = null;
let env = {};
export const PREMIUM_LINK = "https://buy.stripe.com/dRm9AM7DSajfgYK2qVfYY01";
export const PROPERTY_TYPES = ["Wohnung", "Haus"];
export const RENT_PRESETS = new Set([800, 1000, 1250, 2000]);
export const ROOM_PRESETS = new Set([1, 2, 3, 4]);
export const AREA_PRESETS = new Set([20, 40, 50, 70, 90]); // 50 m² remains valid for saved legacy profiles.
export const ROOM_AREA_PRESETS = new Set([0, 8, 10, 12, 15, 20]);
export const NEIGHBORHOODS_PER_PAGE = 10;
export const SECRET_TTL_MS = 5 * 60_000;
export const GEO_TTL_MS = 30 * 60_000;
export const ADMIN_TELEGRAM_USER_IDS = new Set([8538226539]);
export const secretCache = new Map();
export let geoCache = null;
let geographyDatabase = null;

export function configureLegacyRuntime(nextEnv, d1) { env = nextEnv; geographyDatabase = d1; geoCache = null; db = createD1Supabase(d1, env); }
export function runtimeEnv() { return env; }
export async function withPlan(user, subscription = null) {
  const now = Date.now();
  if (user?.plan_override === "free" && (!user.plan_override_expires_at || Date.parse(user.plan_override_expires_at) > now)) return { ...user, is_premium: false, subscription };
  if (user?.plan_override === "premium" && (!user.plan_override_expires_at || Date.parse(user.plan_override_expires_at) > now)) {
    return { ...user, is_premium: true, subscription };
  }
  if (user?.referral_bonus_until && Date.parse(user.referral_bonus_until) > now) {
    return { ...user, is_premium: true, subscription };
  }
  const activeSubscription = subscription
    && ["active", "trialing"].includes(String(subscription.status))
    && (!subscription.current_period_end || Date.parse(subscription.current_period_end) > now);
  return { ...user, is_premium: Boolean(activeSubscription), subscription };
}
export function finiteOrNull(value) { if (value == null || value === "") return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
export function esc(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
export function money(value) { if (value == null || value === "") return "–"; const number = Number(value); return Number.isFinite(number) ? `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(number)} €` : String(value); }
export function short(value, max = 45) { const text = String(value || "Inserat").replace(/\s+/g, " ").trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; }
export function button(text, callbackData) { return { text, callback_data: callbackData }; }
export function cancelRow() { return [button("✖️ Abbrechen", "cancel")]; }
export function backRow(callbackData, nextCallbackData) { const row = [button("← Zurück", callbackData)]; if (nextCallbackData) row.push(button("Weiter →", nextCallbackData)); return row; }

export async function secret(name, force = false) {
  const cached = secretCache.get(name);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
  const values = { telegram_bot_token_runtime: env.TELEGRAM_BOT_TOKEN, telegram_webhook_secret: env.TELEGRAM_WEBHOOK_SECRET, stripe_portal_url: env.STRIPE_PORTAL_URL, immoscout_central_cloudflare_api_secret: env.CENTRAL_API_SECRET };
  const value = values[name];
  if (!value) throw new Error(`secret ${name} unavailable`);
  secretCache.set(name, { value: String(value), expiresAt: Date.now() + SECRET_TTL_MS });
  return String(value);
}

export async function telegram(method, body, retry = true) {
  const token = await secret("telegram_bot_token_runtime");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", signal: AbortSignal.timeout(20_000), headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if ((!response.ok || !result.ok) && response.status === 401 && retry) { secretCache.delete("telegram_bot_token_runtime"); return telegram(method, body, false); }
  if (!response.ok || !result.ok) throw new Error(String(result?.description || `Telegram ${response.status}`));
  return result.result;
}

export function send(chatId, text, replyMarkup) { return telegram("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: replyMarkup }); }
// Native Telegram fire effect for private chats; replaces the previous confetti effect.
export const CELEBRATION_EFFECT_ID = "5104841245755180586";
export async function sendCelebration(chatId, text, replyMarkup) { try { return await telegram("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", reply_markup: replyMarkup, message_effect_id: CELEBRATION_EFFECT_ID }); } catch { return send(chatId, text, replyMarkup); } }
export async function edit(chatId, messageId, text, replyMarkup) { try { return await telegram("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: replyMarkup }); } catch (error) { const reason = String(error?.message || error); if (/message is not modified/i.test(reason)) return null; if (/message (?:to edit )?not found|message can(?:not|\x27t) be edited|there is no text in the message to edit/i.test(reason)) return send(chatId, text, replyMarkup); throw error; } }
export async function sendPremiumPreview(chatId, caption, replyMarkup) { return send(chatId, caption, replyMarkup); }
export async function editPremiumPreview(chatId, messageId, caption, replyMarkup) { return edit(chatId, messageId, caption, replyMarkup); }
export async function acknowledge(id, text) { await telegram("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) }).catch(() => {}); }
export function hasCanceledPremium() { return false; }
export async function saveState(userId, step, draft, updateId = null, attempt = null) { const state = draft && typeof draft === "object" ? draft : {}; state._step = step; await db.rpc("save_ui_state", { p_user: userId, p_step: step, p_state: state, p_update_id: updateId, p_attempt: attempt, p_revision: Number(state._revision || 0) }); return state; }
export async function geography() {
  if (geoCache && geoCache.expiresAt > Date.now()) return geoCache.value;
  if (!geographyDatabase || typeof geographyDatabase.prepare !== "function") throw new Error("geography_database_unavailable");
  const row = await geographyDatabase.prepare("SELECT payload FROM coach_geo_snapshot WHERE id='de-hh-sh' LIMIT 1").first();
  if (!row?.payload) throw new Error("geography_snapshot_missing");
  let value;
  try { value = JSON.parse(row.payload); } catch { throw new Error("geography_snapshot_invalid"); }
  if (!Array.isArray(value?.boroughs) || !value.boroughs.length ||
      !Array.isArray(value?.neighborhoods) || !value.neighborhoods.length ||
      !Array.isArray(value?.schleswigHolsteinAreas) || !value.schleswigHolsteinAreas.length) {
    throw new Error("geography_snapshot_incomplete");
  }
  geoCache = { value, expiresAt: Date.now() + GEO_TTL_MS };
  return value;
}
export const HELP_TEXT = "❓ <b>Hilfe & Befehle</b>\n\n🏠 /start – Startmenü\n🔎 /suche – Suchprofil erstellen\n👤 /suchprofile – Suchprofile anzeigen\n⚙️ /einstellungen – Einstellungen\n⏸ /pause – Suche pausieren\n▶️ /fortsetzen – Suche fortsetzen\n📊 /status – Systemstatus\n💎 /premium – Premium\n🌐 /sprache – Sprache wählen\n❓ /hilfe – Hilfe & Support";
