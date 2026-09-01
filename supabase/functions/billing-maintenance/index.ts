import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const ADMIN_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const STRIPE_API_VERSION = "2026-06-24.dahlia";

async function secret(name: string, required = true) {
  const { data, error } = await db.rpc("get_bot_secret", { secret_name: name });
  if (error || !data) {
    if (required) throw new Error(`secret ${name} unavailable`);
    return null;
  }
  return String(data);
}

async function stripeCredit(
  apiKey: string,
  customerId: string,
  referral: any,
) {
  const amount = Math.max(1, Number(referral.reward_amount_cents || 499));
  const params = new URLSearchParams();
  params.set("amount", String(-amount));
  params.set("currency", "eur");
  params.set("description", "Empfehlungsgutschrift Traumwohnung Premium");
  params.set("metadata[referral_id]", referral.id);
  params.set("metadata[referred_user_id]", referral.referred_user_id);
  const response = await fetch(
    `https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}/balance_transactions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "stripe-version": STRIPE_API_VERSION,
        "idempotency-key": `referral-reward-${referral.id}`,
      },
      body: params,
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Stripe ${response.status}: ${String(result?.error?.message || "request failed")}`,
    );
  }
  return result;
}

async function notify(userId: string, amount: number) {
  const [{ data: user }, token] = await Promise.all([
    db.from("bot_users").select("chat_id").eq("id", userId).maybeSingle(),
    secret("telegram_bot_token_runtime"),
  ]);
  if (!user?.chat_id || !token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: user.chat_id,
      parse_mode: "HTML",
      text: `🎁 <b>Empfehlungsgutschrift erhalten</b>\n\nDir wurden ${(amount / 100).toFixed(2).replace(".", ",")} € in Stripe gutgeschrieben.`,
    }),
  });
}

async function run() {
  const apiKey = await secret("stripe_restricted_api_key", false);
  if (!apiKey) {
    return { configured: false, processed: 0, deferred: 0, failed: 0 };
  }

  const { data: referrals, error } = await db
    .from("referrals")
    .select(
      "id,referrer_user_id,referred_user_id,status,rewarded_at,reward_amount_cents",
    )
    .eq("status", "qualified")
    .is("rewarded_at", null)
    .order("qualified_at")
    .limit(50);
  if (error) throw error;

  const totals = { configured: true, processed: 0, deferred: 0, failed: 0 };
  for (const referral of referrals || []) {
    try {
      const { data: subscription, error: subscriptionError } = await db
        .from("user_subscriptions")
        .select("stripe_customer_id")
        .eq("user_id", referral.referrer_user_id)
        .maybeSingle();
      if (subscriptionError) throw subscriptionError;
      if (!subscription?.stripe_customer_id) {
        totals.deferred++;
        continue;
      }

      const transaction = await stripeCredit(
        apiKey,
        subscription.stripe_customer_id,
        referral,
      );
      const { data: updated, error: updateError } = await db
        .from("referrals")
        .update({
          status: "rewarded",
          rewarded_at: new Date().toISOString(),
          stripe_credit_transaction_id: String(transaction.id || "") || null,
        })
        .eq("id", referral.id)
        .eq("status", "qualified")
        .is("rewarded_at", null)
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updated) continue;
      totals.processed++;
      try {
        await notify(
          referral.referrer_user_id,
          Number(referral.reward_amount_cents || 499),
        );
      } catch (noticeError) {
        console.error("referral_notice", noticeError);
      }
    } catch (processingError) {
      totals.failed++;
      console.error("referral_reward", referral.id, processingError);
    }
  }
  return totals;
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    if (
      (req.headers.get("x-internal-secret") || "") !==
      (await secret("internal_worker_secret"))
    ) {
      return new Response("unauthorized", { status: 401 });
    }
    return Response.json({ ok: true, totals: await run() });
  } catch (error) {
    console.error(error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
