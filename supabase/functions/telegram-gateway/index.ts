import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const KEY = KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORE = `${URL}/functions/v1/telegram-ui`;
const PREMIUM = `${URL}/functions/v1/telegram-premium`;
const ADMIN_TELEGRAM_USER_IDS = [8538226539, 414638980];

let cachedWebhookSecret: { value: string; expiresAt: number } | null = null;
let cachedBotToken: { value: string; expiresAt: number } | null = null;

function serviceHeaders() {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "content-type": "application/json",
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
  const entry = { value, expiresAt: Date.now() + 300_000 };
  if (name === "telegram_webhook_secret") cachedWebhookSecret = entry;
  else if (name === "telegram_bot_token_runtime") cachedBotToken = entry;
  return value;
}

function parsed(body: string) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function commandOf(update: any) {
  return String(update?.message?.text || "")
    .trim()
    .split(/\s+/, 1)[0]
    .toLowerCase()
    .replace(/@traumwohnunghamburgbot$/i, "");
}

function target(update: any) {
  const callback = String(update?.callback_query?.data || "");
  const command = commandOf(update);
  return callback === "premium" || command === "/premium" ? PREMIUM : CORE;
}

async function userState(telegramUserId: number) {
  if (!telegramUserId) {
    return { telegramUserId: 0, exists: false, blocked: false, lookupOk: true };
  }

  try {
    const query = new URL(`${URL}/rest/v1/bot_users`);
    query.searchParams.set("telegram_user_id", `eq.${telegramUserId}`);
    query.searchParams.set("select", "telegram_user_id,is_active");
    query.searchParams.set("limit", "1");
    const response = await fetch(query, { headers: serviceHeaders() });
    const rows = await response.json().catch(() => []);
    if (!response.ok) throw new Error(`user lookup ${response.status}`);
    const row = Array.isArray(rows) ? rows[0] : null;
    return {
      telegramUserId,
      exists: !!row,
      blocked: row?.is_active === false,
      lookupOk: true,
    };
  } catch (error) {
    console.error("telegram_user_check", error);
    return { telegramUserId, exists: false, blocked: false, lookupOk: false };
  }
}

async function fetchNewUser(telegramUserId: number) {
  try {
    const query = new URL(`${URL}/rest/v1/bot_users`);
    query.searchParams.set("telegram_user_id", `eq.${telegramUserId}`);
    query.searchParams.set("select", "telegram_user_id,first_name,last_name,username");
    query.searchParams.set("limit", "1");
    const response = await fetch(query, { headers: serviceHeaders() });
    const rows = await response.json().catch(() => []);
    if (!response.ok) throw new Error(`new user lookup ${response.status}`);
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch (error) {
    console.error("telegram_new_user_check", error);
    return null;
  }
}

async function notifyAdminsNewUser(user: any) {
  try {
    const name =
      [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
      (user.username ? `@${user.username}` : String(user.telegram_user_id));
    const username = user.username && name !== `@${user.username}`
      ? ` (@${user.username})`
      : "";
    const text = `👤 Neuer Nutzer: ${name}${username}`;
    const token = await secret("telegram_bot_token_runtime");

    await Promise.all(
      ADMIN_TELEGRAM_USER_IDS
        .filter((chatId) => chatId !== Number(user.telegram_user_id))
        .map(async (chatId) => {
          const response = await fetch(
            `https://api.telegram.org/bot${token}/sendMessage`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ chat_id: chatId, text }),
            },
          );
          const result = await response.json().catch(() => ({}));
          if (!response.ok || !result?.ok) {
            console.error(
              "telegram_admin_notify",
              chatId,
              result?.description || response.status,
            );
          }
        }),
    );
  } catch (error) {
    console.error("telegram_admin_notify", error);
  }
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    const supplied = req.headers.get("x-telegram-bot-api-secret-token") || "";
    let expected = await secret("telegram_webhook_secret");
    if (supplied !== expected) {
      cachedWebhookSecret = null;
      expected = await secret("telegram_webhook_secret", true);
      if (supplied !== expected) return new Response("unauthorized", { status: 401 });
    }

    const body = await req.text();
    const update = parsed(body);
    const destination = target(update);
    const command = commandOf(update);
    const from = update?.callback_query?.from || update?.message?.from;
    const telegramUserId = Number(from?.id || 0);

    // The core UI already checks blocked users. Only /premium needs the gateway
    // check because it is intentionally routed to the separate premium function.
    // /start also checks existence so the existing new-user admin notification
    // can be preserved without adding a lookup to every command/callback.
    let state = { telegramUserId, exists: false, blocked: false, lookupOk: true };
    if (destination === PREMIUM || command === "/start") {
      state = await userState(telegramUserId);
      if (state.blocked) return Response.json({ ok: true, blocked: true });
    }

    const upstream = await fetch(destination, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": expected,
      },
      body,
    });
    const responseBody = await upstream.text();

    if (
      upstream.ok &&
      destination === CORE &&
      command === "/start" &&
      state.lookupOk &&
      !state.exists &&
      state.telegramUserId
    ) {
      EdgeRuntime.waitUntil((async () => {
        const newUser = await fetchNewUser(state.telegramUserId);
        if (newUser) await notifyAdminsNewUser(newUser);
      })());
    }

    if (destination === PREMIUM && !upstream.ok) {
      console.error("telegram_premium_upstream", upstream.status, responseBody);
      return Response.json({ ok: true, premium_failed: true });
    }

    return new Response(responseBody, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch (error) {
    console.error("telegram_gateway", error);
    return Response.json({ ok: false, error: "gateway_failure" }, { status: 502 });
  }
});
