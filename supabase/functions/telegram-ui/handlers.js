import { platformSessions, handleAutoApplyMessage } from './platform-sessions.js';
import { isAdmin, adminGrantLabel, adminPremiumNotice, adminUsers, adminUser, setUserBlocked, deleteUser, setPlanOverride, ANNOUNCEMENT_PROMPT, createAnnouncementDraft, cancelAnnouncement, sendAnnouncement } from "./admin.js";
import { homeKeyboard, home, premium, saved, setPaused, toggleSave, referralPage, languagePage, settings } from "./navigation.js";
import { draftFor, validateDraft, renderTypes, renderLocation, renderBoroughs, renderNeighborhoods, renderSchleswigHolsteinAreas, renderRent, renderCustomRent, renderRooms, renderArea, renderReview, renderStep, afterSelection, persistProfile, profileLimit, draftFromProfile, startNewProfile, profileEditMenu, profile, renderStatus, nextSizeStep } from "./profiles.js";
import { db, PREMIUM_LINK, PROPERTY_TYPES, RENT_PRESETS, ROOM_PRESETS, AREA_PRESETS, NEIGHBORHOODS_PER_PAGE, chatLanguages, button, cancelRow, backRow, secret, telegram, send, sendCelebration, edit, acknowledge, saveState, geography, HELP_TEXT } from "./runtime.js";

const PUBLIC_COMMANDS = [
    { command: "start", description: "Startmenü" },
    { command: "suche", description: "Suchprofil erstellen" },
    { command: "profile", description: "Suchprofile anzeigen" },
    { command: "gespeichert", description: "Gespeicherte Inserate" },
    { command: "einstellungen", description: "Einstellungen" },
    { command: "pause", description: "Suche pausieren" },
    { command: "resume", description: "Suche fortsetzen" },
    { command: "status", description: "Systemstatus" },
    { command: "premium", description: "Premium anzeigen" },
    { command: "hilfe", description: "Hilfe" },
];

const ADMIN_COMMANDS = [
    ...PUBLIC_COMMANDS,
    { command: "admin", description: "Adminbereich" },
    { command: "announcement", description: "Ankündigung senden" },
    { command: "token", description: "Zentralen ImmoScout24-Zugang verbinden" },
];

async function syncTelegramCommands(user, chatId) {
    const admin = isAdmin(user);
    const requests = [
        telegram("setMyCommands", {
            commands: PUBLIC_COMMANDS,
            scope: { type: "default" },
        }),
        telegram("setMyCommands", {
            commands: PUBLIC_COMMANDS,
            scope: { type: "default" },
            language_code: "de",
        }),
        telegram("setMyCommands", {
            commands: PUBLIC_COMMANDS,
            scope: { type: "all_private_chats" },
        }),
        telegram("setMyCommands", {
            commands: PUBLIC_COMMANDS,
            scope: { type: "all_private_chats" },
            language_code: "de",
        }),
        telegram("setChatMenuButton", {
            chat_id: chatId,
            menu_button: { type: "commands" },
        }),
    ];
    if (admin) {
        requests.push(
            telegram("setMyCommands", {
                commands: ADMIN_COMMANDS,
                scope: { type: "chat", chat_id: chatId },
            }),
            telegram("setMyCommands", {
                commands: ADMIN_COMMANDS,
                scope: { type: "chat", chat_id: chatId },
                language_code: "de",
            }),
        );
    }
    else {
        requests.push(
            telegram("deleteMyCommands", {
                scope: { type: "chat", chat_id: chatId },
            }),
            telegram("deleteMyCommands", {
                scope: { type: "chat", chat_id: chatId },
                language_code: "de",
            }),
        );
    }
    const results = await Promise.allSettled(requests);
    for (const result of results) {
        if (result.status === "rejected")
            console.error("telegram_command_sync", String(result.reason));
    }
}
function secureToken(bytes = 32) {
    const values = crypto.getRandomValues(new Uint8Array(bytes));
    let raw = "";
    for (const value of values)
        raw += String.fromCharCode(value);
    return btoa(raw).split("+").join("-").split("/").join("_").replace(/=+$/g, "");
}

