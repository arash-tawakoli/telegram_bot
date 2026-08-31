import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const db = createClient(
  URL,
  KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const PAYMENT_LINK_ID = "plink_1UAdHZ2NorDNIWqIYpkB7lRq";
const ACTIVE = new Set(["active", "trialing"]);

async function secret(name: string) {
  const { data, error } = await db.rpc("get_bot_secret", { secret_name: name });
  if (error || !data) throw new Error(`secret ${name} unavailable`);
  return String(data);
}
function hex(a: ArrayBuffer) {
  return [...new Uint8Array(a)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
async function verify(body: string, header: string, whsec: string) {
  const parts = header.split(","),
    t = parts.find((x) => x.startsWith("t="))?.slice(2),
    sigs = parts.filter((x) => x.startsWith("v1=")).map((x) => x.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300)
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(whsec),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = hex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${t}.${body}`),
    ),
  );
  return sigs.some((s) => equal(mac, s));
}
function period(v: any) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}
function validUser(v: any) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(v || ""),
  );
}

async function existingFor(
  userId?: string,
  subId?: string,
  customerId?: string,
) {
  let q = db.from("user_subscriptions").select("*");
  if (userId) q = q.eq("user_id", userId);
  else if (subId && customerId)
    q = q.or(
      `stripe_subscription_id.eq.${subId},stripe_customer_id.eq.${customerId}`,
    );
  else if (subId) q = q.eq("stripe_subscription_id", subId);
  else if (customerId) q = q.eq("stripe_customer_id", customerId);
  else return null;
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}
async function apply(userId: string, patch: any, eventCreated: number) {
  const old = await existingFor(userId);
  if (old && Number(old.last_event_created || 0) > eventCreated) return;
  const row = {
    user_id: userId,
    provider: "stripe",
    ...patch,
    last_event_created: eventCreated,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db
    .from("user_subscriptions")
    .upsert(row, { onConflict: "user_id" });
  if (error) throw error;
  const stripePremium =
    ACTIVE.has(String(row.status || old?.status || "")) &&
    (!row.current_period_end ||
      new Date(row.current_period_end).getTime() > Date.now());
  const { data: user, error: userError } = await db
    .from("bot_users")
    .select("plan_override")
    .eq("id", userId)
    .maybeSingle();
  if (userError) throw userError;
  const premium =
    user?.plan_override === "premium"
      ? true
      : user?.plan_override === "free"
        ? false
        : stripePremium;
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
async function applySubscription(o: any, eventCreated: number) {
  const subId = String(o.id || ""),
    customerId =
      typeof o.customer === "string"
        ? o.customer
        : String(o.customer?.id || "");
  const old = await existingFor(undefined, subId, customerId);
  if (!old || Number(old.last_event_created || 0) > eventCreated) return;
  const status = String(o.status || old.status || "inactive");
  const currentPeriodEnd =
    o.current_period_end ||
    Math.max(
      0,
      ...(o.items?.data || []).map((item: any) =>
        Number(item.current_period_end || 0),
      ),
    );
  await apply(
    String(old.user_id),
    {
      stripe_customer_id: customerId || old.stripe_customer_id,
      stripe_subscription_id: subId || old.stripe_subscription_id,
      status,
      current_period_end: period(currentPeriodEnd),
      cancel_at_period_end: !!o.cancel_at_period_end,
    },
    eventCreated,
  );
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST")
      return new Response("method not allowed", { status: 405 });
    const body = await req.text(),
      sig = req.headers.get("stripe-signature") || "",
      whsec = await secret("stripe_webhook_signing_secret");
    if (!(await verify(body, sig, whsec)))
      return new Response("bad signature", { status: 400 });
    const e = JSON.parse(body),
      type = String(e.type || ""),
      o = e.data?.object || {},
      created = Number(e.created || 0);
    if (
      type === "checkout.session.completed" ||
      type === "checkout.session.async_payment_succeeded"
    ) {
      if (
        String(o.payment_link || "") !== PAYMENT_LINK_ID ||
        String(o.metadata?.plan || "") !== "premium_monthly"
      )
        return Response.json({ received: true, ignored: true });
      const userId = String(o.client_reference_id || "");
      if (!validUser(userId))
        return Response.json({ received: true, ignored: "missing_user" });
      const paid =
        type === "checkout.session.async_payment_succeeded" ||
        String(o.payment_status || "") === "paid";
      await apply(
        userId,
        {
          stripe_customer_id:
            typeof o.customer === "string"
              ? o.customer
              : String(o.customer?.id || "") || null,
          stripe_subscription_id:
            typeof o.subscription === "string"
              ? o.subscription
              : String(o.subscription?.id || "") || null,
          status: paid ? "active" : "incomplete",
          current_period_end: null,
          cancel_at_period_end: false,
        },
        created,
      );
    } else if (
      type === "customer.subscription.created" ||
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted"
    )
      await applySubscription(o, created);
    return Response.json({ received: true });
  } catch (e) {
    console.error(e);
    return Response.json(
      { received: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});
