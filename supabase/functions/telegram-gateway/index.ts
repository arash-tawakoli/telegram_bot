import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleAutoApplyCallback, isAutoApplyCallback } from "./auto-apply.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const KEY = KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORE = `${URL}/functions/v1/telegram-ui`;
const PREMIUM_LINK = "https://buy.stripe.com/dRm9AM7DSajfgYK2qVfYY01";
const PREMIUM_IMAGE = `${URL}/storage/v1/object/public/telegram-assets/premium/50-off-hd.jpg?v=20260903hd4`;
const ADMIN_TELEGRAM_USER_IDS = [8538226539, 414638980];
const FAST_COMMANDS = new Set([
  "/start", "/suche", "/profile", "/gespeichert", "/saved",
  "/einstellungen", "/settings", "/pause", "/resume", "/status",
  "/hilfe", "/help", "/premium",
]);

let cachedWebhookSecret: { value: string; expiresAt: number } | null = null;
let cachedBotToken: { value: string; expiresAt: number } | null = null;

function serviceHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "content-type": "application/json",
    ...extra,
  };
}

async function secret(name: string, force = false) {
  const cache = name === "telegram_webhook_secret" ? cachedWebhookSecret : cachedBotToken;
  if (!force && cache && cache.expiresAt > Date.now()) return cache.value;
  const response = await fetch(`${URL}/rest/v1/rpc/get_bot_secret`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ secret_name: name }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(`${name} unavailable`);
  const value = String(data);
  const entry = { value, expiresAt: Date.now() + 3_600_000 };
  if (name === "telegram_webhook_secret") cachedWebhookSecret = entry;
  else if (name === "telegram_bot_token_runtime") cachedBotToken = entry;
  return value;
}

async function rpc(name: string, body: Record<string, unknown>) {
  const response = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${name} ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function rows(table: string, params: Record<string, string>) {
  const url = new globalThis.URL(`${URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: serviceHeaders() });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`${table} ${response.status}`);
  return Array.isArray(data) ? data : [];
}

async function patchRows(table: string, params: Record<string, string>, values: Record<string, unknown>) {
  const url = new globalThis.URL(`${URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(values),
  });
  if (!response.ok) throw new Error(`${table} patch ${response.status}`);
}

async function countRows(table: string, params: Record<string, string>) {
  const url = new globalThis.URL(`${URL}/rest/v1/${table}`);
  url.searchParams.set("select", "id");
  url.searchParams.set("limit", "1");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: serviceHeaders({ Prefer: "count=exact" }) });
  if (!response.ok) throw new Error(`${table} count ${response.status}`);
  const range = response.headers.get("content-range") || "*/0";
  const total = Number(range.split("/").pop() || 0);
  return Number.isFinite(total) ? total : 0;
}

function parsed(body: string) {
  try { return JSON.parse(body); } catch { return null; }
}

function commandOf(update: any) {
  return String(update?.message?.text || "")
    .trim()
    .split(/\s+/, 1)[0]
    .toLowerCase()
    .replace(/@traumwohnunghamburgbot$/i, "");
}

function argumentOf(update: any) {
  const text = String(update?.message?.text || "").trim();
  const parts = text.split(/\s+/, 2);
  return parts[1] || "";
}

function button(text: string, callback_data: string) { return { text, callback_data }; }
function short(value: unknown, max = 42) {
  const text = String(value || "Inserat").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function direct(method: string, params: Record<string, unknown>) {
  return Response.json({ method, ...params });
}
function sendText(chatId: number, text: string, reply_markup?: unknown) {
  return direct("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(reply_markup ? { reply_markup } : {}),
  });
}
function sendPhoto(chatId: number, caption: string, reply_markup: unknown) {
  return direct("sendPhoto", {
    chat_id: chatId,
    photo: PREMIUM_IMAGE,
    caption,
    parse_mode: "HTML",
    reply_markup,
  });
}

function hydrateUser(prepared: any) {
  const user = prepared?.user || {};
  const subscription = prepared?.subscription || null;
  const now = Date.now();
  const premium = user.plan_override === "free"
    ? false
    : (user.plan_override === "premium" && (!user.plan_override_expires_at || new Date(user.plan_override_expires_at).getTime() > now)) ||
      (!!user.referral_bonus_until && new Date(user.referral_bonus_until).getTime() > now) ||
      (!!subscription && ["active", "trialing"].includes(String(subscription.status || "")) &&
        (!subscription.current_period_end || new Date(subscription.current_period_end).getTime() > now));
  return { ...user, is_premium: !!premium, subscription, __is_new_user: prepared?.is_new_user === true };
}

