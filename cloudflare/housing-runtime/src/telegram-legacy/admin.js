import { premium } from "./navigation.js";
import { purgePlatformSessions } from './platform-sessions.js';
import { profile } from "./profiles.js";
import { db, ADMIN_TELEGRAM_USER_IDS, esc, short, button, send, edit, telegram } from "./runtime.js";
export function isAdmin(user) {
    return ADMIN_TELEGRAM_USER_IDS.has(Number(user?.telegram_user_id));
}

export function effectivePremiumFor(user, subscription) {
    const now = Date.now();
    if (user?.plan_override === "free")
        return false;
    if (user?.plan_override === "premium" &&
        (!user.plan_override_expires_at ||
            new Date(user.plan_override_expires_at).getTime() > now))
        return true;
    if (user?.referral_bonus_until &&
        new Date(user.referral_bonus_until).getTime() > now)
        return true;
    return !!subscription &&
        ["active", "trialing"].includes(String(subscription.status || "")) &&
        (!subscription.current_period_end ||
            new Date(subscription.current_period_end).getTime() > now);
}

export function adminGrantLabel(grant) {
    return grant === "7d"
        ? "7 Tage"
        : grant === "30d"
            ? "30 Tage"
            : grant === "3m"
                ? "3 Monate"
                : "lebenslang";
}

export function adminGrantExpiry(grant) {
    if (grant === "free" || grant === "life")
        return null;
    const date = new Date();
    if (grant === "7d")
        date.setUTCDate(date.getUTCDate() + 7);
    else if (grant === "30d")
        date.setUTCDate(date.getUTCDate() + 30);
    else
        date.setUTCMonth(date.getUTCMonth() + 3);
    return date.toISOString();
}

export function adminOverrideLabel(user) {
    if (user.plan_override === "free")
        return "FREE";
    if (user.plan_override !== "premium")
        return "STRIPE";
    if (!user.plan_override_expires_at)
        return "PREMIUM · LEBENSLANG";
    const until = new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        dateStyle: "short",
        timeStyle: "short",
    }).format(new Date(user.plan_override_expires_at));
    return `PREMIUM · bis ${until}`;
}

export function adminPremiumNotice(grant) {
    return grant === "life"
        ? "💎 <b>Kostenloses Premium aktiviert</b>\n\nDu hast kostenlos Premium auf Lebenszeit bekommen. Premium ist ab sofort aktiv."
        : `💎 <b>Kostenloses Premium aktiviert</b>\n\nDu hast ${adminGrantLabel(grant)} kostenlos Premium bekommen. Premium ist ab sofort aktiv.`;
}

export async function adminUsers(user, chatId, messageId) {
    if (!isAdmin(user))
        return;
    const { data: users, error } = await db
        .from("bot_users")
        .select("id,telegram_user_id,first_name,last_name,username,is_active,plan_override,plan_override_expires_at,referral_bonus_until,created_at")
        .order("created_at");
    if (error)
        throw error;
    const ids = (users || []).map((entry) => entry.id);
    let subscriptions = [];
    if (ids.length) {
        const { data, error: subscriptionError } = await db
            .from("user_subscriptions")
            .select("user_id,status,current_period_end")
            .in("user_id", ids);
        if (subscriptionError)
            throw subscriptionError;
        subscriptions = data || [];
    }
    const subscriptionByUser = new Map(subscriptions.map((entry) => [String(entry.user_id), entry]));
    const rows = (users || []).map((entry) => {
        const premium = effectivePremiumFor(entry, subscriptionByUser.get(String(entry.id)));
        const name = short([entry.first_name, entry.last_name].filter(Boolean).join(" ") ||
            entry.username ||
            String(entry.telegram_user_id), 34);
        return [
            button(`${entry.is_active ? (premium ? "💎" : "▫️") : "🚫"} ${name} · ${entry.is_active ? (premium ? "PREMIUM" : "FREE") : "GESPERRT"}`, `admin:user:${entry.id}`),
        ];
    });
    if (!rows.length)
        rows.push([button("Keine Nutzer", "noop")]);
    const blocked = (users || []).filter((entry) => !entry.is_active).length;
    const text = `🔒 <b>Admin</b>\n\nNutzer: ${users?.length || 0} · gesperrt: ${blocked}`;
    const markup = { inline_keyboard: rows };
    return messageId
        ? edit(chatId, messageId, text, markup)
        : send(chatId, text, markup);
}

