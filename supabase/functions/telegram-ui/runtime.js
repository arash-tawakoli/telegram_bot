import {createClient} from "npm:@supabase/supabase-js@2.112.4";
import { localizeText, localizeMarkup } from "./localization.js";
export const SUPABASE_URL = Deno.env.get("SUPABASE_URL");

export const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");

export const SERVICE_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

export const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

export const PREMIUM_LINK = "https://buy.stripe.com/dRm9AM7DSajfgYK2qVfYY01";

export const PROPERTY_TYPES = [
    "Wohnung",
    "Haus",
    "WG",
    "Tauschwohnung",
];

export const RENT_PRESETS = new Set([800, 1000, 1250, 2000]);

export const ROOM_PRESETS = new Set([1, 2, 3, 4]);

export const AREA_PRESETS = new Set([20, 50, 70, 90]);

export const NEIGHBORHOODS_PER_PAGE = 10;

export const SAVED_PAGE_SIZE = 8;

export const SECRET_TTL_MS = 5 * 60_000;

export const GEO_TTL_MS = 30 * 60_000;

export const ADMIN_TELEGRAM_USER_IDS = new Set([8538226539, 414638980]);

export const secretCache = new Map();

export const chatLanguages = new Map();

export let geoCache = null;

export function finiteOrNull(value) {
    if (value == null || value === "")
        return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

export function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const numberFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

export function money(value) {
    if (value == null || value === "")
        return "–";
    const number = Number(value);
    return Number.isFinite(number)
        ? `${numberFormat.format(number)} €`
        : String(value);
}

export function short(value, max = 45) {
    const text = String(value || "Inserat").replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function button(text, callbackData) {
    return { text, callback_data: callbackData };
}

export function cancelRow() {
    return [button("✖️ Abbrechen", "cancel")];
}

export function backRow(callbackData, nextCallbackData) {
    const row = [button("← Zurück", callbackData)];
    if (nextCallbackData)
        row.push(button("Weiter →", nextCallbackData));
    return row;
}

export async function secret(name, force = false) {
    const cached = secretCache.get(name);
    if (!force && cached && cached.expiresAt > Date.now())
        return cached.value;
    const { data, error } = await db.rpc("get_bot_secret", {
        secret_name: name,
    });
    if (error || !data)
        throw new Error(`secret ${name} unavailable`);
    const value = String(data);
    secretCache.set(name, { value, expiresAt: Date.now() + SECRET_TTL_MS });
    return value;
}

export async function telegram(method, body, retry = true) {
    const token = await secret("telegram_bot_token_runtime");
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        signal: AbortSignal.timeout(20000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if ((!response.ok || !result.ok) && response.status === 401 && retry) {
        secretCache.delete("telegram_bot_token_runtime");
        return telegram(method, body, false);
    }
    if (!response.ok || !result.ok) {
        throw new Error(String(result?.description || `Telegram ${response.status}`));
    }
    return result.result;
}

export function send(chatId, text, replyMarkup) {
    return telegram("sendMessage", {
        chat_id: chatId,
        text: localizeText(text, chatLanguages.get(chatId)),
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: localizeMarkup(replyMarkup, chatLanguages.get(chatId)),
    });
}

export const PARTY_EFFECT_ID = "5046509860389126442";

export async function sendCelebration(chatId, text, replyMarkup) {
    const language = chatLanguages.get(chatId);
    try {
        return await telegram("sendMessage", {
            chat_id: chatId,
            text: localizeText(text, language),
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: localizeMarkup(replyMarkup, language),
            message_effect_id: PARTY_EFFECT_ID,
        });
    }
    catch {
        return send(chatId, text, replyMarkup);
    }
}

export async function edit(chatId, messageId, text, replyMarkup) {
    try {
        return await telegram("editMessageText", {
            chat_id: chatId,
            message_id: messageId,
            text: localizeText(text, chatLanguages.get(chatId)),
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: localizeMarkup(replyMarkup, chatLanguages.get(chatId)),
        });
    }
    catch {
        return send(chatId, text, replyMarkup);
    }
}

export function premiumPreviewUrl() {
    return `${SUPABASE_URL}/functions/v1/telegram-premium-image?v=20260903hd4`;
}

export async function sendPremiumPreview(chatId, caption, replyMarkup) {
    const language = chatLanguages.get(chatId);
    return telegram("sendPhoto", {
        chat_id: chatId,
        photo: premiumPreviewUrl(),
        caption: localizeText(caption, language),
        parse_mode: "HTML",
        reply_markup: localizeMarkup(replyMarkup, language),
    });
}

export async function editPremiumPreview(chatId, messageId, caption, replyMarkup) {
    const language = chatLanguages.get(chatId);
    return telegram("editMessageMedia", {
        chat_id: chatId,
        message_id: messageId,
        media: {
            type: "photo",
            media: premiumPreviewUrl(),
            caption: localizeText(caption, language),
            parse_mode: "HTML",
        },
        reply_markup: localizeMarkup(replyMarkup, language),
    });
}

export async function acknowledge(id, text) {
    try {
        await telegram("answerCallbackQuery", { callback_query_id: id, text });
    }
    catch {
    }
}

export async function withPlan(user, subscription = undefined) {
    if (subscription === undefined) {
    const { data, error } = await db
        .from("user_subscriptions")
        .select("status,current_period_end,cancel_at_period_end")
        .eq("user_id", user.id)
        .maybeSingle();
    if (error)
        throw error;
    subscription = data;
    }
    const now = Date.now();
    const premium = user.plan_override === "free"
        ? false
        : (user.plan_override === "premium" &&
            (!user.plan_override_expires_at ||
                new Date(user.plan_override_expires_at).getTime() > now)) ||
            (!!user.referral_bonus_until &&
                new Date(user.referral_bonus_until).getTime() > now) ||
            (!!subscription &&
                ["active", "trialing"].includes(String(subscription.status)) &&
                (!subscription.current_period_end ||
                    new Date(subscription.current_period_end).getTime() > now));
    return { ...user, is_premium: !!premium, subscription };
}

export async function saveState(userId, step, draft) {
    const { error } = await db
        .from("bot_users")
        .update({
        onboarding_step: step,
        onboarding_state: draft,
        updated_at: new Date().toISOString(),
    })
        .eq("id", userId);
    if (error)
        throw error;
}

export async function geography() {
    if (geoCache && geoCache.expiresAt > Date.now())
        return geoCache.value;
    const [boroughResult, neighborhoodResult] = await Promise.all([
        db.from("hamburg_boroughs").select("id,name,sort_order").order("sort_order"),
        db.from("hamburg_neighborhoods").select("id,name,borough_id").order("id"),
    ]);
    if (boroughResult.error)
        throw boroughResult.error;
    if (neighborhoodResult.error)
        throw neighborhoodResult.error;
    const value = {
        boroughs: boroughResult.data || [],
        neighborhoods: neighborhoodResult.data || [],
    };
    geoCache = { value, expiresAt: Date.now() + GEO_TTL_MS };
    return value;
}

export const HELP_TEXT = "❓ <b>Hilfe & Befehle</b>\n\n" +
    "🏠 /start – Startmenü\n" +
    "🔎 /suche – Suchprofil erstellen oder ersetzen\n" +
    "👤 /profile – Suchprofil anzeigen\n" +
    "⭐️ /gespeichert – gespeicherte Inserate\n" +
    "⚙️ /einstellungen – Einstellungen\n" +
    "🗂 /planer – Status, Notizen, Vergleich, Kontakttexte und Kosten\n" +
    "⏸ /pause – Suche pausieren\n" +
    "▶️ /resume – Suche fortsetzen\n" +
    "📡 /status – Systemstatus\n" +
    "💎 /premium – Premium anzeigen\n" +
    "❓ /hilfe – Hilfe";

export async function finishUpdate(updateId,attempt,success,error=null) {
 const {data,error:rpcError}=await db.rpc('finish_telegram_update',{p_update_id:updateId,p_attempt:attempt,p_success:success,p_error:error});
 if(rpcError) throw rpcError;
 if(!data) throw new Error('Telegram update lease lost');
}
