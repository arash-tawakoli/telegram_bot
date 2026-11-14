import { db, PREMIUM_LINK, button, send, edit } from "./runtime.js";

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
  const text = "🏠 <b>Traumwohnung Hamburg</b>\n\n"
    + "Dein Bot, der rund um die Uhr passende Wohnungen sucht und dich automatisch bewirbt.\n\n"
    + "<b>In 3 Schritten zur automatisierten Bewerbung:</b>\n\n"
    + "1. Suchprofil erstellen\n"
    + "2. Bewerberprofil erstellen\n"
    + "3. Auto-Bewerbung einrichten\n\n"
    + "<b>Jetzt loslegen!👇</b>";
  return messageId ? edit(chatId, messageId, text, homeKeyboard(user)) : send(chatId, text, homeKeyboard(user));
}

export async function premium(user, chatId, messageId) {
  const rows = [];
  const checkoutUrl = `${PREMIUM_LINK}?client_reference_id=${encodeURIComponent(user.id)}`;
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
    rows.push([{ text: "💎 Premium abonnieren", url: checkoutUrl }]);
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
  let { data: code, error } = await db.from("referral_codes").select("code").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!code) {
    const value = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
    const result = await db.from("referral_codes").insert({ user_id: user.id, code: value }).select("code").single();
    if (result.error) throw result.error;
    code = result.data;
  }
  const link = `https://t.me/traumwohnunghamburgbot?start=ref_${encodeURIComponent(code.code)}`;
  const text = "🎁 <b>30 Tage Premium kostenlos</b>\n\n"
    + "Empfiehl Traumwohnung Hamburg weiter. Sobald die geworbene Person ihr erstes Suchprofil aktiviert, "
    + "erhaltet ihr beide 30 Tage Premium kostenlos.\n\n"
    + "<b>Dein persönlicher Empfehlungslink:</b>\n" + link;
  const markup = { inline_keyboard: [
    [{ text: "📤 Link teilen", url: "https://t.me/share/url?url=" + encodeURIComponent(link) }],
    [button("← Einstellungen", "settings")],
  ] };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

export function settings(user, chatId, messageId) {
  const text = "⚙️ <b>Einstellungen</b>\n\nHilfe und Premium-Empfehlungen.";
  const markup = { inline_keyboard: [
    [button("❓ Hilfe", "help")],
    [button("🎁 30 Tage Premium kostenlos", "referral")],
    [button("← Start", "home")],
  ] };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}