function profileLimit(user: any) { return user.is_premium ? 3 : 1; }
function homeKeyboard(user: any) {
  return { inline_keyboard: [
    [button("🔎 Suchprofil", "profile"), button(user.is_premium ? "⭐️ Gespeichert" : "🔒 ⭐️ Gespeichert", "saved")],
    [button("⚙️ Einstellungen", "settings"), button("❓ Hilfe", "help")],
    [button("💎 30 Tage Premium für 0 €", "referral")],
  ] };
}
function homeResponse(user: any, chatId: number) {
  return sendText(chatId,
    "🏠 <b>Traumwohnung Hamburg</b>\n\nFinde passende Mietangebote in Hamburg – automatisch und direkt per Telegram.\n\nWähle unten, was du machen möchtest.",
    homeKeyboard(user));
}
function settingsResponse(user: any, chatId: number) {
  return sendText(chatId, "⚙️ <b>Einstellungen</b>\n\nVerwalte hier Premium, Sprache und Systemstatus.", {
    inline_keyboard: [
      [button("🔐 Plattformkonten / Auto-Bewerbung", "platforms")],
      [button(user.is_premium ? "💎 Premium aktiv" : "💎 Premium", "premium")],
      [button("🌐 Sprachen", "language"), button("📡 Systemstatus", "status")],
      [button("← Zurück", "home")],
    ],
  });
}
function premiumResponse(user: any, chatId: number) {
  const rows: any[] = [];
  let text: string;
  if (user.is_premium) {
    text = "💎 <b>Traumwohnung Premium</b>\n\n✅ <b>Premium ist aktiv.</b>\n\n<b>Deine Vorteile:</b>\n⚡ Sofortige Zustellung\n🔎 Bis zu 3 Suchprofile\n🔓 Baugenossenschafts-Angebote öffnen\n⭐️ Inserate speichern";
    rows.push([button("💳 Abo verwalten", "portal")]);
  } else {
    text = "💎 <b>Traumwohnung Premium</b>\n\n<b>Deine Vorteile:</b>\n⚡ Sofortige Zustellung\n🔎 Bis zu 3 Suchprofile\n🔓 Baugenossenschafts-Angebote öffnen\n⭐️ Inserate speichern\n\n<s>1,99 €</s> <b>0,99 € / Monat</b>\nKeine Mindestlaufzeit · jederzeit kündbar";
    rows.push([{ text: "💎 Premium freischalten", url: `${PREMIUM_LINK}?client_reference_id=${encodeURIComponent(user.id)}` }]);
  }
  rows.push([button("← Zurück", "home")]);
  return sendPhoto(chatId, text, { inline_keyboard: rows });
}

async function profileResponse(user: any, chatId: number) {
  const limit = profileLimit(user);
  const profiles = await rows("search_profiles", {
    user_id: `eq.${user.id}`,
    profile_slot: `lte.${limit}`,
    select: "profile_slot,name,is_active",
    order: "profile_slot.asc",
  });
  const keyboard: any[] = profiles.map((row: any) => [button(`🔎 ${row.name || `Meine Suche ${row.profile_slot}`} · ${row.is_active ? "aktiv" : "pausiert"}`, `profile:view:${row.profile_slot}`)]);
  if (user.onboarding_step) keyboard.push([button("🔎 Entwurf fortsetzen", "draft")]);
  if (profiles.length < limit) keyboard.push([button("➕ Suchprofil erstellen", "new")]);
  if (!user.is_premium && profiles.length >= 1) keyboard.push([button("🔒 ➕ Weiteres Suchprofil · 💎 Premium", "premium")]);
  keyboard.push([button("← Zurück", "home")]);
  const text = profiles.length
    ? `🔎 <b>Meine Suchprofile</b>\n\n${profiles.length}/${limit} Suchprofile angelegt.`
    : "🔎 <b>Meine Suchprofile</b>\n\nNoch kein Suchprofil angelegt.";
  return sendText(chatId, text, { inline_keyboard: keyboard });
}

async function newSearchResponse(user: any, chatId: number) {
  const limit = profileLimit(user);
  const profiles = await rows("search_profiles", {
    user_id: `eq.${user.id}`,
    select: "profile_slot",
    order: "profile_slot.asc",
  });
  const used = new Set(profiles.map((row: any) => Number(row.profile_slot)));
  const slot = Array.from({ length: limit }, (_, i) => i + 1).find((value) => !used.has(value));
  if (!slot) return profileResponse(user, chatId);
  const draft = {
    profile_slot: slot,
    property_types: [],
    location_mode: null,
    borough_ids: [],
    neighborhood_ids: [],
    neighborhood_page: 0,
    max_warm_rent: null,
    min_rooms: null,
    min_area_sqm: null,
  };
  await patchRows("bot_users", { id: `eq.${user.id}` }, {
    onboarding_step: "types",
    onboarding_state: draft,
    updated_at: new Date().toISOString(),
  });
  const keyboard = ["Wohnung", "Haus", "WG", "Tauschwohnung"].map((value) => [button(value, `type:${value}`)]);
  keyboard.push([button("Alle auswählen", "type:all"), button("Auswahl löschen", "type:clear")]);
  keyboard.push([button("← Zurück", "home"), button("Weiter →", "type:done")]);
  keyboard.push([button("✖️ Abbrechen", "cancel")]);
  return sendText(chatId, "1/5 · <b>Was suchst du?</b>\n\nWähle eine oder mehrere Wohnungsarten.", { inline_keyboard: keyboard });
}

