import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const applicationWorker = `${supabaseUrl}/functions/v1/application-worker`;
const immomioWorker = `${supabaseUrl}/functions/v1/immomio-account`;
const wgAuth = `${supabaseUrl}/functions/v1/wg-gesucht-auth-bridge`;
const loginSurface = "https://login.traumwohnunghamburg.de/connect?ticket=";
const providers = ["immoscout", "immowelt", "immomio", "kleinanzeigen", "wg_gesucht"] as const;
type Provider = (typeof providers)[number];

const providerLabels: Record<Provider, string> = {
  immoscout: "ImmoScout24",
  immowelt: "Immowelt",
  immomio: "Immomio",
  kleinanzeigen: "Kleinanzeigen",
  wg_gesucht: "WG-Gesucht",
};

function clean(value: unknown, max = 240) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function providerSource(provider: Provider) {
  return provider === "immoscout" ? 1 : provider === "kleinanzeigen" ? 2 : provider === "immomio" ? 3 : provider === "immowelt" ? 4 : 6;
}

async function secret(name: string) {
  const { data, error } = await db.rpc("get_bot_secret", { secret_name: name });
  if (error || !data) throw Error("configuration_unavailable");
  return String(data);
}

async function internal(endpoint: string, body: Record<string, unknown>, internalSecret: string) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": internalSecret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Error(String(data?.error || `provider_${response.status}`));
  return data;
}

async function telegram(method: string, body: Record<string, unknown>, token: string) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw Error(`telegram_${data?.error_code || response.status}`);
  return data.result;
}

function randomHex(bytes = 24) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function createConnectTicket(userId: string, provider: Exclude<Provider, "kleinanzeigen">) {
  await db.from("platform_auth_flows").update({ consumed_at: new Date().toISOString() })
    .eq("user_id", userId).eq("provider", provider).is("consumed_at", null);
  const state = randomHex(24);
  const verifier = randomHex(48);
  const { error } = await db.from("platform_auth_flows").insert({
    user_id: userId,
    provider,
    state,
    code_verifier: verifier,
    origin: "telegram",
    return_target: "telegram",
    context: { channel: "telegram", reconnect_reminder: true },
  });
  if (error) throw Error("auth_flow_create_failed");
  return `${loginSurface}${encodeURIComponent(state)}`;
}

async function freshLoginUrl(userId: string, provider: Provider, internalSecret: string) {
  if (provider === "kleinanzeigen") {
    const result = await internal(applicationWorker, {
      action: "login_share",
      userId,
      source: providerSource(provider),
      origin: "telegram",
      returnTarget: "telegram",
      context: { channel: "telegram", reconnect_reminder: true },
    }, internalSecret);
    const value = String(result?.url || "");
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "login.kleinanzeigen.de") throw Error("provider_url_invalid");
    return url.href;
  }
  return createConnectTicket(userId, provider);
}

async function checkSession(userId: string, provider: Provider, internalSecret: string) {
  const body = { action: "check", userId, source: providerSource(provider) };
  return provider === "immomio"
    ? internal(immomioWorker, { action: "check", userId }, internalSecret)
    : provider === "wg_gesucht"
    ? internal(wgAuth, { action: "check", userId }, internalSecret)
    : internal(applicationWorker, body, internalSecret);
}

async function markNeedsLogin(userId: string, provider: Provider, reason: string) {
  const { error } = await db.from("platform_connections")
    .update({ status: "needs_login", last_error: clean(reason, 160), updated_at: new Date().toISOString() })
    .eq("user_id", userId).eq("provider", provider).eq("status", "connected");
  if (error) throw Error("connection_status_update_failed");
}

async function scanSessions(internalSecret: string) {
  const { data: connections, error } = await db.from("platform_connections")
    .select("user_id,provider,expires_at,last_error,last_refresh_error")
    .eq("status", "connected")
    .in("provider", providers)
    .limit(500);
  if (error) throw Error("connection_read_failed");
  let checked = 0;
  let marked = 0;
  for (const connection of connections || []) {
    const provider = String(connection.provider) as Provider;
    if (!providers.includes(provider)) continue;
    try {
      const result = await checkSession(String(connection.user_id), provider, internalSecret);
      checked += 1;
      const expiresAt = connection.expires_at ? Date.parse(String(connection.expires_at)) : NaN;
      const recordedAuthError = /auth|login|401|403|unauthor/i.test(`${connection.last_error || ""} ${connection.last_refresh_error || ""}`);
      if (result?.status === "needs_login" || (result?.authenticated === false && provider === "kleinanzeigen" && result?.status !== "error" && (Number.isFinite(expiresAt) && expiresAt <= Date.now() || recordedAuthError))) {
        await markNeedsLogin(String(connection.user_id), provider, String(result?.status || "session_invalid"));
        marked += 1;
      }
    } catch (error) {
      const message = String((error as Error)?.message || error);
      if (message === "needs_login") {
        await markNeedsLogin(String(connection.user_id), provider, message);
        marked += 1;
      }
      // A timeout, provider outage, or a non-premium account must not revoke a valid session.
    }
  }
  return { checked, marked };
}

