import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const ADMIN_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PAYMENT_LINK_ID = "plink_1UAdHZ2NorDNIWqIYpkB7lRq";
const ACTIVE_STATUSES = new Set(["active", "trialing"]);
const STRIPE_API_VERSION = "2026-06-24.dahlia";

async function requiredSecret(name: string) {
  const { data, error } = await db.rpc("get_bot_secret", { secret_name: name });
  if (error || !data) throw new Error(`secret ${name} unavailable`);
  return String(data);
}

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function verifyStripeSignature(body: string, header: string, secret: string) {
  const parts = header.split(",");
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  if (
    !timestamp ||
    !signatures.length ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  ) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${body}`),
    ),
  );
  return signatures.some((signature) => timingSafeEqual(expected, signature));
}

function isoFromUnix(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0
    ? new Date(n * 1000).toISOString()
    : null;
}

function validUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

function stripeId(value: any) {
  return typeof value === "string" ? value : String(value?.id || "");
}

async function existingSubscription(
  userId?: string,
  subscriptionId?: string,
  customerId?: string,
) {
  let query = db.from("user_subscriptions").select("*");
  if (userId) query = query.eq("user_id", userId);
  else if (subscriptionId && customerId) {
    query = query.or(
      `stripe_subscription_id.eq.${subscriptionId},stripe_customer_id.eq.${customerId}`,
    );
  } else if (subscriptionId) {
    query = query.eq("stripe_subscription_id", subscriptionId);
  } else if (customerId) {
    query = query.eq("stripe_customer_id", customerId);
  } else {
    return null;
  }
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function applyEntitlement(
  userId: string,
  patch: Record<string, unknown>,
  eventCreated: number,
  enforceOrdering = true,
) {
  const old = await existingSubscription(userId);
  if (
    enforceOrdering &&
    old &&
    Number(old.last_event_created || 0) > eventCreated
  ) {
    return;
  }

  const row: any = {
    user_id: userId,
    provider: "stripe",
    ...patch,
    last_event_created: enforceOrdering
      ? eventCreated
      : Number(old?.last_event_created || 0),
    updated_at: new Date().toISOString(),
  };
  const { error } = await db
    .from("user_subscriptions")
    .upsert(row, { onConflict: "user_id" });
  if (error) throw error;

  const status = String(row.status || old?.status || "inactive");
  const periodEnd = row.current_period_end ?? old?.current_period_end;
  const stripePremium =
    ACTIVE_STATUSES.has(status) &&
    (!periodEnd || new Date(String(periodEnd)).getTime() > Date.now());

  const { data: user, error: userError } = await db
    .from("bot_users")
    .select("plan_override,plan_override_expires_at,referral_bonus_until")
    .eq("id", userId)
    .maybeSingle();
  if (userError) throw userError;

  const premium = user?.plan_override === "free"
    ? false
    : (user?.plan_override === "premium" &&
        (!user.plan_override_expires_at ||
          new Date(user.plan_override_expires_at).getTime() > Date.now())) ||
      (!!user?.referral_bonus_until &&
        new Date(user.referral_bonus_until).getTime() > Date.now()) ||
      stripePremium;

  if (premium) {
    const { data: profiles, error: profileError } = await db
      .from("search_profiles")
      .select("id")
      .eq("user_id", userId);
    if (profileError) throw profileError;
    const profileIds = (profiles || []).map((profile) => profile.id);
    if (profileIds.length) {
      const { error: deliveryError } = await db
        .from("delivery_events")
        .update({ next_retry_at: null })
        .in("profile_id", profileIds)
        .eq("status", "pending")
        .gt("next_retry_at", new Date().toISOString());
      if (deliveryError) throw deliveryError;
    }
  } else {
    const { error: profileError } = await db
      .from("search_profiles")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .gt("profile_slot", 1);
    if (profileError) throw profileError;
  }
}

async function applySubscriptionObject(object: any, eventCreated: number) {
  const subscriptionId = String(object.id || "");
  const customerId = stripeId(object.customer);
  const old = await existingSubscription(undefined, subscriptionId, customerId);
  if (!old || Number(old.last_event_created || 0) > eventCreated) return;

  const itemPeriodEnds = (object.items?.data || []).map((item: any) =>
    Number(item.current_period_end || 0)
  );
  const currentPeriodEnd =
    Number(object.current_period_end || 0) || Math.max(0, ...itemPeriodEnds);
  await applyEntitlement(
    String(old.user_id),
    {
      stripe_customer_id: customerId || old.stripe_customer_id,
      stripe_subscription_id: subscriptionId || old.stripe_subscription_id,
      status: String(object.status || old.status || "inactive"),
      current_period_end: isoFromUnix(currentPeriodEnd),
      cancel_at_period_end: !!object.cancel_at_period_end,
    },
    eventCreated,
    true,
  );
}

async function telegramMessage(
  userId: string,
  text: string,
  replyMarkup?: Record<string, unknown>,
) {
  const { data: user, error } = await db
    .from("bot_users")
    .select("chat_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!user?.chat_id) return;

  const token = await requiredSecret("telegram_bot_token_runtime");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: user.chat_id,
      text,
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(
      `Telegram sendMessage ${response.status}: ${String(result?.description || "failed")}`,
    );
  }
}

async function claimEvent(eventId: string, eventType: string, eventCreated: number) {
  const { data, error } = await db.rpc("claim_stripe_webhook_event", {
    p_event_id: eventId,
    p_event_type: eventType,
    p_event_created: eventCreated,
  });
  if (error) throw error;
  return String(data || "");
}

async function finishEvent(
  eventId: string,
  status: "processed" | "failed",
  errorMessage: string | null = null,
) {
  const { error } = await db.rpc("finish_stripe_webhook_event", {
    p_event_id: eventId,
    p_status: status,
    p_error: errorMessage,
  });
  if (error) throw error;
}

Deno.serve(async (req: Request) => {
  let eventId = "";
  let claimed = false;
  try {
    if (req.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    const body = await req.text();
    const signature = req.headers.get("stripe-signature") || "";
    const signingSecret = await requiredSecret("stripe_webhook_signing_secret");
    if (!(await verifyStripeSignature(body, signature, signingSecret))) {
      return new Response("bad signature", { status: 400 });
    }

    const event = JSON.parse(body);
    eventId = String(event.id || "");
    const eventType = String(event.type || "");
    const eventCreated = Number(event.created || 0);
    const object = event.data?.object || {};
    if (!eventId) return new Response("missing event id", { status: 400 });

    const claim = await claimEvent(eventId, eventType, eventCreated);
    if (claim === "duplicate") {
      return Response.json({ received: true, duplicate: true });
    }
    if (claim === "busy") {
      return Response.json({ received: true, processing: true });
    }
    if (claim !== "claimed") throw new Error(`unexpected claim result: ${claim}`);
    claimed = true;

    if (
      eventType === "checkout.session.completed" ||
      eventType === "checkout.session.async_payment_succeeded"
    ) {
      const isExpectedCheckout =
        String(object.payment_link || "") === PAYMENT_LINK_ID &&
        String(object.metadata?.plan || "") === "premium_monthly";
      const userId = String(object.client_reference_id || "");
      if (isExpectedCheckout && validUuid(userId)) {
        const paid =
          eventType === "checkout.session.async_payment_succeeded" ||
          String(object.payment_status || "") === "paid";
        const customerId = stripeId(object.customer) || null;
        await applyEntitlement(
          userId,
          {
            stripe_customer_id: customerId,
            stripe_subscription_id: stripeId(object.subscription) || null,
            status: paid ? "active" : "incomplete",
            cancel_at_period_end: false,
          },
          eventCreated,
          false,
        );
      }
    } else if (
      eventType === "customer.subscription.created" ||
      eventType === "customer.subscription.updated" ||
      eventType === "customer.subscription.deleted"
    ) {
      await applySubscriptionObject(object, eventCreated);
    } else if (eventType === "invoice.payment_failed") {
      const customerId = stripeId(object.customer);
      const subscription = await existingSubscription(undefined, undefined, customerId);
      if (subscription) {
        await telegramMessage(
          String(subscription.user_id),
          "⚠️ <b>Premium-Zahlung fehlgeschlagen</b>\n\nBitte aktualisiere deine Zahlungsmethode über „Abo verwalten“.",
          {
            inline_keyboard: [[
              { text: "💳 Abo verwalten", callback_data: "portal" },
            ]],
          },
        );
      }
    }

    await finishEvent(eventId, "processed");
    return Response.json({ received: true });
  } catch (error) {
    console.error(error);
    if (claimed && eventId) {
      try {
        await finishEvent(
          eventId,
          "failed",
          error instanceof Error ? error.message : String(error),
        );
      } catch (finishError) {
        console.error("stripe_webhook_finish_failed", finishError);
      }
    }
    return Response.json(
      { received: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