async function savedResponse(user: any, chatId: number) {
  if (!user.is_premium) return premiumResponse(user, chatId);
  const [total, saved] = await Promise.all([
    countRows("saved_listings", { user_id: `eq.${user.id}` }),
    rows("saved_listings", {
      user_id: `eq.${user.id}`,
      select: "listing_id,created_at,listings(title,canonical_url,is_active)",
      order: "created_at.desc",
      limit: "8",
    }),
  ]);
  if (!total) return sendText(chatId, "⭐️ <b>Gespeicherte Inserate</b>\n\nNoch keine Inserate gespeichert.", { inline_keyboard: [[button("← Zurück", "home")]] });
  const keyboard: any[] = [];
  for (const [index, row] of saved.entries()) {
    const listing = row.listings || {};
    const label = `🏠 ${index + 1}. ${short(listing.title, 42)}`;
    try {
      const url = new globalThis.URL(String(listing.canonical_url || ""));
      if (["http:", "https:"].includes(url.protocol)) { keyboard.push([{ text: label, url: url.href }]); continue; }
    } catch {}
    keyboard.push([button(label, "noop")]);
  }
  const pages = Math.max(1, Math.ceil(total / 8));
  if (pages > 1) keyboard.push([button("← Zurück", "saved:0"), button(`1/${pages}`, "noop"), button("Weiter →", "saved:1")]);
  keyboard.push([button("✖️ Abbrechen", "home")]);
  return sendText(chatId, `⭐️ <b>Gespeicherte Inserate</b>\n\n${total} · Seite 1/${pages}`, { inline_keyboard: keyboard });
}

async function statusResponse(user: any, chatId: number) {
  const limit = profileLimit(user);
  const [profiles, sources, referrals] = await Promise.all([
    countRows("search_profiles", { user_id: `eq.${user.id}`, is_active: "eq.true", profile_slot: `lte.${limit}` }),
    countRows("sources", {}),
    countRows("referrals", { referrer_user_id: `eq.${user.id}`, status: "eq.rewarded" }),
  ]);
  return sendText(chatId,
    `📡 <b>Systemstatus</b>\n\n🔎 Suchprofile aktiv: ${profiles}/${limit}\n🌐 Quellen im System: ${sources}\n💎 Erfolgreiche Empfehlungen: ${referrals}\n✅ System: online`,
    { inline_keyboard: [[button("← Einstellungen", "settings")]] });
}

async function telegram(method: string, body: Record<string, unknown>, retry = true) {
  const token = await secret("telegram_bot_token_runtime");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if ((!response.ok || !data?.ok) && response.status === 401 && retry) {
    cachedBotToken = null;
    return telegram(method, body, false);
  }
  if (!response.ok || !data?.ok) throw new Error(String(data?.description || `Telegram ${response.status}`));
  return data.result;
}

async function notifyAdminsNewUser(user: any) {
  try {
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || (user.username ? `@${user.username}` : String(user.telegram_user_id));
    const username = user.username && name !== `@${user.username}` ? ` (@${user.username})` : "";
    const text = `👤 Neuer Nutzer: ${name}${username}`;
    await Promise.all(ADMIN_TELEGRAM_USER_IDS
      .filter((chatId) => chatId !== Number(user.telegram_user_id))
      .map((chatId) => telegram("sendMessage", { chat_id: chatId, text }).catch((error) => console.error("telegram_admin_notify", chatId, String(error)))));
  } catch (error) {
    console.error("telegram_admin_notify", String(error));
  }
}

async function finishNow(updateId: number, attempt: number, success: boolean, error: string | null = null) {
  return rpc("finish_telegram_update", {
    p_update_id: updateId,
    p_attempt: attempt,
    p_success: success,
    p_error: error,
  });
}

function finishInBackground(updateId: number, attempt: number, success: boolean, error: string | null = null) {
  EdgeRuntime.waitUntil(finishNow(updateId, attempt, success, error)
    .catch((finishError) => console.error("telegram_finish", String(finishError))));
}

