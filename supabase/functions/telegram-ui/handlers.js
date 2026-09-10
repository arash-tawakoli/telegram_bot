import { quickApplication } from './application.js';
import { dossier, dossierMessage, clearDossierInput } from './dossier.js';
import { platformSessions } from './platform-sessions.js';
import { isAdmin, adminGrantLabel, adminPremiumNotice, adminUsers, adminUser, setUserBlocked, deleteUser, setPlanOverride } from "./admin.js";
import { homeKeyboard, home, premium, saved, setPaused, toggleSave, referralPage, languagePage, settings } from "./navigation.js";
import { draftFor, validateDraft, renderTypes, renderLocation, renderBoroughs, renderNeighborhoods, renderRent, renderCustomRent, renderRooms, renderArea, renderReview, renderStep, afterSelection, persistProfile, profileLimit, draftFromProfile, startNewProfile, profileEditMenu, profile, renderStatus } from "./profiles.js";
import { db, PROPERTY_TYPES, RENT_PRESETS, ROOM_PRESETS, AREA_PRESETS, NEIGHBORHOODS_PER_PAGE, chatLanguages, button, cancelRow, backRow, secret, telegram, send, sendCelebration, edit, acknowledge, saveState, geography, HELP_TEXT } from "./runtime.js";
export async function handleMessage(message, user) {
    const chatId = Number(message.chat.id);
    if (user.onboarding_state?.dossier_input && await dossierMessage(message,user)) return;
    const text = String(message.text || "").trim();
    const [rawCommand, argument = ""] = text.split(/\s+/, 2);
    const command = rawCommand
        .toLowerCase()
        .replace(/@traumwohnunghamburgbot$/i, "");
    if (command === "/mappe") return dossier(user,message.chat);
    if (command === "/admin") {
        if (!isAdmin(user))
            return;
        return adminUsers(user, chatId);
    }
    if (command === "/start") {
        if (argument.startsWith("ref_") && user.__is_new_user === true) {
            const { error } = await db.rpc("redeem_referral_code", {
                p_referred_user_id: user.id,
                p_code: argument.slice(4),
            });
            if (error)
                console.error("referral_register", error.message);
        }
        telegram("setChatMenuButton", {
            chat_id: chatId,
            menu_button: { type: "commands" },
        }).catch(() => { });
        return home(user, chatId);
    }
    if (command === "/suche")
        return startNewProfile(user, chatId);
    if (command === "/profile")
        return profile(user, chatId);
    if (command === "/gespeichert" || command === "/saved") {
        return saved(user, chatId);
    }
    if (command === "/einstellungen" || command === "/settings") {
        return settings(user, chatId);
    }
    if (command === "/pause") {
        await setPaused(user.id, true);
        return send(chatId, "⏸ Dein Suchprofil ist pausiert.");
    }
    if (command === "/resume") {
        await setPaused(user.id, false);
        return send(chatId, "▶️ Dein Suchprofil ist wieder aktiv.");
    }
    if (command === "/status")
        return renderStatus(user, chatId);
    if (command === "/hilfe" || command === "/help") {
        return send(chatId, HELP_TEXT);
    }
    if (command === "/premium")
        return premium(user, chatId);
    const draft = draftFor(user);
    if (user.onboarding_step === "rent_custom") {
        const value = Number(text.replace(/\./g, "").replace(",", "."));
        if (!Number.isFinite(value) || value < 100 || value > 5000) {
            return send(chatId, "Bitte einen Betrag zwischen 100 und 5.000 eingeben.");
        }
        draft.max_warm_rent = value;
        if (draft.profile_edit) {
            const slot = draft.profile_slot;
            delete draft.profile_edit;
            delete draft.edit_return;
            await persistProfile(user, draft);
            return profile(user, chatId, undefined, slot);
        }
        if (draft.edit_return) {
            delete draft.edit_return;
            return renderReview(user, chatId, message.message_id, draft);
        }
        await saveState(user.id, "rooms", draft);
        return send(chatId, "4/5 · <b>Mindestens wie viele Zimmer?</b>", {
            inline_keyboard: [
                [button("1+", "rooms:1"), button("2+", "rooms:2")],
                [button("3+", "rooms:3"), button("4+", "rooms:4")],
                backRow("rent"),
                cancelRow(),
            ],
        });
    }
    return send(chatId, "Bitte verwende die Befehle oder Buttons. Mit /hilfe siehst du alle Befehle.");
}

