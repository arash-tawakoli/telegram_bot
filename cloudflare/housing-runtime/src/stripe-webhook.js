// Native Cloudflare D1 Stripe webhook. This route does not query Supabase.
// Do not expose the signing secret to browser clients.
const PAYMENT_LINK_ID = "plink_1UAy8Z2NorDNIWqI9h5j73q0";
const MAX_BODY_BYTES = 128 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 300;
const ACTIVE_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function stripeId(value) {
  return typeof value === "string" ? value : typeof value?.id === "string" ? value.id : "";
}

function stripePeriodEnd(object) {
  const top = Number(object?.current_period_end || 0);
  const items = Array.isArray(object?.items?.data) ? object.items.data : [];
  const period = Math.max(top, ...items.map((item) => Number(item.current_period_end || 0)), 0);
  return Number.isFinite(period) && period > 0 ? new Date(period * 1000).toISOString() : null;
}

function hexToBytes(hex) {
  if (!/^[a-f0-9]{64}$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/.{2}/g), (pair) => Number.parseInt(pair, 16));
}

export async function verifyStripeSignature(payload, header, secret, epochSeconds = Date.now() / 1000) {
  if (!secret || !header) return false;
  const parts = String(header).split(",").map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signatures = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const time = Number(timestamp);
  if (!Number.isInteger(time) || time <= 0 || !signatures.length ||
      Math.abs(epochSeconds - time) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  const signed = new TextEncoder().encode(timestamp + "." + payload);
  for (const signature of signatures) {
    const bytes = hexToBytes(signature);
    if (bytes && await crypto.subtle.verify("HMAC", key, bytes, signed)) return true;
  }
  return false;
}

async function claimEvent(db, eventId, eventType, eventCreated) {
  const prior = await db.prepare("SELECT status FROM stripe_webhook_events WHERE event_id=?").bind(eventId).first();
  if (prior?.status === "processed") return "duplicate";
  if (prior?.status === "processing") return "busy";
  if (prior?.status === "failed") {
    const result = await db.prepare(
      "UPDATE stripe_webhook_events SET status='processing', attempts=attempts+1, last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE event_id=? AND status='failed'",
    ).bind(eventId).run();
    return Number(result?.meta?.changes || 0) === 1 ? "claimed" : "busy";
  }
  const result = await db.prepare(
    "INSERT INTO stripe_webhook_events(event_id,event_type,event_created,status,attempts) VALUES(?,?,?,'processing',1) ON CONFLICT(event_id) DO NOTHING",
  ).bind(eventId,eventType,eventCreated).run();
  return Number(result?.meta?.changes || 0) === 1 ? "claimed" : "busy";
}

async function claimFailure(db, eventId) {
  await db.prepare(
    "UPDATE stripe_webhook_events SET status='failed',last_error='processing_failed',updated_at=CURRENT_TIMESTAMP WHERE event_id=? AND status='processing'",
  ).bind(eventId).run();
}

async function subscriberFor(db, subscriptionId, customerId) {
  if (subscriptionId) {
    const existing = await db.prepare("SELECT participant_id FROM user_subscriptions WHERE stripe_subscription_id=? LIMIT 1").bind(subscriptionId).first();
    if (existing) return existing.participant_id;
  }
  if (customerId) {
    const existing = await db.prepare("SELECT participant_id FROM user_subscriptions WHERE stripe_customer_id=? LIMIT 1").bind(customerId).first();
    if (existing) return existing.participant_id;
  }
  return null;
}

function upsertSubscription(db, {participantId,customerId,subscriptionId,status,periodEnd,cancelAtPeriodEnd,eventCreated}) {
  // Last-event check prevents Stripe retries or delayed updates from reversing newer entitlements.
  return db.prepare(
    "INSERT INTO user_subscriptions(id,participant_id,provider,stripe_customer_id,stripe_subscription_id,status,current_period_end,cancel_at_period_end,last_event_created,updated_at) " +
    "VALUES(?,?,'stripe',?,?,?,?,?,?,CURRENT_TIMESTAMP) " +
    "ON CONFLICT(participant_id) DO UPDATE SET " +
    "stripe_customer_id=COALESCE(excluded.stripe_customer_id,user_subscriptions.stripe_customer_id), " +
    "stripe_subscription_id=COALESCE(excluded.stripe_subscription_id,user_subscriptions.stripe_subscription_id), " +
    "status=excluded.status, " +
    "current_period_end=COALESCE(excluded.current_period_end,user_subscriptions.current_period_end), " +
    "cancel_at_period_end=excluded.cancel_at_period_end, " +
    "last_event_created=excluded.last_event_created,updated_at=CURRENT_TIMESTAMP " +
    "WHERE excluded.last_event_created>=user_subscriptions.last_event_created",
  ).bind(crypto.randomUUID(),participantId,customerId||null,subscriptionId||null,status,periodEnd||null,cancelAtPeriodEnd?1:0,eventCreated);
}

async function processStripeEvent(db, event) {
  const object = event.data?.object || {};
  const eventCreated = Number(event.created);
  const eventId = event.id;
  const statements = [];
  if (event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded") {
    const valid = String(object.payment_link || "") === PAYMENT_LINK_ID &&
      String(object.metadata?.plan || "") === "premium_monthly" &&
      UUID.test(String(object.client_reference_id || ""));
    if (valid && (event.type === "checkout.session.async_payment_succeeded" || object.payment_status === "paid")) {
      const participantId=String(object.client_reference_id);
      const participant=await db.prepare("SELECT 1 FROM participants WHERE id=? LIMIT 1").bind(participantId).first();
      if (!participant) throw new Error("stripe_participant_missing");
      statements.push(upsertSubscription(db, {
        participantId,customerId:stripeId(object.customer),subscriptionId:stripeId(object.subscription),
        status:"active",periodEnd:null,cancelAtPeriodEnd:false,eventCreated,
      }));
      statements.push(db.prepare(
        "UPDATE participants SET plan_override=NULL,plan_override_expires_at=NULL,updated_at=CURRENT_TIMESTAMP " +
        "WHERE id=? AND plan_override='free'",
      ).bind(participantId));
    }
  } else if (event.type.startsWith("customer.subscription.")) {
    const subscriptionId=String(object.id||""),customerId=stripeId(object.customer);
    const participantId=await subscriberFor(db,subscriptionId,customerId);
    // Out-of-order subscription events are retried after checkout establishes the identity.
    if (!participantId) throw new Error("stripe_subscription_unlinked");
    statements.push(upsertSubscription(db,{
      participantId,customerId,subscriptionId,
      status:event.type==="customer.subscription.deleted"?"canceled":String(object.status||"inactive"),
      periodEnd:stripePeriodEnd(object),cancelAtPeriodEnd:Boolean(object.cancel_at_period_end),eventCreated,
    }));
  }
  // Event acknowledgement and the entitlement update are in a single D1 batch.
  statements.push(db.prepare(
    "UPDATE stripe_webhook_events SET status='processed',updated_at=CURRENT_TIMESTAMP WHERE event_id=? AND status='processing'",
  ).bind(eventId));
  const result=await db.batch(statements);
  if (Number(result.at(-1)?.meta?.changes||0)!==1) throw new Error("stripe_event_ack_failed");
}

export async function handleStripeWebhook(request, env) {
  if (request.method !== "POST") return response({error:"method_not_allowed"},405);
  const db=env?.HOUSING_DB;
  if (!env?.STRIPE_WEBHOOK_SIGNING_SECRET || !db?.prepare || !db?.batch) {
    return response({error:"webhook_unavailable"},503);
  }
  const size=Number(request.headers.get("content-length")||0);
  if (size > MAX_BODY_BYTES) return response({error:"payload_too_large"},413);
  const body=await request.text();
  if (new TextEncoder().encode(body).byteLength>MAX_BODY_BYTES) return response({error:"payload_too_large"},413);
  if (!await verifyStripeSignature(body,request.headers.get("stripe-signature"),env.STRIPE_WEBHOOK_SIGNING_SECRET)) {
    return response({error:"bad_signature"},400);
  }
  let event;
  try { event=JSON.parse(body); } catch { return response({error:"invalid_json"},400); }
  if (!/^evt_[a-zA-Z0-9]+$/.test(String(event?.id||"")) ||
      !Number.isSafeInteger(Number(event?.created)) || Number(event.created)<=0 ||
      typeof event?.type!=="string") return response({error:"invalid_event"},400);
  const claim=await claimEvent(db,event.id,event.type,Number(event.created));
  if (claim==="duplicate") return response({received:true,duplicate:true});
  if (claim==="busy") return response({error:"processing"},503);
  try {
    // Ignore unrelated Stripe event types, but persist their acknowledgement.
    await processStripeEvent(db,event);
    return response({received:true});
  } catch (error) {
    await claimFailure(db,event.id);
    console.error("cloudflare_stripe_webhook_failed",String(error?.message||"unknown").slice(0,80));
    return response({error:"processing_failed"},503);
  }
}