async function forwardToCore(body: string, expected: string, callbackAcked = false) {
  const upstream = await fetch(CORE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": expected,
      "x-region": "eu-west-1",
      "x-callback-acked": callbackAcked ? "1" : "0",
    },
    body,
  });
  const responseBody = await upstream.text();
  return new Response(responseBody, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  let updateId: number | null = null;
  let attempt: number | null = null;
  try {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

    const supplied = req.headers.get("x-telegram-bot-api-secret-token") || "";
    let expected = await secret("telegram_webhook_secret");
    if (supplied !== expected) {
      cachedWebhookSecret = null;
      expected = await secret("telegram_webhook_secret", true);
      if (supplied !== expected) return new Response("unauthorized", { status: 401 });
    }

    const body = await req.text();
    const update = parsed(body);
    if (update?.callback_query?.id) {
      const callbackData = String(update.callback_query?.data || "");
      if (isAutoApplyCallback(callbackData)) {
        EdgeRuntime.waitUntil(
          handleAutoApplyCallback(update)
            .catch((error) => console.error("telegram_auto_apply", String(error)))
        );
      } else {
        EdgeRuntime.waitUntil(
          forwardToCore(body, expected, true)
            .then((response) => { if (!response.ok) console.error("telegram_callback_core", response.status); })
            .catch((error) => console.error("telegram_callback_core", String(error)))
        );
      }
      return direct("answerCallbackQuery", { callback_query_id: String(update.callback_query.id) });
    }
    const command = commandOf(update);

    if (!update?.message?.from?.id || !update?.message?.chat?.id || !FAST_COMMANDS.has(command)) {
      return forwardToCore(body, expected);
    }

    const prepared = await rpc("prepare_telegram_update", { p_payload: update });
    const claim = Number(prepared?.claim ?? 0);
    if (claim === 0) return Response.json({ ok: true, duplicate: true });
    if (claim < 0) return Response.json({ ok: false, busy: true }, { status: 503 });

    updateId = Number(update.update_id);
    attempt = claim;
    const user = hydrateUser(prepared);
    user.request_update_id = updateId;
    const chatId = Number(update.message.chat.id);

    if (String(user.ui_language || "de") !== "de") {
      await finishNow(updateId, attempt, false, "fast_path_language_fallback");
      updateId = null;
      attempt = null;
      return forwardToCore(body, expected);
    }

    if (!user.is_active && !ADMIN_TELEGRAM_USER_IDS.includes(Number(user.telegram_user_id))) {
      finishInBackground(updateId, attempt, true);
      return Response.json({ ok: true, blocked: true });
    }

    let response: Response;
    if (command === "/start") {
      const argument = argumentOf(update);
      if (argument.startsWith("ref_") && user.__is_new_user === true) {
        await rpc("redeem_referral_code", { p_referred_user_id: user.id, p_code: argument.slice(4) }).catch((error) => console.error("referral_register", String(error)));
      }
      EdgeRuntime.waitUntil(telegram("setChatMenuButton", { chat_id: chatId, menu_button: { type: "commands" } }).catch(() => {}));
      if (user.__is_new_user === true) EdgeRuntime.waitUntil(notifyAdminsNewUser(user));
      response = homeResponse(user, chatId);
    } else if (command === "/hilfe" || command === "/help") {
      response = sendText(chatId,
        "❓ <b>Hilfe & Befehle</b>\n\n🏠 /start – Startmenü\n🔎 /suche – Suchprofil erstellen oder ersetzen\n👤 /profile – Suchprofil anzeigen\n⭐️ /gespeichert – gespeicherte Inserate\n⚙️ /einstellungen – Einstellungen\n⏸ /pause – Suche pausieren\n▶️ /resume – Suche fortsetzen\n📡 /status – Systemstatus\n💎 /premium – Premium anzeigen\n❓ /hilfe – Hilfe");
    } else if (command === "/einstellungen" || command === "/settings") {
      response = settingsResponse(user, chatId);
    } else if (command === "/premium") {
      response = premiumResponse(user, chatId);
    } else if (command === "/pause" || command === "/resume") {
      const paused = command === "/pause";
      await patchRows("search_profiles", { user_id: `eq.${user.id}` }, { is_active: !paused, updated_at: new Date().toISOString() });
      response = sendText(chatId, paused ? "⏸ Dein Suchprofil ist pausiert." : "▶️ Dein Suchprofil ist wieder aktiv.");
    } else if (command === "/suche") {
      response = await newSearchResponse(user, chatId);
    } else if (command === "/profile") {
      response = await profileResponse(user, chatId);
    } else if (command === "/gespeichert" || command === "/saved") {
      response = await savedResponse(user, chatId);
    } else if (command === "/status") {
      response = await statusResponse(user, chatId);
    } else {
      return forwardToCore(body, expected);
    }

    finishInBackground(updateId, attempt, true);
    return response;
  } catch (error) {
    if (updateId !== null && attempt !== null) finishInBackground(updateId, attempt, false, String(error));
    console.error("telegram_gateway", String(error));
    return Response.json({ ok: false, error: "gateway_failure" }, { status: 502 });
  }
});