async function sendReminder(row: any, internalSecret: string, botToken: string) {
  const provider = String(row.provider) as Provider;
  const label = providerLabels[provider];
  const url = await freshLoginUrl(String(row.user_id), provider, internalSecret);
  const text = `🔐 <b>${label} erneut verbinden</b>\n\nDeine ${label}-Sitzung ist abgelaufen oder nicht mehr gültig. Damit automatische Bewerbungen weiterlaufen, melde dich bitte erneut an.`;
  await telegram("sendMessage", {
    chat_id: Number(row.chat_id),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    text,
    reply_markup: {
      inline_keyboard: [[{ text: `🔐 ${label} verbinden`, url }], [{ text: "⚡ Automatische Bewerbungen", callback_data: "platforms" }]],
    },
  }, botToken);
}

async function processNotifications(internalSecret: string, botToken: string) {
  await db.from("platform_reauth_notifications")
    .update({ status: "pending", updated_at: new Date().toISOString() })
    .eq("status", "sending")
    .lt("updated_at", new Date(Date.now() - 15 * 60_000).toISOString());
  const { data: rows, error } = await db.from("platform_reauth_notifications")
    .select("id,user_id,provider,attempts,reminder_stage,chat_id:bot_users!inner(chat_id)")
    .eq("status", "pending")
    .lte("available_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) throw Error("notification_read_failed");
  let sent = 0;
  for (const row of rows || []) {
    const attempts = Number(row.attempts || 0) + 1;
    const { data: claimed } = await db.from("platform_reauth_notifications")
      .update({ status: "sending", attempts, updated_at: new Date().toISOString(), last_error: null })
      .eq("id", row.id).eq("status", "pending").select("id").maybeSingle();
    if (!claimed) continue;
    try {
      const chatId = (row as any).chat_id?.chat_id;
      if (!chatId) throw Error("telegram_chat_missing");
      await sendReminder({ ...row, chat_id: chatId }, internalSecret, botToken);
      const stage = Number(row.reminder_stage || 0);
      const nextDelayDays = [3, 4, 23][stage];
      const nextStage = stage + 1;
      await db.from("platform_reauth_notifications").update({
        status: nextStage < 4 ? "pending" : "sent",
        reminder_stage: Math.min(nextStage, 3),
        available_at: nextDelayDays ? new Date(Date.now() + nextDelayDays * 86400000).toISOString() : new Date().toISOString(),
        last_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: null
      }).eq("id", row.id);
      sent += 1;
    } catch (error) {
      const message = clean((error as Error)?.message || error, 240);
      const terminal = attempts >= 5;
      await db.from("platform_reauth_notifications").update({ status: terminal ? "failed" : "pending", available_at: new Date(Date.now() + Math.min(attempts * 5, 30) * 60_000).toISOString(), updated_at: new Date().toISOString(), last_error: message }).eq("id", row.id);
    }
  }
  return { queued: rows?.length || 0, sent };
}

async function run() {
  const [internalSecret, botToken] = await Promise.all([secret("internal_worker_secret"), secret("telegram_bot_token_runtime")]);
  const scan = await scanSessions(internalSecret);
  const notifications = await processNotifications(internalSecret, botToken);
  return { ok: true, scan, notifications };
}

Deno.serve(async (request) => {
  try {
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    const internalSecret = await secret("internal_worker_secret");
    if (request.headers.get("x-internal-secret") !== internalSecret) return new Response("unauthorized", { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (body?.action === "health") return Response.json({ ok: true, mode: "platform-session-reauth" });
    return Response.json(await run());
  } catch (error) {
    console.error("platform_session_reminder", String(error));
    return Response.json({ ok: false, error: "platform_session_reminder_failed" }, { status: 503 });
  }
});