const CENTRAL_IMMOSCOUT_WORKER = "https://immoscout-central-token-staging.arash-ce5.workers.dev";
async function centralImmoScoutApi(path, method = "GET", body = undefined) {
    const apiSecret = await secret("immoscout_central_cloudflare_api_secret");
    const response = await fetch(`${CENTRAL_IMMOSCOUT_WORKER}${path}`, {
        method,
        headers: {
            authorization: `Bearer ${apiSecret}`,
            accept: "application/json",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data)
        throw new Error(data?.error || "central_immoscout_unavailable");
    return data;
}

async function centralImmoScoutTokenStatus(chatId) {
    const status = await centralImmoScoutApi("/internal/status");
    if (status?.configured !== true) {
        return send(chatId, "Noch kein zentraler ImmoScout24-Zugang gespeichert. Starte mit /token.");
    }
    const enabled = status.enabled === true;
    const verified = status.last_verified_at ? new Date(status.last_verified_at).toLocaleString("de-DE") : "Noch nicht geprüft";
    return send(chatId,
        `<b>Zentraler ImmoScout24-Zugang</b>\nKonto: <b>${status.account_hint || "—"}</b>\nVerbindung: <b>${status.status || "unbekannt"}</b>\nAuto-Bewerbung: <b>${enabled ? "aktiv" : "deaktiviert"}</b>\nZuletzt geprüft: ${verified}\n\nAktivieren: /token aktivieren\nDeaktivieren: /token deaktivieren`);
}

async function setCentralImmoScoutEnabled(user, chatId, enabled) {
    const result = await centralImmoScoutApi("/internal/enable", "POST", {
        enabled,
        admin_telegram_id: String(user.telegram_user_id),
    });
    if (result?.enabled !== enabled)
        throw new Error("central_credential_status_update_failed");
    return send(chatId, enabled
        ? "✅ Zentraler ImmoScout24-Zugang aktiviert. Neue freigegebene Bewerbungen können jetzt über das NexaLabs-Konto versendet werden."
        : "⏸ Zentraler ImmoScout24-Zugang deaktiviert. Der Bot verwendet wieder verbundene Teilnehmerkonten, sofern vorhanden.");
}

async function startCentralImmoScoutToken(user, chatId) {
    const flow = await centralImmoScoutApi("/internal/start", "POST", {
        admin_telegram_id: String(user.telegram_user_id),
        user_id: String(user.id),
    });
    const status = flow.current_status || await centralImmoScoutApi("/internal/status");
    const current = status.configured === true && status.status === "connected"
        ? `Der zentrale Zugang ist bereits verbunden. Auto-Bewerbung ist derzeit ${status.enabled === true ? "aktiv" : "deaktiviert"}. Nach erfolgreicher erneuter Anmeldung wird der gespeicherte Token ersetzt.`
        : "Es ist noch kein zentraler ImmoScout24-Zugang gespeichert.";
    return send(chatId,
        `🔐 <b>Zentralen ImmoScout24-Zugang verbinden</b>\n\n${current}\n\nMelde dich im nächsten Schritt mit <b>arash@nexalabs.de</b> an. Die OAuth- und MFA-Verarbeitung sowie die verschlüsselte Token-Speicherung laufen über Cloudflare. Das Passwort wird nicht gespeichert.\n\nDer Versand bleibt zunächst deaktiviert. Nach dem Verbindungstest kannst du ihn mit /token aktivieren einschalten.\n\nDer Link ist 15 Minuten gültig.`,
        { inline_keyboard: [[{ text: "🌐 Mit ImmoScout24 anmelden", url: flow.url }]] });
}

export async function handleMessage(message, user) {
    const chatId = Number(message.chat.id);
    const text = String(message.text || "").trim();
    const [rawCommand, argument = ""] = text.split(/\s+/, 2);
    const command = rawCommand
        .toLowerCase()
        .replace(/@traumwohnunghamburgbot$/i, "");
    if (command === "/admin") {
        if (!isAdmin(user))
            return;
        return adminUsers(user, chatId);
    }
    if (command === "/token") {
        if (!isAdmin(user))
            return;
        const mode = argument.trim().toLowerCase();
        if (mode === "status")
            return centralImmoScoutTokenStatus(chatId);
        if (mode === "aktivieren" || mode === "enable")
            return setCentralImmoScoutEnabled(user, chatId, true);
        if (mode === "deaktivieren" || mode === "disable")
            return setCentralImmoScoutEnabled(user, chatId, false);
        return startCentralImmoScoutToken(user, chatId);
    }
    if (command === "/announcement") {
        if (!isAdmin(user))
            return;
        return send(chatId, `${ANNOUNCEMENT_PROMPT}\n\nAntworte auf diese Nachricht mit dem Text, den alle aktiven Bot-Nutzer erhalten sollen.\n\nMaximal 3.500 Zeichen.`, {
            force_reply: true,
            selective: true,
            input_field_placeholder: "Ankündigung schreiben"
        });
    }
    if (command === "/start" || command === "/commands") {
        if (command === "/start" && argument.startsWith("ref_") && user.__is_new_user === true) {
            const { error } = await db.rpc("redeem_referral_code", {
                p_referred_user_id: user.id,
                p_code: argument.slice(4),
            });
            if (error)
                console.error("referral_register", error.message);
        }
        await syncTelegramCommands(user, chatId);
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
    const repliedText = String(message.reply_to_message?.text || "");
    if (isAdmin(user) && repliedText.startsWith(ANNOUNCEMENT_PROMPT)) {
        return createAnnouncementDraft(user, chatId, text);
    }
    const autoApplyMessage = await handleAutoApplyMessage(user, message);
    if (autoApplyMessage)
        return autoApplyMessage;
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
            return renderReview(user, chatId, undefined, draft);
        }
        await saveState(user.id, "rooms", draft, user.request_update_id, user.request_attempt);
        return send(chatId, "🚪 <b>Wie viele Zimmer brauchst du mindestens?</b>", {
            inline_keyboard: [
                [button("1+", "rooms:1"), button("2+", "rooms:2")],
                [button("3+", "rooms:3"), button("4+", "rooms:4")],
                backRow("rent"), cancelRow(),
            ],
        });
    }
    return send(chatId, "Bitte verwende die Befehle oder Buttons. Mit /hilfe siehst du alle Befehle.");
}

export async function handleCallback(query, user) {
    const chatId = Number(query.message?.chat.id);
    const messageId = Number(query.message?.message_id);
    const data = String(query.data || "");
    const ack = (text) => user.__callback_acked ? Promise.resolve() : acknowledge(query.id, text);
    if (!chatId || !messageId)
        return ack();
    if (data.startsWith("admin:")) {
        if (!isAdmin(user))
            return ack();
        if (data === "admin:list") {
            EdgeRuntime.waitUntil(ack());
            return adminUsers(user, chatId, messageId);
        }
        if (data.startsWith("admin:announcement-send:")) {
            const announcementId = data.slice("admin:announcement-send:".length);
            await ack("Ankündigung wird gesendet");
            return sendAnnouncement(user, chatId, messageId, announcementId);
        }
        if (data.startsWith("admin:announcement-cancel:")) {
            const announcementId = data.slice("admin:announcement-cancel:".length);
            await ack("Abgebrochen");
            return cancelAnnouncement(user, chatId, messageId, announcementId);
        }
        if (data.startsWith("admin:user:")) {
            EdgeRuntime.waitUntil(ack());
            return adminUser(user, chatId, messageId, data.slice("admin:user:".length));
        }
        if (data.startsWith("admin:block:")) {
            const userId = data.slice("admin:block:".length);
            try {
                await setUserBlocked(userId, true);
                await ack("Nutzer gesperrt");
            }
            catch (error) {
                await ack(String(error).includes("admin accounts") ? "Admin-Konto geschützt" : "Sperren fehlgeschlagen");
            }
            return adminUser(user, chatId, messageId, userId);
        }
        if (data.startsWith("admin:unblock:")) {
            const userId = data.slice("admin:unblock:".length);
            try {
                await setUserBlocked(userId, false);
                await ack("Nutzer entsperrt");
            }
            catch (error) {
                await ack(String(error).includes("admin accounts") ? "Admin-Konto geschützt" : "Entsperren fehlgeschlagen");
            }
            return adminUser(user, chatId, messageId, userId);
        }
        if (data.startsWith("admin:delete-confirm:")) {
            const userId = data.slice("admin:delete-confirm:".length);
            try {
                await deleteUser(userId);
                await ack("Nutzer gelöscht");
            }
            catch (error) {
                await ack(String(error).includes("admin accounts") ? "Admin-Konto geschützt" : "Löschen fehlgeschlagen");
            }
            return adminUsers(user, chatId, messageId);
        }
        if (data.startsWith("admin:delete:")) {
            const userId = data.slice("admin:delete:".length);
            EdgeRuntime.waitUntil(ack());
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
                return ack();
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
            await ack(grant === "free"
                ? "Free gesetzt"
                : noticeFailed
                    ? "Premium gesetzt · Nachricht fehlgeschlagen"
                    : `${adminGrantLabel(grant)} Premium gesetzt`);
            return adminUser(user, chatId, messageId, userId);
        }
        return ack();
    }
    if (data.startsWith("save:")) {
        const savedState = await toggleSave(user, data.slice(5));
        if (savedState !== null && user.__callback_acked) {
            try {
                const markup = structuredClone(query.message?.reply_markup || {});
                let changed = false;
                for (const row of markup.inline_keyboard || []) for (const item of row || []) {
                    if (item?.callback_data === data) {
                        item.text = savedState ? "⭐ Gespeichert" : "⭐ Speichern";
                        changed = true;
                    }
                }
                if (changed) await telegram("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: markup });
            } catch (error) { console.error("save_button_refresh", String(error)); }
        }
        if (savedState === null) {
            EdgeRuntime.waitUntil(ack());
            return premium(user, chatId, messageId);
        }
        return ack(savedState ? "⭐ Gespeichert" : "Entfernt");
    }
    EdgeRuntime.waitUntil(ack());
    if (data === 'platforms' || data.startsWith('platforms:')) {
        if (!user.is_premium) {
            const text = "🔒 <b>Automatische Bewerbung</b>\n\n" +
                "Die automatische Bewerbung ist mit Premium verfügbar.\n\n" +
                "Mit Premium können passende Bewerbungen automatisch über deine verbundenen Plattformen versendet werden.\n\n" +
                "Nach dem Upgrade kannst du die Einrichtung hier fortsetzen.";
            const markup = {
                inline_keyboard: [
                    [{ text: "💎 Jetzt abonnieren", url: `${PREMIUM_LINK}?client_reference_id=${encodeURIComponent(user.id)}` }],
                    [button("← Zurück", "home")],
                ],
            };
            return query.message?.photo
                ? send(chatId, text, markup)
                : edit(chatId, messageId, text, markup);
        }
        return platformSessions(user,query.message.chat,query.message?.photo?undefined:messageId,data);
    }
    if (data === "noop")
        return;
    if (data === "cancel") {
        await saveState(user.id, null, user.onboarding_state || {}, user.request_update_id, user.request_attempt);
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
            "shareas",
            "rent",
            "rent_custom",
            "roomarea",
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
        if (field === "roomarea")
            return renderRooms(user, chatId, messageId, draft);
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
        if (query.message?.photo) {
            await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => { });
            return premium(user, chatId);
        }
        return premium(user, chatId, messageId);
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
                ...(valid ? [[{ text: "💳 Abo verwalten", url }]] : []),
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
    if (data === "roomarea")
        return renderRooms(user, chatId, messageId, draft);
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
        if (step === "roomarea")
            return renderRooms(user, chatId, messageId, draft);
        if (step === "rooms")
            return renderRooms(user, chatId, messageId, draft);
        if (step === "area")
            return renderArea(user, chatId, messageId, draft);
    }
    if (data.startsWith("type:")) {
        const value = data.slice(5);
        if (!PROPERTY_TYPES.includes(value)) {
            return renderTypes(user, chatId, messageId, draft);
        }
        const hadExistingLocation = ["all_hamburg", "boroughs", "neighborhoods", "all_schleswig_holstein", "schleswig_holstein_areas"].includes(String(draft.location_mode || ""));
        const categoryEdit = draft.profile_edit === true || draft.edit_return === true;
        draft.property_types = [value];
        draft.min_rooms = null;
        draft.min_area_sqm = null;
        draft.min_room_area_sqm = null;
        if (categoryEdit) {
            delete draft.profile_edit;
            delete draft.edit_return;
        }
        return categoryEdit && hadExistingLocation
            ? renderRent(user, chatId, messageId, draft)
            : renderLocation(user, chatId, messageId, draft);
    }
    if (data.startsWith("loc:")) {
        const value = data.slice(4);
        if (value === "all") {
            draft.location_mode = "all_hamburg";
            draft.borough_ids = [];
            draft.neighborhood_ids = [];
            draft.location_area_codes = [];
            draft.area_page = 0;
            return afterSelection(user, chatId, messageId, draft, "rent");
        }
        if (value === "boroughs") {
            draft.location_mode = "boroughs";
            draft.neighborhood_ids = [];
            draft.location_area_codes = [];
            draft.area_page = 0;
            return renderBoroughs(user, chatId, messageId, draft);
        }
        if (value === "neighborhoods") {
            draft.location_mode = "neighborhoods";
            draft.borough_ids = [];
            draft.location_area_codes = [];
            draft.area_page = 0;
            return renderNeighborhoods(user, chatId, messageId, draft);
        }
        if (value === "all_sh") {
            draft.location_mode = "all_schleswig_holstein";
            draft.borough_ids = [];
            draft.neighborhood_ids = [];
            draft.location_area_codes = [];
            draft.area_page = 0;
            return afterSelection(user, chatId, messageId, draft, "rent");
        }
        if (value === "counties_sh" || value === "municipalities_sh" || value === "areas_sh") {
            draft.location_mode = "schleswig_holstein_areas";
            draft.borough_ids = [];
            draft.neighborhood_ids = [];
            draft.location_area_codes = [];
            draft.area_page = 0;
            if (value === "counties_sh") draft.sh_area_level = "counties";
            else if (value === "municipalities_sh") draft.sh_area_level = "municipalities";
            else if (!["counties", "municipalities", "mixed"].includes(String(draft.sh_area_level || ""))) draft.sh_area_level = "counties";
            return renderSchleswigHolsteinAreas(user, chatId, messageId, draft);
        }
    }
    if (data.startsWith("sharea:")) {
        const value = data.slice(7);
        const geo = await geography();
        const allAreas = (geo.schleswigHolsteinAreas || []).filter((entry) => entry.area_type !== "state");
        const level = ["counties", "municipalities", "mixed"].includes(String(draft.sh_area_level || ""))
            ? String(draft.sh_area_level)
            : "counties";
        const areas = level === "counties"
            ? allAreas.filter((entry) => ["county", "independent_city"].includes(entry.area_type))
            : level === "municipalities"
                ? allAreas.filter((entry) => entry.area_type === "municipality")
                : allAreas;
        const selected = new Set((draft.location_area_codes || []).map(String));
        if (value === "back") {
            return renderLocation(user, chatId, messageId, draft);
        }
        if (value === "prev" || value === "next") {
            const pages = Math.max(1, Math.ceil(areas.length / 20));
            draft.area_page = Math.max(0, Math.min(pages - 1, Number(draft.area_page || 0) + (value === "next" ? 1 : -1)));
            return renderSchleswigHolsteinAreas(user, chatId, messageId, draft);
        }
        if (value === "clear") {
            draft.location_area_codes = [];
            draft.area_page = 0;
            return renderSchleswigHolsteinAreas(user, chatId, messageId, draft);
        }
        if (value === "all") {
            selected.clear();
            for (const area of areas) selected.add(String(area.area_code));
            draft.location_area_codes = [...selected];
            draft.location_mode = "schleswig_holstein_areas";
            return renderSchleswigHolsteinAreas(user, chatId, messageId, draft);
        }
        if (value === "done") {
            if (!selected.size)
                return renderSchleswigHolsteinAreas(user, chatId, messageId, draft);
            return afterSelection(user, chatId, messageId, draft, "rent");
        }
        const area = allAreas.find((entry) => String(entry.area_code) === value);
        if (!area)
            return renderSchleswigHolsteinAreas(user, chatId, messageId, draft);
        if (area.area_type === "county" || area.area_type === "independent_city") {
            if (selected.has(value)) {
                selected.delete(value);
            }
            else {
                for (const candidate of allAreas) {
                    if (String(candidate.parent_code) === value)
                        selected.delete(String(candidate.area_code));
                }
                selected.add(value);
            }
        }
        else if (area.area_type === "municipality") {
            const parentCode = String(area.parent_code);
            if (selected.has(parentCode)) {
                // Convert a selected parent to its municipalities except the clicked one.
                selected.delete(parentCode);
                for (const candidate of allAreas) {
                    if (String(candidate.parent_code) === parentCode && String(candidate.area_code) !== value)
                        selected.add(String(candidate.area_code));
                }
            }
            else if (selected.has(value)) {
                selected.delete(value);
            }
            else {
                selected.add(value);
            }
        }
        draft.location_area_codes = [...selected];
        draft.location_mode = "schleswig_holstein_areas";
        return renderSchleswigHolsteinAreas(user, chatId, messageId, draft);
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
            return afterSelection(user, chatId, messageId, draft, nextSizeStep(draft));
        }
        return renderRent(user, chatId, messageId, draft);
    }
    if (data.startsWith("roomarea:")) {
        return renderRooms(user, chatId, messageId, draft);
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
