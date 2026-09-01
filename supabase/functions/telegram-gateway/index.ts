import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const ADMIN_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const CORE_URL = `${SUPABASE_URL}/functions/v1/telegram-ui`;
const MINI_APP_URL = "https://traumwohnung-mini-app.vercel.app";
const STRIPE_API_VERSION = "2026-06-24.dahlia";

async function secret(name: string, required = true) {
  const { data, error } = await db.rpc("get_bot_secret", { secret_name: name });
  if (error || !data) {
    if (required) throw new Error(`secret ${name} unavailable`);
    return null;
  }
  return String(data);
}

async function telegram(method: string, body: any) {
  const token = await secret("telegram_bot_token_runtime");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(
      `Telegram ${method} ${response.status}: ${String(result?.description || "failed")}`,
    );
  }
  return result.result;
}

async function forward(update: any, webhookSecret: string) {
  return fetch(CORE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": webhookSecret,
    },
    body: JSON.stringify(update),
  });
}


async function ensureUser(from: any, chatId: number) {
  const { data: existing, error } = await db
    .from("bot_users")
    .select("id")
    .eq("telegram_user_id", from.id)
    .maybeSingle();
  if (error) throw error;
  const row = {
    telegram_user_id: from.id,
    chat_id: chatId,
    username: from.username || null,
    first_name: from.first_name || null,
    last_name: from.last_name || null,
    language_code: from.language_code || null,
    is_active: true,
    updated_at: new Date().toISOString(),
  };
  const result = existing
    ? await db.from("bot_users").update(row).eq("id", existing.id)
    : await db.from("bot_users").insert(row);
  if (result.error) throw result.error;
}

async function userFor(telegramUserId: number) {
  const { data: user, error } = await db
    .from("bot_users")
    .select("*")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  if (error) throw error;
  if (!user) return null;

  const { data: subscription, error: subscriptionError } = await db
    .from("user_subscriptions")
    .select(
      "stripe_customer_id,status,current_period_end,cancel_at_period_end",
    )
    .eq("user_id", user.id)
    .maybeSingle();
  if (subscriptionError) throw subscriptionError;
  return { ...user, subscription: subscription || null };
}

function isPremium(user: any) {
  if (!user || user.plan_override === "free") return false;
  if (
    user.plan_override === "premium" &&
    (!user.plan_override_expires_at ||
      new Date(user.plan_override_expires_at).getTime() > Date.now())
  ) {
    return true;
  }
  if (
    user.referral_bonus_until &&
    new Date(user.referral_bonus_until).getTime() > Date.now()
  ) {
    return true;
  }
  const subscription = user.subscription;
  return (
    !!subscription &&
    ["active", "trialing"].includes(String(subscription.status || "")) &&
    (!subscription.current_period_end ||
      new Date(subscription.current_period_end).getTime() > Date.now())
  );
}

async function claimHandledUpdate(update: any) {
  const { error } = await db.from("bot_events").insert({
    telegram_update_id: update.update_id,
    event_type: update.callback_query
      ? "callback_query"
      : update.message
        ? "message"
        : "other",
    telegram_user_id:
      update.callback_query?.from?.id || update.message?.from?.id || null,
    payload: update,
  });
  if (!error) return true;
  if (
    error.code === "23505" ||
    String(error.message || "").toLowerCase().includes("duplicate")
  ) {
    return false;
  }
  console.error("gateway_bot_events", error.message);
  return true;
}

async function answerCallback(id: string, text?: string) {
  try {
    await telegram("answerCallbackQuery", {
      callback_query_id: id,
      text,
    });
  } catch (error) {
    console.error("gateway_callback_ack", error);
  }
}

async function editMessage(query: any, text: string, rows: any[][]) {
  return telegram("editMessageText", {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: rows },
  });
}

