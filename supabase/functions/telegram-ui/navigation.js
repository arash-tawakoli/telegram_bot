import { LANGS } from "./localization.js";
import { profile } from "./profiles.js";
import { db, PREMIUM_LINK, SAVED_PAGE_SIZE, short, button, send, edit, sendPremiumPreview, editPremiumPreview } from "./runtime.js";
export function homeKeyboard(user) {
    const rows = [
        [button("🔎 Suche & Filter", "profile")],
        [
            button(user.is_premium ? "⭐ Gespeichert" : "🔒 ⭐ Gespeichert", "saved"),
            user.is_premium
                ? button("⚡ Auto-Bewerbung", "platforms")
                : button("🔒 Auto-Bewerbung", "platforms"),
        ],
        [
            button("⚙️ Einstellungen", "settings"),
            button("❓ Hilfe", "help"),
        ],
        [button("🎁 30 Tage Premium kostenlos", "referral")],
    ];
    return { inline_keyboard: rows };
}

export function home(user, chatId, messageId) {
    const text = "🏠 <b>Traumwohnung Hamburg</b>\n\n" +
        "Finde passende Mietangebote in Hamburg – automatisch und direkt per Telegram.\n\n" +
        "Wähle unten, was du machen möchtest.";
    return messageId
        ? edit(chatId, messageId, text, homeKeyboard(user))
        : send(chatId, text, homeKeyboard(user));
}

export async function premium(user, chatId, messageId, messageHasPhoto = false) {
    const rows = [];
    let text;
    const checkoutUrl = `${PREMIUM_LINK}?client_reference_id=${encodeURIComponent(user.id)}`;
    if (user.is_premium) {
        text = "💎 <b>Traumwohnung Premium</b>\n\n✅ <b>Premium ist aktiv.</b>\n\n<b>Deine Vorteile:</b>\n⚡ Sofortige Zustellung\n🔎 Bis zu 4 Suchprofile\n🤖 Auto-Bewerbung\n🔓 Baugenossenschafts-Angebote öffnen\n⭐️ Inserate speichern";
        let portal = null;
        try {
            const result = await db.rpc("get_bot_secret", { secret_name: "stripe_portal_url" });
            if (!result.error)
                portal = result.data;
        }
        catch {
        }
        const billingUrl = typeof portal === "string" && /^https:\/\/billing\.stripe\.com\//.test(portal) ? portal : checkoutUrl;
        rows.push([{ text: "💳 Abo verwalten", url: billingUrl }]);
    }
    else {
        text = "💎 <b>Traumwohnung Premium</b>\n\n<b>Deine Vorteile:</b>\n⚡ Sofortige Zustellung\n🔎 Bis zu 4 Suchprofile\n🤖 Auto-Bewerbung\n🔓 Baugenossenschafts-Angebote öffnen\n⭐️ Inserate speichern\n\n<s>1,99 €</s> <b>0,99 € / Monat</b>\nKeine Mindestlaufzeit · jederzeit kündbar";
        rows.push([{ text: "💎 Jetzt abonnieren", url: checkoutUrl }]);
    }
    rows.push([button("← Zurück", "home")]);
    const markup = { inline_keyboard: rows };
    return messageId
        ? edit(chatId, messageId, text, markup)
        : send(chatId, text, markup);
}

