import { db, button, send, edit } from "./runtime.js";
import { homePreview, languageMenu as renderLanguageMenu } from "./home-language.js";

export function homeKeyboard(user) {
  return { inline_keyboard: [
    [button("🔎 Suchprofil", "profile")],
    [button("👤 Bewerberprofil", "platforms:profile-new")],
    [button(user.is_premium ? "⚡ Auto-Bewerbung" : "🔒 Auto-Bewerbung", "platforms")],
    [button(user.is_premium ? "💎 Mein Premium" : "💎 Premium ansehen", "premium")],
    [button("⚙️ Einstellungen", "settings")],
  ] };
}

export function home(user, chatId, messageId) {
  const text = homePreview(user.ui_language);
  return messageId ? edit(chatId, messageId, text, homeKeyboard(user)) : send(chatId, text, homeKeyboard(user));
}

export async function premium(user, chatId, messageId) {
  const rows = [];
  let text;
  if (user.is_premium) {
    text = "💎 <b>Traumwohnung Premium</b>\n\n✅ <b>Premium ist aktiv.</b>\n\n"
      + "<b>Deine Vorteile:</b>\n⚡ Sofortige Zustellung\n🔎 Bis zu 4 Suchprofile\n"
      + "🤖 Auto-Bewerbung\n🔓 Baugenossenschafts-Angebote öffnen";
    if (user.subscription?.cancel_at_period_end) text += "\n\nDein Abonnement ist zur Kündigung vorgemerkt.";
    // A manually granted Premium account has no Stripe subscription to manage.
    if (user.subscription?.stripe_customer_id) {
      const { data: portal, error } = await db.rpc("get_bot_secret", { secret_name: "stripe_portal_url" });
      if (!error && typeof portal === "string" && /^https:\/\/billing\.stripe\.com\//.test(portal)) {
        rows.push([{ text: "💳 Abo verwalten", url: portal }]);
      } else {
        text += "\n\nDie Aboverwaltung ist derzeit nicht verfügbar.";
      }
    }
  } else {
    text = "💎 <b>Traumwohnung Premium</b>\n\n<b>Deine Vorteile:</b>\n"
      + "⚡ Sofortige Zustellung\n🔎 Bis zu 4 Suchprofile\n🤖 Auto-Bewerbung\n"
      + "🔓 Baugenossenschafts-Angebote öffnen\n\n"
      + "<s>1,99 €</s> <b>0,99 € / Monat</b>\nKeine Mindestlaufzeit · jederzeit kündbar";
    text += "\n\nDer Premium-Tarif ist aktuell nicht direkt buchbar.";
  }
  rows.push([button("← Start", "home")]);
  const markup = { inline_keyboard: rows };
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
    [button("❓ Hilfe", "help")],
    [button("🎁 30 Tage Premium kostenlos", "referral")],
    [button("← Start", "home")],
  ] };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

export function languageMenu(user, chatId, messageId) {
  return renderLanguageMenu(user, chatId, messageId, send, edit, button);
}