async function freeProfilePage(message: any, user: any) {
  const { data: profiles, error } = await db
    .from("search_profiles")
    .select("profile_slot,name,is_active")
    .eq("user_id", user.id)
    .eq("profile_slot", 1)
    .order("profile_slot");
  if (error) throw error;
  const profile = profiles?.[0];
  const rows: any[][] = [];
  if (profile) {
    rows.push([
      {
        text: `${profile.is_active ? "✅" : "⏸"} ${profile.name}`,
        callback_data: "p:view:1",
      },
    ]);
  } else {
    rows.push([{ text: "➕ Suchprofil erstellen", callback_data: "new" }]);
  }
  rows.push([{ text: "← Start", callback_data: "home" }]);
  await telegram("sendMessage", {
    chat_id: message.chat.id,
    text: `🔎 <b>Mein Suchprofil</b>\n\n${profile ? `${profile.is_active ? "Aktiv" : "Pausiert"}: ${profile.name}` : "Noch kein Suchprofil angelegt."}\n\nIm Free-Tarif steht ein Suchprofil zur Verfügung.`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

async function updatePreferences(query: any, user: any, update: any, webhookSecret: string) {
  const parts = String(query.data || "").split(":");
  const action = parts[1];
  const slot = Number(parts[2]);
  if (!Number.isInteger(slot) || slot < 1 || slot > 3) {
    await answerCallback(query.id);
    return new Response("ok");
  }
  if (slot > 1 && !isPremium(user)) {
    await answerCallback(query.id, "Premium erforderlich");
    return new Response("ok");
  }

  const { data: profile, error } = await db
    .from("search_profiles")
    .select("id")
    .eq("user_id", user.id)
    .eq("profile_slot", slot)
    .maybeSingle();
  if (error) throw error;
  if (!profile) {
    await answerCallback(query.id, "Profil nicht gefunden");
    return new Response("ok");
  }

  const patch: any = {
    profile_id: profile.id,
    updated_at: new Date().toISOString(),
  };
  if (action === "set") {
    const mode = parts[3];
    if (!["instant", "hourly_digest", "daily_digest"].includes(mode)) {
      await answerCallback(query.id);
      return new Response("ok");
    }
    patch.delivery_mode = mode;
  } else if (action === "quiet") {
    Object.assign(
      patch,
      parts[3] === "on"
        ? { quiet_start: "22:00", quiet_end: "07:00" }
        : { quiet_start: null, quiet_end: null },
    );
  } else if (action === "limit") {
    patch.daily_limit = Math.max(0, Number(parts[3]) || 0) || null;
  } else {
    return forward(update, webhookSecret);
  }

  const { error: upsertError } = await db
    .from("notification_preferences")
    .upsert(patch, { onConflict: "profile_id" });
  if (upsertError) throw upsertError;

  query.data = `pref:${slot}`;
  return forward(update, webhookSecret);
}

async function portalPage(query: any, user: any) {
  if (!user?.subscription?.stripe_customer_id) {
    await answerCallback(query.id);
    await editMessage(
      query,
      "💳 <b>Abo verwalten</b>\n\nFür dieses Konto ist noch kein Stripe-Kunde hinterlegt.",
      [[{ text: "← Premium", callback_data: "premium" }]],
    );
    return;
  }

  let portalUrl: string | null = null;
  const apiKey = await secret("stripe_restricted_api_key", false);
  if (apiKey) {
    const params = new URLSearchParams();
    params.set("customer", user.subscription.stripe_customer_id);
    params.set("return_url", "https://t.me/traumwohnunghamburgbot");
    const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "stripe-version": STRIPE_API_VERSION,
      },
      body: params,
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.url) portalUrl = String(result.url);
    else console.error("stripe_portal_session", result?.error?.message || response.status);
  }

  if (!portalUrl) {
    const staticUrl = await secret("stripe_portal_url", false);
    if (staticUrl && /^https:\/\/billing\.stripe\.com\//.test(staticUrl)) {
      portalUrl = staticUrl;
    }
  }

  await answerCallback(query.id);
  if (!portalUrl) {
    await editMessage(
      query,
      "💳 <b>Abo verwalten</b>\n\nDas Stripe Customer Portal ist noch nicht freigeschaltet.",
      [[{ text: "← Premium", callback_data: "premium" }]],
    );
    return;
  }
  await editMessage(
    query,
    "💳 <b>Abo verwalten</b>\n\nKündigung, Rechnungen und Zahlungsmittel verwaltest du sicher bei Stripe.",
    [
      [{ text: "Stripe öffnen", url: portalUrl }],
      [{ text: "← Premium", callback_data: "premium" }],
    ],
  );
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (value) => value.toString(36))
    .join("")
    .slice(0, 10)
    .toUpperCase();
}

async function referralData(user: any) {
  let { data: code, error } = await db
    .from("referral_codes")
    .select("code")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  for (let attempt = 0; !code && attempt < 5; attempt++) {
    const result = await db
      .from("referral_codes")
      .insert({ user_id: user.id, code: randomCode() })
      .select("code")
      .maybeSingle();
    if (!result.error) code = result.data;
    else if (result.error.code !== "23505") throw result.error;
  }
  if (!code) throw new Error("referral code unavailable");
  const { count, error: countError } = await db
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("referrer_user_id", user.id)
    .eq("status", "claimed");
  if (countError) throw countError;
  return { code: code.code, count: count || 0 };
}

function referralText(referral: { code: string; count: number }) {
  return `🎁 <b>Freunde empfehlen</b>

Link:
<code>https://t.me/traumwohnunghamburgbot?start=ref_${referral.code}</code>

Einlösungen: ${referral.count}
Wer deinen Link erstmalig nutzt, erhält einmalig 7 Tage Premium kostenlos.`;
}

async function referralPage(query: any, user: any) {
  const referral = await referralData(user);
  await answerCallback(query.id);
  await editMessage(query, referralText(referral), [
    [{ text: "← Einstellungen", callback_data: "settings" }],
  ]);
}

async function referralCommand(message: any, user: any) {
  const referral = await referralData(user);
  await telegram("sendMessage", {
    chat_id: message.chat.id,
    text: referralText(referral),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[{ text: "📱 Mini-App öffnen", web_app: { url: MINI_APP_URL } }]],
    },
  });
}

