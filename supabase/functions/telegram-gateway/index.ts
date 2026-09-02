import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const KEY = KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORE = `${URL}/functions/v1/telegram-ui`;
const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let cached: { value: string; expiresAt: number } | null = null;

async function webhookSecret(force = false) {
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
  const { data, error } = await db.rpc("get_bot_secret", { secret_name: "telegram_webhook_secret" });
  if (error || !data) throw new Error("telegram webhook secret unavailable");
  cached = { value: String(data), expiresAt: Date.now() + 5 * 60_000 };
  return cached.value;
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const supplied = req.headers.get("x-telegram-bot-api-secret-token") || "";
    let expected = await webhookSecret();
    if (supplied !== expected) {
      expected = await webhookSecret(true);
      if (supplied !== expected) return new Response("unauthorized", { status: 401 });
    }
    const body = await req.text();
    const response = await fetch(CORE, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": expected,
      },
      body,
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "application/json" },
    });
  } catch (error) {
    console.error("telegram_gateway", error);
    return Response.json({ ok: false, error: "gateway_failure" }, { status: 502 });
  }
});
