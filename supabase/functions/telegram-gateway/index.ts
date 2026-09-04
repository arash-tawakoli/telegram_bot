import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const KEY = KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORE = `${URL}/functions/v1/telegram-ui`;
const PREMIUM = `${URL}/functions/v1/telegram-premium`;
const ADMIN_TELEGRAM_USER_IDS = [8538226539, 414638980];
const db = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let cached: { value: string; expiresAt: number } | null = null;

async function webhookSecret(force = false) {
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
  const { data, error } = await db.rpc("get_bot_secret", {
    secret_name: "telegram_webhook_secret",
  });
  if (error || !data) throw new Error("telegram webhook secret unavailable");
  cached = { value: String(data), expiresAt: Date.now() + 300000 };
  return cached.value;
}

function parsed(body: string) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function target(body: string) {
  const u = parsed(body);
  if (!u) return CORE;
  const cb = String(u?.callback_query?.data || "");
  const cmd = String(u?.message?.text || "")
    .trim()
    .split(/\s+/, 1)[0]
    .toLowerCase()
    .replace(/@traumwohnunghamburgbot$/i, "");
  return cb === "premium" || cmd === "/premium" ? PREMIUM : CORE;
}

async function userState(body: string) {
  try {
    const u = parsed(body);
    const from = u?.callback_query?.from || u?.message?.from;
    const telegramUserId = Number(from?.id || 0);
    if (!telegramUserId) {
      return { telegramUserId: 0, exists: false, blocked: false, lookupOk: true };
    }
    const { data, error } = await db
      .from("bot_users")
      .select("is_active")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();
    if (error) {
      console.error("telegram_user_check", error.message);
      return { telegramUserId, exists: false, blocked: false, lookupOk: false };
    }
    return {
      telegramUserId,
      exists: !!data,
      blocked: data?.is_active === false,
      lookupOk: true,
    };
  } catch (e) {
    console.error("telegram_user_check", e);
    return { telegramUserId: 0, exists: false, blocked: false, lookupOk: false };
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
    const { data: token, error } = await db.rpc("get_bot_secret", {
      secret_name: "telegram_bot_token_runtime",
    });
    if (error || !token) {
      console.error("telegram_admin_notify", error?.message || "bot token unavailable");
      return;
    }

    await Promise.all(
      ADMIN_TELEGRAM_USER_IDS
        .filter((chatId) => chatId !== Number(user.telegram_user_id))
        .map(async (chatId) => {
          const response = await fetch(
            `https://api.telegram.org/bot${String(token)}/sendMessage`,
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
  } catch (e) {
    console.error("telegram_admin_notify", e);
  }
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    const supplied = req.headers.get("x-telegram-bot-api-secret-token") || "";
    let expected = await webhookSecret();
    if (supplied !== expected) {
      expected = await webhookSecret(true);
      if (supplied !== expected) return new Response("unauthorized", { status: 401 });
    }

    const body = await req.text();
    const state = await userState(body);
    if (state.blocked) return Response.json({ ok: true, blocked: true });

    const destination = target(body);
    const r = await fetch(destination, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": expected,
      },
      body,
    });
    const responseBody = await r.text();

    if (state.lookupOk && !state.exists && state.telegramUserId) {
      const { data: newUser, error } = await db
        .from("bot_users")
        .select("telegram_user_id,first_name,last_name,username")
        .eq("telegram_user_id", state.telegramUserId)
        .maybeSingle();
      if (error) console.error("telegram_new_user_check", error.message);
      else if (newUser) await notifyAdminsNewUser(newUser);
    }

    if (destination === PREMIUM && !r.ok) {
      console.error("telegram_premium_upstream", r.status, responseBody);
      return Response.json({ ok: true, premium_failed: true });
    }
    return new Response(responseBody, {
      status: r.status,
      headers: {
        "content-type": r.headers.get("content-type") || "application/json",
      },
    });
  } catch (e) {
    console.error("telegram_gateway", e);
    return Response.json({ ok: false, error: "gateway_failure" }, { status: 502 });
  }
});