export async function handleCallback(query, user) {
    const chatId = Number(query.message?.chat.id);
    const messageId = Number(query.message?.message_id);
    const data = String(query.data || "");
    if (!chatId || !messageId)
        return acknowledge(query.id);
    if (data.startsWith("admin:")) {
        if (!isAdmin(user))
            return acknowledge(query.id);
        if (data === "admin:list") {
            EdgeRuntime.waitUntil(acknowledge(query.id));
            return adminUsers(user, chatId, messageId);
        }
        if (data.startsWith("admin:user:")) {
            EdgeRuntime.waitUntil(acknowledge(query.id));
            return adminUser(user, chatId, messageId, data.slice("admin:user:".length));
        }
        if (data.startsWith("admin:block:")) {
            const userId = data.slice("admin:block:".length);
            try {
                await setUserBlocked(userId, true);
                await acknowledge(query.id, "Nutzer gesperrt");
            }
            catch (error) {
                await acknowledge(query.id, String(error).includes("admin accounts") ? "Admin-Konto geschützt" : "Sperren fehlgeschlagen");
            }
            return adminUser(user, chatId, messageId, userId);
        }
        if (data.startsWith("admin:unblock:")) {
            const userId = data.slice("admin:unblock:".length);
            try {
                await setUserBlocked(userId, false);
                await acknowledge(query.id, "Nutzer entsperrt");
            }
            catch (error) {
                await acknowledge(query.id, String(error).includes("admin accounts") ? "Admin-Konto geschützt" : "Entsperren fehlgeschlagen");
            }
            return adminUser(user, chatId, messageId, userId);
        }
        if (data.startsWith("admin:delete-confirm:")) {
            const userId = data.slice("admin:delete-confirm:".length);
            try {
                await deleteUser(userId);
                await acknowledge(query.id, "Nutzer gelöscht");
            }
            catch (error) {
                await acknowledge(query.id, String(error).includes("admin accounts") ? "Admin-Konto geschützt" : "Löschen fehlgeschlagen");
            }
            return adminUsers(user, chatId, messageId);
        }
        if (data.startsWith("admin:delete:")) {
            const userId = data.slice("admin:delete:".length);
            EdgeRuntime.waitUntil(acknowledge(query.id));
            return edit(chatId, messageId, "🗑 <b>Nutzer wirklich löschen?</b>\n\nSuchprofile, gespeicherte Inserate, Referral- und Abo-Zuordnungen werden dauerhaft gelöscht.", { inline_keyboard: [
                    [button("🗑 Ja, endgültig löschen", `admin:delete-confirm:${userId}`)],
                    [button("← Abbrechen", `admin:user:${userId}`)],
                ] });
        }
        if (data.startsWith("admin:set:")) {
            const parts = data.split(":");
            const userId = parts[2];
            const grant = parts[3];
            if (!userId || !["free", "7d", "30d", "3m", "life"].includes(grant)) {
                return acknowledge(query.id);
            }
            const target = await setPlanOverride(userId, grant);
            let noticeFailed = false;
            if (grant !== "free") {
                try {
                    await send(Number(target.chat_id), adminPremiumNotice(grant));
                }
                catch (error) {
                    noticeFailed = true;
                    console.error("admin_premium_notice", error);
                }
            }
            await acknowledge(query.id, grant === "free"
                ? "Free gesetzt"
                : noticeFailed
                    ? "Premium gesetzt · Nachricht fehlgeschlagen"
                    : `${adminGrantLabel(grant)} Premium gesetzt`);
            return adminUser(user, chatId, messageId, userId);
        }
        return acknowledge(query.id);
    }
    if (data.startsWith("save:")) {
        const savedState = await toggleSave(user, data.slice(5));
        if (savedState === null) {
            EdgeRuntime.waitUntil(acknowledge(query.id));
            return premium(user, chatId, messageId);
        }
        return acknowledge(query.id, savedState ? "⭐️ Gespeichert" : "Entfernt");
    }
    EdgeRuntime.waitUntil(acknowledge(query.id));
    if (user.onboarding_state?.dossier_input) await clearDossierInput(user);
    if (data === 'dossier' || data.startsWith('dossier:')) return dossier(user,query.message.chat,query.message?.photo?undefined:messageId,data);
    if (data === 'platforms' || data.startsWith('platforms:')) return platformSessions(user,query.message.chat,query.message?.photo?undefined:messageId,data);
    if (data.startsWith('apply:')) return quickApplication(user, query);
    if (data === "noop")
        return;
    if (data === "cancel") {
        await saveState(user.id, null, {});
        return home({ ...user, onboarding_step: null, onboarding_state: {} }, chatId, messageId);
    }
    if (data === "home") {
        if (query.message?.photo) {
            await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => { });
            return home(user, chatId);
        }
        return home(user, chatId, messageId);
    }
    if (data === "new")
        return startNewProfile(user, chatId, messageId);
    if (data === "draft") {
        const draft = draftFor(user);
        const step = String(user.onboarding_step || "types");
        return renderStep(user, chatId, messageId, draft, [
            "types",
            "location",
            "boroughs",
            "neighborhoods",
            "rent",
            "rent_custom",
            "rooms",
            "area",
            "review",
        ].includes(step)
            ? step
            : "types");
    }
    if (data === "profile" || data === "profiles")
        return profile(user, chatId, messageId);
    if (data === "p:view:1")
        return profile(user, chatId, messageId, 1);
    if (data.startsWith("profile:view:"))
        return profile(user, chatId, messageId, Number(data.split(":")[2]));
    if (data.startsWith("profile:edit-field:")) {
        const parts = data.split(":");
        const slot = Number(parts[2]);
        const field = parts[3];
        if (!Number.isInteger(slot) || slot < 1 || slot > profileLimit(user))
            return;
        const { data: current, error } = await db
            .from("search_profiles")
            .select("*")
            .eq("user_id", user.id)
            .eq("profile_slot", slot)
            .maybeSingle();
        if (error)
            throw error;
        if (!current)
            return profile(user, chatId, messageId);
        const draft = await draftFromProfile(current);
        if (field === "types")
            return renderTypes(user, chatId, messageId, draft);
        if (field === "location")
            return renderLocation(user, chatId, messageId, draft);
        if (field === "rent")
            return renderRent(user, chatId, messageId, draft);
        if (field === "rooms")
            return renderRooms(user, chatId, messageId, draft);
        if (field === "area")
            return renderArea(user, chatId, messageId, draft);
        return profileEditMenu(user, chatId, messageId, slot);
    }
    if (data.startsWith("profile:edit:")) {
        return profileEditMenu(user, chatId, messageId, Number(data.split(":")[2]));
    }
    if (data.startsWith("profile:delete-confirm:")) {
        const slot = Number(data.split(":")[2]);
        if (!Number.isInteger(slot) || slot < 1 || slot > profileLimit(user))
            return;
        const { error } = await db
            .from("search_profiles")
            .delete()
            .eq("user_id", user.id)
            .eq("profile_slot", slot);
        if (error)
            throw error;
        return profile(user, chatId, messageId);
    }
    if (data.startsWith("profile:delete:")) {
        const slot = Number(data.split(":")[2]);
        if (!Number.isInteger(slot) || slot < 1 || slot > profileLimit(user))
            return;
        return edit(chatId, messageId, "🗑 <b>Suchprofil löschen?</b>\n\nDiese Aktion kann nicht rückgängig gemacht werden.", { inline_keyboard: [
                [button("🗑 Ja, löschen", `profile:delete-confirm:${slot}`)],
                [button("← Abbrechen", `profile:view:${slot}`)],
            ] });
    }
    if (data.startsWith("profile:pause:") || data.startsWith("profile:resume:")) {
        const slot = Number(data.split(":")[2]);
        await setPaused(user.id, data.startsWith("profile:pause:"), slot);
        return profile(user, chatId, messageId, slot);
    }
    if (data === "saved")
        return saved(user, chatId, messageId, 0);
    if (data.startsWith("saved:")) {
        return saved(user, chatId, messageId, Number(data.slice(6)) || 0);
    }
    if (data === "settings")
        return settings(user, chatId, messageId);
    if (data === "referral")
        return referralPage(user, chatId, messageId);
    if (data === "language")
        return languagePage(user, chatId, messageId);
    if (data.startsWith("lang:")) {
        const code = data.slice(5);
        if (!["de", "en", "ckb", "ku", "prs", "fa", "ru", "tr", "ar"].includes(code))
            return;
        const { error } = await db.from("bot_users").update({ ui_language: code, updated_at: new Date().toISOString() }).eq("id", user.id);
        if (error)
            throw error;
        chatLanguages.set(chatId, code);
        return settings({ ...user, ui_language: code }, chatId, messageId);
    }
    if (data === "help") {
        return edit(chatId, messageId, HELP_TEXT, {
            inline_keyboard: [[button("← Zurück", "home")]],
        });
    }
    if (data === "premium") {
        if (query.message?.photo)
            return premium(user, chatId, messageId, true);
        await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => { });
        return premium(user, chatId);
    }
    if (data === "portal") {
        if (query.message?.photo)
            await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => { });
        const url = await secret("stripe_portal_url").catch(() => null);
        const valid = url && /^https:\/\/billing\.stripe\.com\//.test(url);
        return edit(chatId, messageId, valid
            ? "💳 <b>Abo verwalten</b>"
            : "💳 Das Stripe Customer Portal ist aktuell noch nicht konfiguriert.", {
            inline_keyboard: [
                ...(valid ? [[{ text: "Stripe öffnen", url }]] : []),
                [button("← Premium", "premium")],
            ],
        });
    }
    if (data === "pause") {
        await setPaused(user.id, true);
        return edit(chatId, messageId, "⏸ Dein Suchprofil ist pausiert.", homeKeyboard(user));
    }
    if (data === "resume") {
        await setPaused(user.id, false);
        return edit(chatId, messageId, "▶️ Dein Suchprofil ist wieder aktiv.", homeKeyboard(user));
    }
    if (data === "status")
        return renderStatus(user, chatId, messageId);
    const draft = draftFor(user);
    if (data === "types")
        return renderTypes(user, chatId, messageId, draft);
    if (data === "location")
        return renderLocation(user, chatId, messageId, draft);
    if (data === "boroughs") {
        return renderBoroughs(user, chatId, messageId, draft);
    }
    if (data === "neighborhoods") {
        return renderNeighborhoods(user, chatId, messageId, draft);
    }
    if (data === "rent")
        return renderRent(user, chatId, messageId, draft);
    if (data === "rooms")
        return renderRooms(user, chatId, messageId, draft);
    if (data === "area")
        return renderArea(user, chatId, messageId, draft);
    if (data.startsWith("edit:")) {
        draft.edit_return = true;
        const step = data.slice(5);
        if (step === "types")
            return renderTypes(user, chatId, messageId, draft);
        if (step === "location") {
            return renderLocation(user, chatId, messageId, draft);
        }
        if (step === "rent")
            return renderRent(user, chatId, messageId, draft);
        if (step === "rooms")
            return renderRooms(user, chatId, messageId, draft);
        if (step === "area")
            return renderArea(user, chatId, messageId, draft);
    }
    if (data.startsWith("type:")) {
        const value = data.slice(5);
        if (value === "all")
            draft.property_types = [...PROPERTY_TYPES];
        else if (value === "clear")
            draft.property_types = [];
        else if (value === "done") {
            if (!draft.property_types.length) {
                return renderTypes(user, chatId, messageId, draft);
            }
            return afterSelection(user, chatId, messageId, draft, "location");
        }
        else if (PROPERTY_TYPES.includes(value)) {
            const type = value;
            draft.property_types = draft.property_types.includes(type)
                ? draft.property_types.filter((entry) => entry !== type)
                : [...draft.property_types, type];
        }
        return renderTypes(user, chatId, messageId, draft);
    }
    if (data.startsWith("loc:")) {
        const value = data.slice(4);
        if (value === "all") {
            draft.location_mode = "all_hamburg";
            draft.borough_ids = [];
            draft.neighborhood_ids = [];
            return afterSelection(user, chatId, messageId, draft, "rent");
        }
        if (value === "boroughs") {
            draft.location_mode = "boroughs";
            draft.neighborhood_ids = [];
            return renderBoroughs(user, chatId, messageId, draft);
        }
        if (value === "neighborhoods") {
            draft.location_mode = "neighborhoods";
            draft.borough_ids = [];
            return renderNeighborhoods(user, chatId, messageId, draft);
        }
    }
    if (data.startsWith("borough:")) {
        const value = data.slice(8);
        const geo = await geography();
        if (value === "all") {
            draft.borough_ids = geo.boroughs.map((entry) => entry.id);
        }
        else if (value === "clear") {
            draft.borough_ids = [];
        }
        else if (value === "done") {
            if (!draft.borough_ids.length) {
                return renderBoroughs(user, chatId, messageId, draft);
            }
            return afterSelection(user, chatId, messageId, draft, "rent");
        }
        else {
            const id = Number(value);
            if (geo.boroughs.some((entry) => entry.id === id)) {
                draft.borough_ids = draft.borough_ids.includes(id)
                    ? draft.borough_ids.filter((entry) => entry !== id)
                    : [...draft.borough_ids, id];
            }
        }
        return renderBoroughs(user, chatId, messageId, draft);
    }
    if (data.startsWith("neighborhood:")) {
        const value = data.slice(13);
        const geo = await geography();
        if (value === "all") {
            draft.neighborhood_ids = geo.neighborhoods.map((entry) => entry.id);
        }
        else if (value === "clear") {
            draft.neighborhood_ids = [];
        }
        else if (value === "prev") {
            draft.neighborhood_page = Math.max(0, draft.neighborhood_page - 1);
        }
        else if (value === "next") {
            const pages = Math.max(1, Math.ceil(geo.neighborhoods.length / NEIGHBORHOODS_PER_PAGE));
            draft.neighborhood_page = Math.min(pages - 1, draft.neighborhood_page + 1);
        }
        else if (value === "done") {
            if (!draft.neighborhood_ids.length) {
                return renderNeighborhoods(user, chatId, messageId, draft);
            }
            return afterSelection(user, chatId, messageId, draft, "rent");
        }
        else {
            const id = Number(value);
            if (geo.neighborhoods.some((entry) => entry.id === id)) {
                draft.neighborhood_ids = draft.neighborhood_ids.includes(id)
                    ? draft.neighborhood_ids.filter((entry) => entry !== id)
                    : [...draft.neighborhood_ids, id];
            }
        }
        return renderNeighborhoods(user, chatId, messageId, draft);
    }
    if (data.startsWith("rent:")) {
        const value = data.slice(5);
        if (value === "custom") {
            return renderCustomRent(user, chatId, messageId, draft);
        }
        const amount = Number(value);
        if (RENT_PRESETS.has(amount)) {
            draft.max_warm_rent = amount;
            return afterSelection(user, chatId, messageId, draft, "rooms");
        }
        return renderRent(user, chatId, messageId, draft);
    }
    if (data.startsWith("rooms:")) {
        const rooms = Number(data.slice(6));
        if (ROOM_PRESETS.has(rooms)) {
            draft.min_rooms = rooms;
            return afterSelection(user, chatId, messageId, draft, "area");
        }
        return renderRooms(user, chatId, messageId, draft);
    }
    if (data.startsWith("area:")) {
        const area = Number(data.slice(5));
        if (AREA_PRESETS.has(area)) {
            draft.min_area_sqm = area;
            return afterSelection(user, chatId, messageId, draft, "review");
        }
        return renderArea(user, chatId, messageId, draft);
    }
    if (data === "profile:save" || data === "s:save") {
        const issue = validateDraft(draft);
        if (issue)
            return renderStep(user, chatId, messageId, draft, issue);
        const referralReward = await persistProfile(user, draft);
        const result = await edit(chatId, messageId, "✅ Deine Suche ist aktiv. Neue passende Inserate werden automatisch zugestellt.", homeKeyboard({ ...user, onboarding_step: null }));
        if (referralReward?.status === "rewarded") {
            await sendCelebration(chatId, "💎 <b>30 Tage Premium kostenlos aktiviert</b>\n\n" +
                "Dein erstes Suchprofil ist erstellt und dir wurden 30 Tage Premium kostenlos gutgeschrieben.\n\n" +
                "Viel Erfolg und viel Spaß bei deiner Wohnungssuche! 🏠");
        }
        return result;
    }
}
