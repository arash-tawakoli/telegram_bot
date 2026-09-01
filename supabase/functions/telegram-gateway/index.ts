import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const ADMIN_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const CORE_URL = `${SUPABASE_URL}/functions/v1/telegram-ui`;
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

async function sha256(value: string) {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

async function referralPage(query: any, user: any) {
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
    .eq("status", "rewarded");
  if (countError) throw countError;

  await answerCallback(query.id);
  await editMessage(
    query,
    `🎁 <b>Freunde empfehlen</b>\n\nLink:\n<code>https://t.me/traumwohnunghamburgbot?start=ref_${code.code}</code>\n\nBelohnungen: ${count || 0}\nNach der ersten bezahlten Verlängerung erhältst du eine Stripe-Gutschrift von 4,99 €.`,
    [[{ text: "← Einstellungen", callback_data: "settings" }]],
  );
}

async function setMenuButton(chatId: number) {
  try {
    await telegram("setChatMenuButton", {
      chat_id: chatId,
      menu_button: { type: "commands" },
    });
  } catch (error) {
    console.error("set_chat_menu_button", error);
  }
}


async function joinHousehold(message: any, user: any, token: string) {
  const tokenHash = await sha256(token);
  const { data: invite, error } = await db
    .from("household_invites")
    .select("id,household_id,expires_at,used_at,households(owner_user_id)")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw error;
  if (
    !invite ||
    invite.used_at ||
    new Date(invite.expires_at).getTime() <= Date.now()
  ) {
    await telegram("sendMessage", {
      chat_id: message.chat.id,
      text: "Diese Partner-Einladung ist ungültig oder abgelaufen.",
    });
    return;
  }

  const ownerUserId = (invite as any).households?.owner_user_id;
  if (!ownerUserId || ownerUserId === user.id) {
    await telegram("sendMessage", {
      chat_id: message.chat.id,
      text: "Diese Einladung kann nicht für dieses Konto verwendet werden.",
    });
    return;
  }
  const { data: existingMembership, error: membershipError } = await db
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (existingMembership) {
    await telegram("sendMessage", {
      chat_id: message.chat.id,
      text: "Dieses Konto ist bereits mit einem Partner-Haushalt verbunden.",
    });
    return;
  }

  const { error: insertError } = await db.from("household_members").insert({
    household_id: invite.household_id,
    user_id: user.id,
    role: "member",
  });
  if (insertError) {
    await telegram("sendMessage", {
      chat_id: message.chat.id,
      text: insertError.message.includes("premium")
        ? "Der Eigentümer benötigt aktives Premium für den Partner-Modus."
        : "Die Partner-Verbindung konnte nicht hergestellt werden.",
    });
    return;
  }

  const { error: inviteError } = await db
    .from("household_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", invite.id)
    .is("used_at", null);
  if (inviteError) throw inviteError;

  await telegram("sendMessage", {
    chat_id: message.chat.id,
    text: "✅ Partner-Modus aktiviert. Gemeinsame Profile und gespeicherte Wohnungen sind jetzt verbunden.",
    reply_markup: {
      inline_keyboard: [[{ text: "Startseite", callback_data: "home" }]],
    },
  });
  await setMenuButton(message.chat.id);
}

async function patchSavedHousehold(user: any, listingId: string) {
  const { data: listing } = await db
    .from("listings")
    .select("id,duplicate_of_listing_id")
    .eq("id", listingId)
    .maybeSingle();
  const canonicalId = listing?.duplicate_of_listing_id || listing?.id || listingId;
  const { data: membership } = await db
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership?.household_id) return;
  await db
    .from("saved_listings")
    .update({
      household_id: membership.household_id,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("listing_id", canonicalId);
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

    if (
      query &&
      (data === "household:create" || data === "household:invite") &&
      user &&
      !isPremium(user)
    ) {
      if (await claimHandledUpdate(update)) {
        await answerCallback(query.id, "Partner-Modus ist Premium");
      }
      return Response.json({ ok: true });
    }

    const command = String(message?.text || "")
      .trim()
      .split(/\s+/)[0]
      .toLowerCase()
      .replace(/@traumwohnunghamburgbot$/i, "");
    const argument = String(message?.text || "").trim().split(/\s+/)[1] || "";
    if (message && command === "/start" && argument.startsWith("join_") && user) {
      if (!(await claimHandledUpdate(update))) {
        return Response.json({ ok: true, duplicate: true });
      }
      await joinHousehold(message, user, argument.slice(5));
      return Response.json({ ok: true });
    }
    if (message && command === "/profile" && user && !isPremium(user)) {
      if (!(await claimHandledUpdate(update))) return Response.json({ ok: true, duplicate: true });
      await freeProfilePage(message, user);
      return Response.json({ ok: true });
    }

    const response = await forward(update, webhookSecret);
    const responseText = await response.text();

    if (query && data.startsWith("save:") && user && response.ok) {
      await patchSavedHousehold(user, data.slice(5));
    }
    if (message && command === "/start") {
      await setMenuButton(message.chat.id);
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
