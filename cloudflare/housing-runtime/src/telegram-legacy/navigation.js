import { db, button, send, edit, runtimeEnv } from "./runtime.js";
import { homePreview, languageMenu as renderLanguageMenu } from "./home-language.js";

// Telegram reply keyboard: shown below the message input, independently of the
// existing inline buttons in the home message.
export const QUICK_ACTIONS = Object.freeze({
  home: "🏠 Startmenü",
  premium: "💎 Premium",
  settings: "⚙️ Einstellungen",
  saved: "⭐ Gespeichert",
});

export function quickActionsKeyboard() {
  return {
    keyboard: [
      [{ text: QUICK_ACTIONS.home }, { text: QUICK_ACTIONS.premium }],
      [{ text: QUICK_ACTIONS.settings }, { text: QUICK_ACTIONS.saved }],
    ],
    is_persistent: true,
    resize_keyboard: true,
    one_time_keyboard: false,
    input_field_placeholder: "Schnellzugriff wählen",
  };
}

const REPLY_KEYBOARD_VERSION = 5;

export async function showQuickActions(chatId, user, { force = false } = {}) {
  const database = runtimeEnv()?.HOUSING_DB;
  if (!database?.prepare || !user?.id) return;
  const existing = await database.prepare(
    "SELECT reply_keyboard_version FROM participants WHERE id=?"
  ).bind(user.id).first();
  if (!existing || (!force && Number(existing.reply_keyboard_version) >= REPLY_KEYBOARD_VERSION)) return;
  // Telegram cannot report whether a user has hidden/removed the reply
  // keyboard. /commands explicitly reinstalls it without making every /start
  // send an extra setup message.
  await send(chatId, "Die vier Schnellfunktionen sind wieder verfügbar.", quickActionsKeyboard());
  await database.prepare(
    "UPDATE participants SET reply_keyboard_version=? WHERE id=? AND reply_keyboard_version<?"
  ).bind(REPLY_KEYBOARD_VERSION, user.id, REPLY_KEYBOARD_VERSION).run();
}

export const MINIAPP_URL = "https://traumwohnung-housing-runtime.arash-ce5.workers.dev/miniapp";

export function miniAppKeyboard() {
  return { inline_keyboard: [[{ text: "📱 Wohnungs-App öffnen", web_app: { url: MINIAPP_URL } }]] };
}

export function homeKeyboard(user) {
  return { inline_keyboard: [
    [{ text: "📱 Wohnungs-App öffnen", web_app: { url: MINIAPP_URL } }],
    [button("🔎 Suchprofil", "profile")],
    [button("👤 Bewerberprofil", "platforms:profile-new")],
    [button(user.is_premium ? "⚡ Auto-Bewerbung" : "🔒 Auto-Bewerbung", "platforms")],

  ] };
}

export function home(user, chatId, messageId) {
  const text = homePreview(user.ui_language);
  return messageId ? edit(chatId, messageId, text, homeKeyboard(user)) : send(chatId, text, homeKeyboard(user));
}

const PREMIUM_TIER_PREVIEWS = Object.freeze({
  go: { label: "Go", benefits: ["🔎 1 Suchprofil", "🏠 Passende Angebote erhalten"] },
  pro: { label: "Pro", benefits: ["✓ Alles aus Go", "🔎 Bis zu 4 Suchprofile", "🤖 Auto-Bewerbung"] },
  max: { label: "Max", benefits: ["✓ Alles aus Pro", "✨ Weitere Funktionen in Planung"] },
});

export async function premium(user, chatId, messageId) {
  const rows = [[
    button("Go", "premium:tier:go"),
    button("Pro", "premium:tier:pro"),
    button("Max", "premium:tier:max"),
  ]];
  let text = "💎 <b>Traumwohnung Premium – Tarife (Vorschau)</b>\n\n";
  if (user.is_premium) {
    text += "✅ <b>Dein Premium-Zugang ist aktiv.</b>\n";
    if (user.subscription?.cancel_at_period_end)
      text += "Dein Abonnement ist zur Kündigung vorgemerkt.\n";
    text += "\n";
  }
  text += Object.values(PREMIUM_TIER_PREVIEWS)
    .map(plan => "<b>" + plan.label + "</b>\n" + plan.benefits.join("\n"))
    .join("\n\n");
  text += "\n\n<i>Alle drei Angebote sind vorerst Platzhalter und nicht buchbar. Bestehende Premium-Rechte bleiben unverändert.</i>";
  // Existing paying subscribers must still be able to manage their subscription.
  if (user.is_premium && user.subscription?.stripe_customer_id) {
    const { data: portal, error } = await db.rpc("get_bot_secret", { secret_name: "stripe_portal_url" });
    if (!error && typeof portal === "string" && /^https:\/\/billing\.stripe\.com\//.test(portal)) {
      rows.push([{ text: "💳 Abo verwalten", url: portal }]);
    } else {
      text += "\n\nDie Aboverwaltung ist derzeit nicht verfügbar.";
    }
  }
  rows.push([button("← Start", "home")]);
  const markup = { inline_keyboard: rows };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

export function premiumTier(tier, chatId, messageId) {
  const plan = PREMIUM_TIER_PREVIEWS[tier];
  if (!plan) return;
  const text = "💎 <b>" + plan.label + " – Vorschau</b>\n\n"
    + plan.benefits.join("\n")
    + "\n\n<i>Dieser Tarif ist derzeit nur ein Platzhalter und nicht buchbar.</i>";
  const markup = { inline_keyboard: [[button("← Tarifübersicht", "premium")]] };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

export async function setPaused(userId, paused, slot) {
  let query = db.from("search_profiles").update({ is_active: !paused, updated_at: new Date().toISOString() }).eq("user_id", userId);
  if (slot) query = query.eq("profile_slot", slot);
  const { error } = await query;
  if (error) throw error;
}

export async function referralPage(user, chatId, messageId) {
  const { data: code, error } = await db.rpc("get_or_create_referral_code", { p_user: user.id });
  if (error || !code?.code) throw error || new Error("Empfehlungslink konnte nicht erstellt werden.");
  const link = `https://t.me/traumwohnunghamburgbot?start=ref_${encodeURIComponent(code.code)}`;
  const text = "🎁 <b>30 Tage Premium kostenlos</b>\n\n"
    + "Empfiehl Traumwohnung Hamburg weiter. Sobald die geworbene Person ihr erstes Suchprofil aktiviert, "
    + "erhaltet ihr beide 30 Tage Premium kostenlos.\n\n"
    + "<b>Dein persönlicher Empfehlungslink:</b>\n" + link;
  const markup = { inline_keyboard: [
    [{ text: "📤 Link teilen", url: "https://t.me/share/url?url=" + encodeURIComponent(link) }],
    [{ text: "📋 Link kopieren", copy_text: { text: link } }],
    [button("← Einstellungen", "settings")],
  ] };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

export function settings(user, chatId, messageId) {
  const text = "⚙️ <b>Einstellungen</b>\n\nHilfe und Premium-Empfehlungen.";
  const markup = { inline_keyboard: [
    [button("🌐 Sprache", "language")],
    [button("❓ Hilfe & Support", "help")],
    [button("♻️ Reset", "reset:page")],
    [button("🎁 30 Tage Premium kostenlos", "referral")],
    [button("← Start", "home")],
  ] };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

export function languageMenu(user, chatId, messageId) {
  return renderLanguageMenu(user, chatId, messageId, send, edit, button);
}