export async function saved(user, chatId, messageId, requestedPage = 0) {
    if (!user.is_premium)
        return premium(user, chatId, messageId);
    const { count, error: countError } = await db
        .from("saved_listings")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
    if (countError)
        throw countError;
    const total = count || 0;
    if (!total) {
        const text = "⭐️ <b>Gespeicherte Inserate</b>\n\nNoch keine Inserate gespeichert.";
        const markup = { inline_keyboard: [[button("← Zurück", "home")]] };
        return messageId
            ? edit(chatId, messageId, text, markup)
            : send(chatId, text, markup);
    }
    const pages = Math.max(1, Math.ceil(total / SAVED_PAGE_SIZE));
    const page = Math.max(0, Math.min(Number(requestedPage) || 0, pages - 1));
    const from = page * SAVED_PAGE_SIZE;
    const to = from + SAVED_PAGE_SIZE - 1;
    const { data, error } = await db
        .from("saved_listings")
        .select("listing_id,created_at,listings(title,canonical_url,is_active)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(from, to);
    if (error)
        throw error;
    const rows = [];
    for (const [index, row] of (data || []).entries()) {
        const listing = row.listings || {};
        const label = `🏠 ${from + index + 1}. ${short(listing.title, 42)}`;
        try {
            const url = new URL(listing.canonical_url);
            if (["http:", "https:"].includes(url.protocol)) {
                rows.push([{ text: label, url: url.href }]);
                continue;
            }
        }
        catch {
        }
        rows.push([button(label, "noop")]);
    }
    rows.push([
        button("‹ Vorherige", `saved:${Math.max(0, page - 1)}`),
        button(`${page + 1}/${pages}`, "noop"),
        button("Nächste ›", `saved:${Math.min(pages - 1, page + 1)}`),
    ]);
    rows.push([button("← Start", "home")]);
    const text = `⭐️ <b>Gespeicherte Inserate</b>\n\n${total} · Seite ${page + 1}/${pages}`;
    const markup = { inline_keyboard: rows };
    return messageId
        ? edit(chatId, messageId, text, markup)
        : send(chatId, text, markup);
}

export async function setPaused(userId, paused, slot) {
    let query = db.from("search_profiles").update({ is_active: !paused, updated_at: new Date().toISOString() }).eq("user_id", userId);
    if (slot)
        query = query.eq("profile_slot", slot);
    const { error } = await query;
    if (error)
        throw error;
}

export async function toggleSave(user, listingId) {
  if (!user.is_premium) return null;
  const {data,error}=await db.rpc('toggle_saved_once',{p_update_id:user.request_update_id,p_user_id:user.id,p_listing_id:listingId});
  if(error) throw error;
  return data;
}

export async function referralPage(user, chatId, messageId) {
    let { data: code, error } = await db.from("referral_codes").select("code").eq("user_id", user.id).maybeSingle();
    if (error)
        throw error;
    if (!code) {
        const value = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
        const result = await db.from("referral_codes").insert({ user_id: user.id, code: value }).select("code").single();
        if (result.error)
            throw result.error;
        code = result.data;
    }
    await send(chatId, "🎁 <b>30 Tage Premium für 0 €</b>\n\n" +
        "Empfehle Traumwohnung Hamburg weiter und ihr erhaltet beide 30 Tage Premium kostenlos 💎\n\n" +
        "Teile jetzt diesen Link 👇");
    return send(chatId, `https://t.me/traumwohnunghamburgbot?start=ref_${code.code}`);
}

export async function languagePage(user, chatId, messageId) {
    const codes = ["de", "en", "ckb", "ku", "prs", "fa", "ru", "tr", "ar"];
    const rows = codes.map((code) => [button(`${user.ui_language === code ? "✅ " : ""}${LANGS[code]}`, `lang:${code}`)]);
    rows.push([button("← Einstellungen", "settings")]);
    const markup = { inline_keyboard: rows };
    const text = "🌐 <b>Sprachen</b>\n\nWähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.";
    return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

export async function settings(user, chatId, messageId) {
    const text = "⚙️ <b>Einstellungen</b>\n\nKonten, Sprache, Premium und Systeminformationen.";
    const markup = { inline_keyboard: [
            [user.is_premium
                ? button("⚡ Bewerbung & Konten", "platforms")
                : { text: "🔒 ⚡ Bewerbung & Konten", url: `${PREMIUM_LINK}?client_reference_id=${encodeURIComponent(user.id)}` }],
            [button("🌐 Sprache", "language"), button(user.is_premium ? "💎 Premium aktiv" : "💎 Premium", "premium")],
            [button("📡 Systemstatus", "status")],
            [button("← Start", "home")],
        ] };
    return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}