export async function adminUser(user, chatId, messageId, userId) {
    if (!isAdmin(user))
        return;
    const { data: target, error } = await db
        .from("bot_users")
        .select("id,telegram_user_id,chat_id,first_name,last_name,username,is_active,plan_override,plan_override_expires_at,referral_bonus_until")
        .eq("id", userId)
        .maybeSingle();
    if (error)
        throw error;
    if (!target)
        return adminUsers(user, chatId, messageId);
    const { data: subscription, error: subscriptionError } = await db
        .from("user_subscriptions")
        .select("status,current_period_end,cancel_at_period_end")
        .eq("user_id", userId)
        .maybeSingle();
    if (subscriptionError)
        throw subscriptionError;
    const premium = effectivePremiumFor(target, subscription);
    const name = [target.first_name, target.last_name].filter(Boolean).join(" ") ||
        target.username || String(target.telegram_user_id);
    const text = `🔒 <b>Admin · Nutzer</b>\n\n` +
        `<b>${esc(name)}</b>\n` +
        `Telegram: <code>${esc(target.telegram_user_id)}</code>\n` +
        `Status: <b>${premium ? "PREMIUM" : "FREE"}</b>\n` +
        `Override: ${esc(adminOverrideLabel(target))}\n` +
        `Stripe: ${esc(String(subscription?.status || "inactive").toUpperCase())}\n` +
        `Zugriff: <b>${target.is_active ? "AKTIV" : "GESPERRT"}</b>`;
    const markup = {
        inline_keyboard: [
            [
                button("7 Tage", `admin:set:${userId}:7d`),
                button("30 Tage", `admin:set:${userId}:30d`),
            ],
            [
                button("3 Monate", `admin:set:${userId}:3m`),
                button("♾ Lebenslang", `admin:set:${userId}:life`),
            ],
            [button("Free setzen", `admin:set:${userId}:free`)],
            ...(isAdmin(target)
                ? [[button("🔒 Admin-Konto", "noop")]]
                : [
                    [button(target.is_active ? "🚫 Nutzer sperren" : "✅ Nutzer entsperren", target.is_active ? `admin:block:${userId}` : `admin:unblock:${userId}`)],
                    [button("🗑 Nutzer löschen", `admin:delete:${userId}`)],
                ]),
            [button("← Nutzer", "admin:list")],
        ],
    };
    return edit(chatId, messageId, text, markup);
}

export async function setUserBlocked(userId, blocked) {
    const { data: target, error: targetError } = await db
        .from("bot_users")
        .select("id,telegram_user_id,is_active")
        .eq("id", userId)
        .maybeSingle();
    if (targetError)
        throw targetError;
    if (!target)
        throw new Error("user unavailable");
    if (isAdmin(target))
        throw new Error("admin accounts cannot be blocked");
    const { error } = await db
        .from("bot_users")
        .update({ is_active: !blocked, updated_at: new Date().toISOString() })
        .eq("id", userId);
    if (error)
        throw error;
    if (blocked) {
        const { error: profileError } = await db
            .from("search_profiles")
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("user_id", userId);
        if (profileError)
            throw profileError;
    }
}

export async function deleteUser(userId) {
    const { data: target, error: targetError } = await db
        .from("bot_users")
        .select("id,telegram_user_id")
        .eq("id", userId)
        .maybeSingle();
    if (targetError)
        throw targetError;
    if (!target)
        return;
    if (isAdmin(target))
        throw new Error("admin accounts cannot be deleted");
    await purgePlatformSessions(userId);
    const { error } = await db.from("bot_users").delete().eq("id", userId);
    if (error)
        throw error;
}

