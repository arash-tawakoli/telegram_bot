import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const ADMIN_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const encoder = new TextEncoder();
const STRIPE_API_VERSION = "2026-06-24.dahlia";

async function secret(name: string, required = true) {
  const { data, error } = await db.rpc("get_bot_secret", { secret_name: name });
  if (error || !data) {
    if (required) throw new Error(`secret ${name} unavailable`);
    return null;
  }
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
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function verifyInitData(initData: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") || "";
  const authDate = Number(params.get("auth_date") || 0);
  params.delete("hash");
  if (!hash || !authDate || Math.abs(Date.now() / 1000 - authDate) > 300) return null;

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secretKey = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    encoder.encode(await secret("telegram_bot_token_runtime")),
  );
  const verificationKey = await crypto.subtle.importKey(
    "raw",
    secretKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(
    await crypto.subtle.sign("HMAC", verificationKey, encoder.encode(dataCheckString)),
  );
  if (!timingSafeEqual(hash, expected)) return null;
  try {
    return JSON.parse(params.get("user") || "null");
  } catch {
    return null;
  }
}

async function currentUser(req: Request) {
  const raw = (req.headers.get("authorization") || "").replace(/^tma\s+/i, "");
  const telegramUser = await verifyInitData(raw);
  if (!telegramUser?.id) return null;
  const { data, error } = await db
    .from("bot_users")
    .select("*")
    .eq("telegram_user_id", telegramUser.id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function activeSubscription(subscription: any) {
  return (
    !!subscription &&
    ["active", "trialing"].includes(String(subscription.status || "")) &&
    (!subscription.current_period_end ||
      new Date(subscription.current_period_end).getTime() > Date.now())
  );
}

function effectivePremium(user: any, subscription: any) {
  if (user?.plan_override === "free") return false;
  if (
    user?.plan_override === "premium" &&
    (!user.plan_override_expires_at ||
      new Date(user.plan_override_expires_at).getTime() > Date.now())
  ) return true;
  if (
    user?.referral_bonus_until &&
    new Date(user.referral_bonus_until).getTime() > Date.now()
  ) return true;
  return activeSubscription(subscription);
}

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type,x-internal-secret",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function safeUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

async function contextFor(user: any) {
  const { data: subscription, error } = await db
    .from("user_subscriptions")
    .select("stripe_customer_id,status,current_period_end,cancel_at_period_end")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return {
    subscription: subscription || null,
    premium: effectivePremium(user, subscription),
  };
}

async function bootstrap(user: any) {
  const context = await contextFor(user);
  const profilesPromise = db
    .from("search_profiles")
    .select(
      "id,user_id,profile_slot,name,is_active,property_types,location_mode,boroughs,neighborhoods,max_warm_rent,min_rooms,min_area_sqm,max_deposit,require_known_warm_rent,wbs_only,furnished_preference",
    )
    .eq("user_id", user.id)
    .order("profile_slot");

  const savedQuery = db
    .from("saved_listings")
    .select(
      "id,user_id,status,note,listing_id,updated_at,listings(title,address,district,warm_rent,cold_rent,rooms,area_sqm,latitude,longitude,canonical_url,is_active)",
    )
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(100);

  const recentPromise = db
    .from("delivery_events")
    .select(
      "id,status,sent_at,created_at,listings(id,title,address,district,warm_rent,cold_rent,rooms,area_sqm,latitude,longitude,canonical_url,image_url,resolved_image_url,is_active,sources(name))",
    )
    .eq("recipient_user_id", user.id)
    .eq("event_type", "new_listing")
    .in("status", ["sent", "pending"])
    .order("created_at", { ascending: false })
    .limit(50);

  const profiles = await profilesPromise;
  if (profiles.error) throw profiles.error;
  const profileIds = (profiles.data || []).map((profile: any) => profile.id);
  const [saved, recent, preferences, destinations, referral] =
    await Promise.all([
      savedQuery,
      recentPromise,
      profileIds.length
        ? db.from("notification_preferences").select("*").in("profile_id", profileIds)
        : Promise.resolve({ data: [], error: null }),
      db
        .from("user_destinations")
        .select("id,label,address,transport_mode,max_minutes")
        .eq("user_id", user.id)
        .order("created_at"),
      db.from("referral_codes").select("code").eq("user_id", user.id).maybeSingle(),
    ]);

  for (const result of [saved, recent, preferences, destinations, referral]) {
    if ((result as any).error) throw (result as any).error;
  }

  const sanitizeListing = (listing: any) =>
    listing
      ? {
          ...listing,
          canonical_url: safeUrl(listing.canonical_url),
          image_url: safeUrl(listing.image_url),
          resolved_image_url: safeUrl(listing.resolved_image_url),
        }
      : null;

  return {
    user: {
      first_name: user.first_name,
      ui_language: user.ui_language || "de",
      is_premium: context.premium,
      cancel_at_period_end: !!context.subscription?.cancel_at_period_end,
    },
    profiles: profiles.data || [],
    saved: (saved.data || []).map((row: any) => ({
      ...row,
      listings: sanitizeListing(row.listings),
    })),
    recent: (recent.data || []).map((row: any) => ({
      ...row,
      listings: sanitizeListing(row.listings),
    })),
    preferences: preferences.data || [],
    destinations: destinations.data || [],
    referral: referral.data || null,
  };
}

async function ownsProfile(user: any, profileId: string) {
  const { data, error } = await db
    .from("search_profiles")
    .select("id,profile_slot,user_id")
    .eq("id", profileId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function ownsSaved(user: any, savedId: string) {
  const { data, error } = await db
    .from("saved_listings")
    .select("id,user_id")
    .eq("id", savedId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createPortalSession(user: any) {
  const { subscription } = await contextFor(user);
  if (!subscription?.stripe_customer_id) throw new Error("stripe customer unavailable");
  const apiKey = await secret("stripe_restricted_api_key", false);
  if (!apiKey) {
    const portalUrl = await secret("stripe_portal_url", false);
    if (portalUrl && /^https:\/\/billing\.stripe\.com\//.test(portalUrl)) {
      return portalUrl;
    }
    throw new Error("stripe portal not configured");
  }

  const params = new URLSearchParams();
  params.set("customer", subscription.stripe_customer_id);
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
  if (!response.ok || !result.url) {
    throw new Error(String(result?.error?.message || "portal session failed"));
  }
  return String(result.url);
}


function randomReferralCode() {
  const values = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(values, (value) => value.toString(36))
    .join("")
    .slice(0, 10)
    .toUpperCase();
}

async function api(req: Request, user: any) {
  const path = new URL(req.url).pathname.split("/api/")[1] || "";
  if (req.method === "GET" && path === "bootstrap") return json(await bootstrap(user));
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const body = await req.json().catch(() => ({}));
  const context = await contextFor(user);

  if (path === "profile") {
    const profile = await ownsProfile(user, String(body.id || ""));
    if (!profile) return json({ error: "forbidden" }, 403);
    if (Number(profile.profile_slot) > 1 && !context.premium) {
      return json({ error: "premium_required" }, 403);
    }
    const patch: Record<string, unknown> = {};
    for (const key of [
      "name",
      "is_active",
      "max_warm_rent",
      "min_rooms",
      "min_area_sqm",
      "max_deposit",
      "require_known_warm_rent",
      "wbs_only",
      "furnished_preference",
    ]) {
      if (key in body) patch[key] = body[key];
    }
    if (typeof patch.name === "string") patch.name = patch.name.slice(0, 50).trim();
    if (![undefined, "any", "yes", "no"].includes(patch.furnished_preference as any)) {
      return json({ error: "invalid furnishing" }, 400);
    }
    const { error } = await db
      .from("search_profiles")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", profile.id)
      .eq("user_id", user.id);
    if (error) return json({ error: error.message }, 400);
  } else if (path === "saved") {
    const saved = await ownsSaved(user, String(body.id || ""));
    if (!saved) return json({ error: "forbidden" }, 403);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (
      body.status &&
      ["saved", "contacted", "viewing", "applied", "rejected", "accepted"].includes(
        String(body.status),
      )
    ) patch.status = body.status;
    if (typeof body.note === "string") patch.note = body.note.slice(0, 2000);
    const { error } = await db
      .from("saved_listings")
      .update(patch)
      .eq("id", saved.id);
    if (error) return json({ error: error.message }, 400);
  } else if (path === "preferences") {
    const profile = await ownsProfile(user, String(body.profile_id || ""));
    if (!profile) return json({ error: "forbidden" }, 403);
    const mode = String(body.delivery_mode || "instant");
    if (!["instant", "hourly_digest", "daily_digest"].includes(mode)) {
      return json({ error: "invalid mode" }, 400);
    }
    const { error } = await db.from("notification_preferences").upsert(
      {
        profile_id: profile.id,
        delivery_mode: mode,
        quiet_start: body.quiet_start || null,
        quiet_end: body.quiet_end || null,
        digest_time: body.digest_time || "18:00",
        daily_limit: body.daily_limit ? Number(body.daily_limit) : null,
        timezone: "Europe/Berlin",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id" },
    );
    if (error) return json({ error: error.message }, 400);
  } else if (path === "destination") {
    if (body.action === "delete") {
      const { error } = await db
        .from("user_destinations")
        .delete()
        .eq("id", body.id)
        .eq("user_id", user.id);
      if (error) return json({ error: error.message }, 400);
    } else {
      if (!body.label || !body.address) return json({ error: "missing" }, 400);
      const { error } = await db.from("user_destinations").insert({
        user_id: user.id,
        label: String(body.label).slice(0, 60),
        address: String(body.address).slice(0, 300),
        transport_mode: ["transit", "driving", "cycling", "walking"].includes(
          String(body.transport_mode),
        )
          ? body.transport_mode
          : "transit",
        max_minutes: body.max_minutes ? Number(body.max_minutes) : null,
      });
      if (error) return json({ error: error.message }, 400);
    }
  } else if (path === "portal") {
    try {
      return json({ url: await createPortalSession(user) });
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : String(error) },
        503,
      );
    }
  } else if (path === "referral") {
    let { data: code, error } = await db
      .from("referral_codes")
      .select("code")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 400);
    for (let attempt = 0; !code && attempt < 5; attempt++) {
      const result = await db
        .from("referral_codes")
        .insert({ user_id: user.id, code: randomReferralCode() })
        .select("code")
        .maybeSingle();
      if (!result.error) code = result.data;
      else if (result.error.code !== "23505") return json({ error: result.error.message }, 400);
    }
    if (!code) return json({ error: "code unavailable" }, 500);
    return json({ code: code.code });
  } else {
    return json({ error: "unknown" }, 404);
  }
  return json({ ok: true });
}

const MINI_APP_URL = "https://traumwohnung-mini-app.vercel.app";

Deno.serve(async (req: Request) => {
  const requestUrl = new URL(req.url);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: jsonHeaders });
  }
  if (requestUrl.pathname.includes("/api/")) {
    try {
      const user = await currentUser(req);
      return user ? await api(req, user) : json({ error: "unauthorized" }, 401);
    } catch (error) {
      console.error(error);
      return json(
        { error: error instanceof Error ? error.message : String(error) },
        500,
      );
    }
  }
  if (req.method === "GET") return Response.redirect(MINI_APP_URL, 302);
  return new Response("method not allowed", { status: 405 });
});