const COMMANDS = [
  { command: "start", description: "Startseite öffnen" },
  { command: "commands", description: "Alle Funktionen anzeigen" },
  { command: "app", description: "Mini-App öffnen" },
  { command: "suche", description: "Suchprofil erstellen oder ersetzen" },
  { command: "profile", description: "Suchprofil verwalten" },
  { command: "gespeichert", description: "Wohnungs-Cockpit öffnen" },
  { command: "empfehlen", description: "7 Tage Premium verschenken" },
  { command: "premium", description: "Premium und Abo verwalten" },
  { command: "einstellungen", description: "Einstellungen öffnen" },
  { command: "status", description: "Systemstatus anzeigen" },
  { command: "pause", description: "Wohnungssuche pausieren" },
  { command: "resume", description: "Wohnungssuche fortsetzen" },
  { command: "hilfe", description: "Hilfe anzeigen" },
];

async function configureCommandMenu(chatId: number) {
  await telegram("setMyCommands", { commands: COMMANDS });
  await telegram("setChatMenuButton", {
    chat_id: chatId,
    menu_button: { type: "commands" },
  });
}

async function commandsPage(message: any) {
  await telegram("sendMessage", {
    chat_id: message.chat.id,
    parse_mode: "HTML",
    text: "📋 <b>Bot-Menü</b>

Die Befehle sind wieder im Telegram-Menü hinterlegt. Die Mini-App bleibt über /app und den Button unten erreichbar.",
    reply_markup: {
      inline_keyboard: [
        [{ text: "📱 Mini-App öffnen", web_app: { url: MINI_APP_URL } }],
        [
{ text: "🎁 Freunde empfehlen", callback_data: "referral" },
{ text: "👑 Premium", callback_data: "premium" },
        ],
      ],
    },
  });
}

async function miniAppPage(message: any) {
  await telegram("sendMessage", {
    chat_id: message.chat.id,
    parse_mode: "HTML",
    text: "📱 <b>Traumwohnung Mini-App</b>

Suche, neue Angebote, Cockpit und Einstellungen in einer Ansicht.",
    reply_markup: {
      inline_keyboard: [[{ text: "Mini-App öffnen", web_app: { url: MINI_APP_URL } }]],
    },
  });
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const webhookSecret = await secret("telegram_webhook_secret");
    if ((req.headers.get("x-telegram-bot-api-secret-token") || "") !== webhookSecret) {
      return new Response("unauthorized", { status: 401 });
    }

    const update = await req.json().catch(() => ({}));
    const query = update.callback_query;
    const message = update.message;
    const telegramUserId = Number(query?.from?.id || message?.from?.id || 0);
    if (message?.from && message?.chat?.id) {
      await ensureUser(message.from, message.chat.id);
    }
    const user = telegramUserId ? await userFor(telegramUserId) : null;
    const data = String(query?.data || "");

    if (query && data.startsWith("pref:") && data.split(":").length > 2 && user) {
      return await updatePreferences(query, user, update, webhookSecret);
    }

    if (query && data === "portal" && user) {
      if (!(await claimHandledUpdate(update))) return Response.json({ ok: true, duplicate: true });
      await portalPage(query, user);
      return Response.json({ ok: true });
    }

    if (query && data === "referral" && user) {
      if (!(await claimHandledUpdate(update))) return Response.json({ ok: true, duplicate: true });
      await referralPage(query, user);
      return Response.json({ ok: true });
    }

    if (query && data.startsWith("p:toggle:") && user) {
      const slot = Number(data.slice("p:toggle:".length));
      if (slot > 1 && !isPremium(user)) {
        if (await claimHandledUpdate(update)) {
          await answerCallback(query.id, "Premium erforderlich");
        }
        return Response.json({ ok: true });
      }
    }


    const command = String(message?.text || "")
      .trim()
      .split(/\s+/)[0]
      .toLowerCase()
      .replace(/@traumwohnunghamburgbot$/i, "");
    const argument = String(message?.text || "").trim().split(/\s+/)[1] || "";
    if (message && command === "/commands" && user) {
      if (!(await claimHandledUpdate(update))) return Response.json({ ok: true, duplicate: true });
      await configureCommandMenu(message.chat.id);
      await commandsPage(message);
      return Response.json({ ok: true });
    }
    if (message && command === "/app" && user) {
      if (!(await claimHandledUpdate(update))) return Response.json({ ok: true, duplicate: true });
      await miniAppPage(message);
      return Response.json({ ok: true });
    }
    if (message && (command === "/empfehlen" || command === "/referral") && user) {
      if (!(await claimHandledUpdate(update))) return Response.json({ ok: true, duplicate: true });
      await referralCommand(message, user);
      return Response.json({ ok: true });
    }
    if (message && command === "/profile" && user && !isPremium(user)) {
      if (!(await claimHandledUpdate(update))) return Response.json({ ok: true, duplicate: true });
      await freeProfilePage(message, user);
      return Response.json({ ok: true });
    }

    const response = await forward(update, webhookSecret);
    const responseText = await response.text();

    if (message && command === "/start") {
      await configureCommandMenu(message.chat.id);
    }

    return new Response(responseText, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "application/json" },
    });
  } catch (error) {
    console.error(error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