export async function setPlanOverride(userId, grant) {
    const plan = grant === "free" ? "free" : "premium";
    const expiresAt = adminGrantExpiry(grant);
    const { data: target, error } = await db
        .from("bot_users")
        .update({
        plan_override: plan,
        plan_override_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
    })
        .eq("id", userId)
        .select("id,chat_id")
        .maybeSingle();
    if (error)
        throw error;
    if (!target)
        throw new Error("user unavailable");
    if (plan === "premium") {
        const { data: profiles, error: profileError } = await db
            .from("search_profiles")
            .select("id")
            .eq("user_id", userId);
        if (profileError)
            throw profileError;
        const profileIds = (profiles || []).map((profile) => profile.id);
        if (profileIds.length) {
            const { error: deliveryError } = await db
                .from("delivery_events")
                .update({ next_retry_at: null })
                .in("profile_id", profileIds)
                .eq("status", "pending");
            if (deliveryError)
                throw deliveryError;
        }
    }
    return target;
}


export const ANNOUNCEMENT_PROMPT = "📢 Admin · Ankündigung";

export async function createAnnouncementDraft(user, chatId, body) {
    if (!isAdmin(user))
        return;
    const text = String(body || "").trim();
    if (!text)
        return send(chatId, "Die Ankündigung darf nicht leer sein.");
    if (text.length > 3500)
        return send(chatId, "Die Ankündigung darf maximal 3.500 Zeichen lang sein.");
    const { data: announcement, error } = await db
        .from("telegram_announcements")
        .insert({ created_by: user.id, body: text })
        .select("id,body")
        .single();
    if (error)
        throw error;
    return send(chatId, `📢 <b>Ankündigung · Vorschau</b>\n\n${esc(text)}\n\nEmpfänger: alle aktiven Bot-Nutzer (Free + Premium).`, {
        inline_keyboard: [
            [button("📢 Ankündigung senden", `admin:announcement-send:${announcement.id}`)],
            [button("Abbrechen", `admin:announcement-cancel:${announcement.id}`)],
        ],
    });
}

export async function cancelAnnouncement(user, chatId, messageId, announcementId) {
    if (!isAdmin(user))
        return;
    const { data, error } = await db
        .from("telegram_announcements")
        .update({ status: "cancelled" })
        .eq("id", announcementId)
        .eq("status", "draft")
        .select("id")
        .maybeSingle();
    if (error)
        throw error;
    return edit(chatId, messageId, data ? "Ankündigung abgebrochen." : "Diese Ankündigung wurde bereits verarbeitet.", {
        inline_keyboard: [[button("← Admin", "admin:list")]],
    });
}

export async function sendAnnouncement(user, chatId, messageId, announcementId) {
    if (!isAdmin(user))
        return;
    const { data: locked, error: lockError } = await db
        .from("telegram_announcements")
        .update({ status: "sending" })
        .eq("id", announcementId)
        .eq("status", "draft")
        .select("id,body")
        .maybeSingle();
    if (lockError)
        throw lockError;
    if (!locked) {
        return edit(chatId, messageId, "Diese Ankündigung wurde bereits verarbeitet.", {
            inline_keyboard: [[button("← Admin", "admin:list")]],
        });
    }

    const { data: recipients, error: recipientError } = await db
        .from("bot_users")
        .select("chat_id")
        .eq("is_active", true)
        .not("chat_id", "is", null);
    if (recipientError)
        throw recipientError;

    let sent = 0;
    let failed = 0;
    const rows = recipients || [];
    await db.from("telegram_announcements").update({ recipient_count: rows.length }).eq("id", announcementId);

    for (const recipient of rows) {
        try {
            await telegram("sendMessage", {
                chat_id: Number(recipient.chat_id),
                text: locked.body,
                link_preview_options: { is_disabled: true },
            });
            sent += 1;
        }
        catch (error) {
            failed += 1;
            console.error("announcement_delivery", Number(recipient.chat_id), String(error));
        }
        if (rows.length > 1)
            await new Promise(resolve => setTimeout(resolve, 45));
    }

    const status = failed === 0 ? "sent" : "partial";
    const { error: finishError } = await db
        .from("telegram_announcements")
        .update({
            status,
            sent_count: sent,
            failed_count: failed,
            sent_at: new Date().toISOString(),
        })
        .eq("id", announcementId);
    if (finishError)
        throw finishError;

    return edit(chatId, messageId, `📢 <b>Ankündigung versendet</b>\n\nEmpfänger: ${rows.length}\nErfolgreich: ${sent}\nFehlgeschlagen: ${failed}`, {
        inline_keyboard: [[button("← Admin", "admin:list")]],
    });
}
