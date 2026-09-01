import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { label } from "./labels.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const ADMIN_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PAGE_SIZE = 200;
const LEASE_MS = 2 * 60_000;
const FREE_DELAY_MS = 2 * 60 * 60_000;
const MAX_ATTEMPTS = 5;
const DETAIL_SOURCES = new Set([2, 15, 16]);
const USER_AGENT =
  "Mozilla/5.0 (compatible; TraumwohnungHamburgBot/14.0; +https://traumwohnung-hamburg.de)";

async function secret(name: string) {
  const { data, error } = await db.rpc("get_bot_secret", { secret_name: name });
  if (error || !data) throw new Error(`secret ${name} unavailable`);
  return String(data);
}

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n)
    ? `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(n)} €`
    : String(value);
}

function num(value: unknown, digits = 2) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat("de-DE", { maximumFractionDigits: digits }).format(n)
    : String(value);
}

function deNumber(value: unknown) {
  if (value == null || value === "") return null;
  let s = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/[^\d.,-]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(".", "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function plain(html: string) {
  return html
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&euro;|&#8364;/gi, "€")
    .replace(/&amp;/gi, "&")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attrNumber(input: string, key: string) {
  return deNumber(
    input.match(new RegExp(`${key}_(?:i|d|s)\\s*:\\s*([\\d.,]+)`, "i"))?.[1],
  );
}

function detailFacts(input: string) {
  return {
    warm: attrNumber(input, "warmmiete"),
    cold: attrNumber(input, "kaltmiete"),
    additional: attrNumber(input, "nebenkosten"),
    heating: attrNumber(input, "heizkosten"),
  };
}

function warmFromText(input: string) {
  const structured = detailFacts(input).warm;
  if (structured != null) return structured;
  const text = plain(input);
  const before = text.match(
    /([\d.]+(?:,\d{1,2})?)\s*(?:€|EUR)\s*(?:inkl\.?\s*(?:NK|Nebenkosten)|inklusive\s+Nebenkosten|Warmmiete|Bruttowarmmiete|Bruttomiete|Gesamtmiete)/i,
  )?.[1];
  if (before) return deNumber(before);
  return deNumber(
    text.match(
      /(?:Warmmiete|Bruttowarmmiete|Bruttomiete|Gesamtmiete|Miete\s*warm|Miete\s*inkl\.?\s*(?:NK|Nebenkosten)|warm\s*rent)\s*(?:(?:[:=]|beträgt|ist)\s*)?([\d.]+(?:,\d{1,2})?)\s*(?:€|EUR)?/i,
    )?.[1],
  );
}

function address(listing: any) {
  if (listing.address && String(listing.address).trim()) {
    return String(listing.address).trim();
  }
  const parts = [
    listing.district,
    listing.postal_code,
    listing.city || "Hamburg",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function mapsUrl(listing: any) {
  const value = address(listing);
  return value
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`
    : null;
}

function listingText(listing: any) {
  return `${listing.property_type || ""} ${listing.title || ""} ${listing.district || ""} ${listing.address || ""} ${JSON.stringify(listing.raw || {}).slice(0, 6000)}`;
}

function wantedAd(listing: any) {
  const text = listingText(listing);
  return (
    /(?:^|\s)(?:ich|wir)\s+suche(?:n)?\s+.{0,40}(?:wohnung|apartment|wg-zimmer|zimmer|haus)\b/i.test(
      text,
    ) ||
    /\bsucht\s+(?:dringend\s+)?(?:eine[nr]?\s+)?(?:wohnung|apartment|wg-zimmer|zimmer|haus)\b/i.test(
      text,
    ) ||
    /^\s*(?:wohnung|apartment|wg-zimmer|zimmer|haus)\s+gesucht\b/i.test(
      String(listing.title || ""),
    )
  );
}

function nonResidential(listing: any) {
  const title = String(listing.title || "").trim();
  return (
    /^(?:gewerbe(?:fläche)?|büro(?:fläche)?|praxis(?:fläche)?|laden(?:lokal)?|lager(?:fläche)?|stellplatz|garage|parkplatz)\b/i.test(
      title,
    ) ||
    /\b(?:gewerbefläche|bürofläche|praxisfläche|ladenlokal|lagerfläche)\b/i.test(
      title,
    )
  );
}

function propertyType(listing: any) {
  const text = listingText(listing);
  if (
    /tauschwohnung|tauschangebot|wohnungstausch|wohnung\s*[- ]?tausch|\btausche\b/i.test(
      text,
    )
  ) {
    return "Tauschwohnung";
  }
  if (/\bWG\b|WG-Zimmer|Zimmer zur Miete|roommate/i.test(text)) return "WG";
  if (/\bHaus\b|Einfamilienhaus|Reihenhaus|Doppelhaus|Villa/i.test(text)) {
    return "Haus";
  }
  return "Wohnung";
}

function activeStripeSubscription(subscription: any) {
  if (!subscription || !["active", "trialing"].includes(String(subscription.status))) {
    return false;
  }
  return (
    !subscription.current_period_end ||
    new Date(subscription.current_period_end).getTime() > Date.now()
  );
}

function effectivePremium(user: any, stripePremium: boolean) {
  if (user?.plan_override === "free") return false;
  if (
    user?.plan_override === "premium" &&
    (!user.plan_override_expires_at ||
      new Date(user.plan_override_expires_at).getTime() > Date.now())
  ) {
    return true;
  }
  if (
    user?.referral_bonus_until &&
    new Date(user.referral_bonus_until).getTime() > Date.now()
  ) {
    return true;
  }
  return stripePremium;
}

async function enrichDetails(listing: any, cache: Map<string, Promise<any>>) {
  const key = String(listing.id);
  const cached = cache.get(key);
  if (cached) return cached;

  const task = (async () => {
    const result = { ...listing };
    let detail = "";
    let warm = warmFromText(
      `${listing.title || ""} ${JSON.stringify(listing.raw || {}).slice(0, 8000)}`,
    );

    if (
      DETAIL_SOURCES.has(Number(listing.source_id)) &&
      listing.canonical_url &&
      (warm == null || Number(listing.source_id) === 2)
    ) {
      try {
        const response = await fetch(String(listing.canonical_url), {
          redirect: "follow",
          headers: {
            "user-agent": USER_AGENT,
            accept: "text/html,application/xhtml+xml,*/*",
            "accept-language": "de-DE,de;q=0.9",
            "cache-control": "no-cache",
          },
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          detail = await response.text();
          warm = warm ?? warmFromText(detail);
        }
      } catch {
        // Detail enrichment must never block delivery.
      }
    }

    const facts = detail
      ? detailFacts(detail)
      : { warm: null, cold: null, additional: null, heating: null };
    const cold = Number(listing.cold_rent);
    const patch: Record<string, unknown> = {};

    if (
      warm != null &&
      warm > 0 &&
      (!Number.isFinite(cold) || cold <= 0 || warm >= cold)
    ) {
      result.warm_rent = warm;
      patch.warm_rent = warm;
      patch.warm_rent_is_calculated = false;
    }
    if (facts.additional != null && facts.additional >= 0) {
      result.additional_costs = facts.additional;
      patch.additional_costs = facts.additional;
    }
    if (facts.heating != null && facts.heating >= 0) {
      result.heating_costs = facts.heating;
      patch.heating_costs = facts.heating;
    }
    if (facts.cold != null && facts.cold > 0) {
      result.cold_rent = facts.cold;
      patch.cold_rent = facts.cold;
    }

    if (Object.keys(patch).length) {
      await db.from("listings").update(patch).eq("id", listing.id);
    }
    return result;
  })().catch(() => listing);

  cache.set(key, task);
  return task;
}

function matches(profile: any, listing: any) {
  if (
    listing.is_primary_listing === false ||
    listing.quality_status === "rejected" ||
    listing.enrichment_delivery_eligible === false ||
    listing.enrichment_status !== "done" ||
    wantedAd(listing) ||
    nonResidential(listing)
  ) {
    return false;
  }

  const types: string[] = profile.property_types || [];
  if (types.length && !types.includes(propertyType(listing))) return false;

  if (profile.max_warm_rent != null) {
    const max = Number(profile.max_warm_rent);
    const warm = Number(listing.warm_rent);
    const cold = Number(listing.cold_rent);
    const knownWarm = Number.isFinite(warm) && warm > 0;
    const knownCold = Number.isFinite(cold) && cold > 0;
    if (!knownWarm && !knownCold) return false;
    if ((knownWarm ? warm : cold) > max) return false;
  }

  if (profile.require_known_warm_rent && !(Number(listing.warm_rent) > 0)) {
    return false;
  }
  if (
    profile.max_deposit != null &&
    listing.deposit != null &&
    Number(listing.deposit) > Number(profile.max_deposit)
  ) {
    return false;
  }
  if (profile.wbs_only && listing.wbs_required !== true) return false;
  if (profile.furnished_preference === "yes" && listing.furnished !== true) {
    return false;
  }
  if (profile.furnished_preference === "no" && listing.furnished !== false) {
    return false;
  }
  if (
    Number(profile.min_rooms || 0) > 0 &&
    listing.rooms != null &&
    Number(listing.rooms) < Number(profile.min_rooms)
  ) {
    return false;
  }
  if (
    Number(profile.min_area_sqm || 0) > 0 &&
    listing.area_sqm != null &&
    Number(listing.area_sqm) < Number(profile.min_area_sqm)
  ) {
    return false;
  }

  const mode = String(profile.location_mode || "");
  if (
    mode !== "all_hamburg" &&
    !(mode === "boroughs" && (profile.boroughs || []).length >= 7)
  ) {
    const selected = (
      mode === "neighborhoods"
        ? profile.neighborhoods || []
        : profile.districts || []
    ).map((value: string) => value.toLowerCase());
    const haystack = listingText(listing).toLowerCase();
    if (!selected.length || !selected.some((value: string) => haystack.includes(value))) {
      return false;
    }
  }
  return true;
}

function listingCaption(listing: any, language: string) {
  const lines = [
    `🏠 <b>${esc(
      String(listing.title || "Listing")
        .replace(/\s+/g, " ")
        .slice(0, 180),
    )}</b>`,
    "",
  ];

  const warm = money(listing.warm_rent);
  const cold = money(listing.cold_rent);
  if (warm) lines.push(`💶 <b>${esc(label(language, "warm"))}:</b> ${esc(warm)}`);
  if (cold && Number(listing.cold_rent) !== Number(listing.warm_rent)) {
    lines.push(`❄️ <b>${esc(label(language, "cold"))}:</b> ${esc(cold)}`);
  }

  for (const [emoji, key, value] of [
    ["🧾", "additional", listing.additional_costs],
    ["🏢", "operating", listing.operating_costs],
    ["🔥", "heating", listing.heating_costs],
  ] as any[]) {
    const formatted = money(value);
    if (formatted) {
      lines.push(`${emoji} <b>${esc(label(language, key))}:</b> ${esc(formatted)}`);
    }
  }

  const deposit = listing.deposit_text
    ? String(listing.deposit_text).trim()
    : money(listing.deposit);
  if (deposit) {
    lines.push(`🔐 <b>${esc(label(language, "deposit"))}:</b> ${esc(deposit)}`);
  }
  if (listing.area_sqm != null) {
    lines.push(
      `📐 <b>${esc(label(language, "area"))}:</b> ${esc(num(listing.area_sqm))} m²`,
    );
  }
  if (listing.rooms != null) {
    lines.push(
      `🚪 <b>${esc(label(language, "rooms"))}:</b> ${esc(num(listing.rooms, 1))}`,
    );
  }
  const location = address(listing);
  if (location) {
    lines.push(`📍 <b>${esc(label(language, "address"))}:</b> ${esc(location)}`);
  }
  return lines.join("\n");
}

function listingKeyboard(
  listing: any,
  language: string,
  premium: boolean,
  routeUrl?: string | null,
) {
  const rows: any[] = [
    [
      {
        text: listing.sources?.button_label
          ? `Zu ${listing.sources.button_label}`
          : label(language, "offer"),
        url: listing.canonical_url,
      },
    ],
  ];

  const map = mapsUrl(listing);
  if (map) rows.push([{ text: label(language, "maps"), url: map }]);
  if (routeUrl) rows.push([{ text: "🧭 Route zum Pendelziel", url: routeUrl }]);
  if (premium) {
    rows.push([
      { text: label(language, "save"), callback_data: `save:${listing.id}` },
    ]);
  }
  return { inline_keyboard: rows };
}

async function telegram(token: string, method: string, body: any) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (response.ok && result.ok) return result.result;
  throw new Error(
    `Telegram ${method} ${response.status}: ${String(result?.description || "failed").slice(0, 300)}`,
  );
}

async function sendListing(
  token: string,
  chatId: number,
  listing: any,
  language: string,
  premium: boolean,
  routeUrl?: string | null,
) {
  const images = [
    listing.image_status !== "fallback" ? listing.resolved_image_url : null,
    listing.image_url,
    listing.resolved_image_url,
  ]
    .filter(Boolean)
    .map(String)
    .filter((value: string, index: number, all: string[]) => all.indexOf(value) === index);

  let lastError: unknown = null;
  for (const image of images) {
    try {
      const message = await telegram(token, "sendPhoto", {
        chat_id: chatId,
        photo: image,
        caption: listingCaption(listing, language),
        parse_mode: "HTML",
        reply_markup: listingKeyboard(listing, language, premium, routeUrl),
      });
      return message?.message_id || null;
    } catch (error) {
      lastError = error;
    }
  }

  try {
    const message = await telegram(token, "sendMessage", {
      chat_id: chatId,
      text: listingCaption(listing, language),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: listingKeyboard(listing, language, premium, routeUrl),
    });
    return message?.message_id || null;
  } catch (error) {
    throw lastError || error;
  }
}

function parseTime(value: string | null | undefined) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function timezoneOffsetMs(date: Date, timezone: string) {
  const parts = zonedParts(date, timezone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - date.getTime();
}

function zonedDateToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 3; i++) {
    guess = Date.UTC(year, month - 1, day, hour, minute, 0) -
      timezoneOffsetMs(new Date(guess), timezone);
  }
  return new Date(guess);
}

function addLocalDays(parts: ReturnType<typeof zonedParts>, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function quietEndFor(date: Date, pref: any) {
  const start = parseTime(pref?.quiet_start);
  const end = parseTime(pref?.quiet_end);
  if (start == null || end == null || start === end) return null;

  const timezone = String(pref?.timezone || "Europe/Berlin");
  const parts = zonedParts(date, timezone);
  const current = parts.hour * 60 + parts.minute;
  const inQuiet = start < end
    ? current >= start && current < end
    : current >= start || current < end;
  if (!inQuiet) return null;

  const targetDay = start < end || current < end ? 0 : 1;
  const day = addLocalDays(parts, targetDay);
  return zonedDateToUtc(
    day.year,
    day.month,
    day.day,
    Math.floor(end / 60),
    end % 60,
    timezone,
  );
}

function nextDailyOccurrence(atOrAfter: Date, pref: any) {
  const target = parseTime(pref?.digest_time) ?? 18 * 60;
  const timezone = String(pref?.timezone || "Europe/Berlin");
  const parts = zonedParts(atOrAfter, timezone);
  const current = parts.hour * 60 + parts.minute;
  const day = addLocalDays(parts, current <= target ? 0 : 1);
  return zonedDateToUtc(
    day.year,
    day.month,
    day.day,
    Math.floor(target / 60),
    target % 60,
    timezone,
  );
}

function nextDeliveryDue(event: any, listing: any, premium: boolean, pref: any) {
  const now = new Date();
  const created = new Date(event.created_at || now);
  let due = Number.isFinite(created.getTime()) ? created : now;

  if (!premium && listing.first_seen_at) {
    const freeDue = new Date(
      new Date(listing.first_seen_at).getTime() + FREE_DELAY_MS,
    );
    if (Number.isFinite(freeDue.getTime()) && freeDue > due) due = freeDue;
  }

  if (pref?.delivery_mode === "hourly_digest") {
    const hourlyDue = new Date(created.getTime() + 60 * 60_000);
    if (Number.isFinite(hourlyDue.getTime()) && hourlyDue > due) due = hourlyDue;
  } else if (pref?.delivery_mode === "daily_digest") {
    due = nextDailyOccurrence(due, pref);
  }

  const quietEnd = quietEndFor(due > now ? due : now, pref);
  if (quietEnd && quietEnd > due) due = quietEnd;
  return due > now ? due : null;
}

function retryAt(attempt: number) {
  const minutes = Math.min(60, Math.pow(2, Math.max(1, attempt)));
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function recoverStaleEvents() {
  const stale = new Date(Date.now() - LEASE_MS).toISOString();
  const { error } = await db
    .from("delivery_events")
    .update({
      status: "failed",
      next_retry_at: new Date().toISOString(),
      error_message: "Recovered stale processing lease",
    })
    .eq("status", "processing")
    .lt("last_attempt_at", stale);
  if (error) throw error;
}

async function markSkipped(eventId: string, reason: string | null) {
  const { error } = await db
    .from("delivery_events")
    .update({
      status: "skipped",
      next_retry_at: null,
      error_message: reason,
    })
    .eq("id", eventId)
    .eq("status", "processing");
  if (error) throw error;
}

async function markFailure(event: any, error: unknown) {
  const attempts = Number(event.dispatch_attempts || 0) + 1;
  const { error: updateError } = await db
    .from("delivery_events")
    .update({
      status: "failed",
      dispatch_attempts: attempts,
      last_attempt_at: new Date().toISOString(),
      next_retry_at: retryAt(attempts),
      error_message: error instanceof Error ? error.message : String(error),
    })
    .eq("id", event.id)
    .eq("status", "processing");
  if (updateError) throw updateError;
}

async function claimEvent(event: any) {
  const { data, error } = await db
    .from("delivery_events")
    .update({ status: "processing", last_attempt_at: new Date().toISOString() })
    .eq("id", event.id)
    .eq("status", event.status)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function claimDigestEvents(seed: any, page: any[]) {
  const candidates = page
    .filter(
      (event: any) =>
        event.event_type !== "listing_changed" &&
        event.search_profiles?.id === seed.search_profiles?.id &&
        String(event.recipient_user_id) === String(seed.recipient_user_id),
    )
    .slice(0, 10);

  const claimed: any[] = [];
  for (const event of candidates) {
    if (event.id === seed.id) {
      claimed.push({ ...event, status: "processing" });
      continue;
    }
    if (await claimEvent(event)) claimed.push({ ...event, status: "processing" });
  }
  return claimed;
}

async function sentToday(profileId: string, recipientId: string, timezone: string) {
  const now = new Date();
  const parts = zonedParts(now, timezone);
  const localStart = zonedDateToUtc(
    parts.year,
    parts.month,
    parts.day,
    0,
    0,
    timezone,
  );
  const { count, error } = await db
    .from("delivery_events")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("recipient_user_id", recipientId)
    .eq("status", "sent")
    .gte("sent_at", localStart.toISOString());
  if (error) throw error;
  return count || 0;
}

function changeValue(field: string, value: unknown) {
  if (value == null || value === "") return "–";
  if (["warm_rent", "cold_rent", "deposit"].includes(field)) {
    return money(value) || "–";
  }
  if (field === "area_sqm") return `${num(value, 1)} m²`;
  if (field === "rooms") return `${num(value, 1)} Zimmer`;
  if (field === "is_active") return value ? "verfügbar" : "nicht mehr verfügbar";
  return String(value);
}

function changeLabel(field: string) {
  return (
    {
      warm_rent: "Warmmiete",
      cold_rent: "Kaltmiete",
      deposit: "Kaution",
      rooms: "Zimmer",
      area_sqm: "Fläche",
      available_from: "Einzugsdatum",
      canonical_url: "Angebotslink",
      is_active: "Verfügbarkeit",
    } as Record<string, string>
  )[field] || field;
}

async function sendChange(token: string, event: any, listing: any, recipient: any) {
  const change = Array.isArray(event.listing_changes)
    ? event.listing_changes[0]
    : event.listing_changes || {};
  const fields: string[] = change.changed_fields || [];
  const lines = [
    `🔄 <b>${esc(String(listing.title || "Gespeichertes Angebot").slice(0, 150))}</b>`,
    "",
    ...fields.map(
      (field) =>
        `<b>${esc(changeLabel(field))}:</b> ${esc(changeValue(field, change.old_values?.[field]))} → ${esc(changeValue(field, change.new_values?.[field]))}`,
    ),
  ];
  return telegram(token, "sendMessage", {
    chat_id: Number(recipient.chat_id),
    text: lines.join("\n"),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[{ text: "Inserat öffnen", url: listing.canonical_url }]],
    },
  });
}

async function run(token: string) {
  await recoverStaleEvents();
  const totals = {
    sent: 0,
    failed: 0,
    skipped: 0,
    claimed: 0,
    enriched: 0,
    deferred: 0,
  };
  const detailCache = new Map<string, Promise<any>>();
  const handled = new Set<string>();
  const premiumUsers = new Set<string>();

  const { data: subscriptions, error: subscriptionError } = await db
    .from("user_subscriptions")
    .select("user_id,status,current_period_end");
  if (subscriptionError) throw subscriptionError;
  for (const subscription of subscriptions || []) {
    if (activeStripeSubscription(subscription)) {
      premiumUsers.add(String(subscription.user_id));
    }
  }

  while (true) {
    const nowIso = new Date().toISOString();
    const { data: page, error } = await db
      .from("delivery_events")
      .select(
        "id,status,event_type,change_id,recipient_user_id,dedupe_key,dispatch_attempts,next_retry_at,created_at,listing_changes(changed_fields,old_values,new_values),recipient:bot_users!delivery_events_recipient_user_id_fkey(id,chat_id,is_active,ui_language),search_profiles!inner(id,user_id,profile_slot,household_id,property_types,max_warm_rent,min_rooms,min_area_sqm,max_deposit,require_known_warm_rent,wbs_only,furnished_preference,districts,location_mode,boroughs,neighborhoods,is_active,notification_preferences(delivery_mode,quiet_start,quiet_end,digest_time,timezone,daily_limit),owner:bot_users!search_profiles_user_id_fkey(id,is_active,plan_override,plan_override_expires_at,referral_bonus_until)),listings!inner(*,sources(button_label,source_type))",
      )
      .in("status", ["pending", "failed"])
      .lt("dispatch_attempts", MAX_ATTEMPTS)
      .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
      .order("created_at")
      .limit(PAGE_SIZE);
    if (error) throw error;
    if (!page?.length) break;

    let claimedThisPage = 0;
    for (const event of page) {
      if (handled.has(String(event.id))) continue;
      if (!(await claimEvent(event))) continue;
      claimedThisPage++;
      totals.claimed++;

      const profile = event.search_profiles as any;
      const owner = profile?.owner;
      const recipient = event.recipient as any;
      const baseListing = event.listings as any;
      const listing = await enrichDetails(baseListing, detailCache);
      const stripePremium = premiumUsers.has(String(owner?.id || ""));
      const premium = effectivePremium(owner, stripePremium);
      const pref = Array.isArray(profile?.notification_preferences)
        ? profile.notification_preferences[0]
        : profile?.notification_preferences;

      if (listing.warm_rent != null && baseListing.warm_rent == null) {
        totals.enriched++;
      }

      if (
        !profile?.is_active ||
        !owner?.is_active ||
        !recipient?.is_active ||
        (!premium && Number(profile.profile_slot || 1) > 1) ||
        (!premium && String(listing.sources?.source_type || "") === "Baugenossenschaft") ||
        !matches(profile, listing)
      ) {
        await markSkipped(
          event.id,
          !recipient?.is_active
            ? "Recipient inactive"
            : !premium && Number(profile?.profile_slot || 1) > 1
              ? "Premium profile inactive"
              : !premium &&
                    String(listing.sources?.source_type || "") === "Baugenossenschaft"
                ? "Premium source required"
                : listing?.is_primary_listing === false
                  ? "Suppressed by higher-priority duplicate"
                  : "No longer matches profile",
        );
        totals.skipped++;
        continue;
      }

      if (event.event_type === "listing_changed") {
        try {
          const result = await sendChange(token, event, listing, recipient);
          const { error: updateError } = await db
            .from("delivery_events")
            .update({
              status: "sent",
              telegram_message_id: result?.message_id || null,
              sent_at: new Date().toISOString(),
              last_attempt_at: new Date().toISOString(),
              dispatch_attempts: Number(event.dispatch_attempts || 0) + 1,
              error_message: null,
              next_retry_at: null,
            })
            .eq("id", event.id)
            .eq("status", "processing");
          if (updateError) throw updateError;
          totals.sent++;
        } catch (sendError) {
          await markFailure(event, sendError);
          totals.failed++;
        }
        continue;
      }

      const due = nextDeliveryDue(event, listing, premium, pref);
      if (due) {
        const { error: deferError } = await db
          .from("delivery_events")
          .update({
            status: "pending",
            next_retry_at: due.toISOString(),
            error_message: null,
          })
          .eq("id", event.id)
          .eq("status", "processing");
        if (deferError) throw deferError;
        totals.deferred++;
        continue;
      }

      let remainingLimit: number | null = null;
      if (pref?.daily_limit) {
        const timezone = String(pref.timezone || "Europe/Berlin");
        const limit = Number(pref.daily_limit);
        const count = await sentToday(profile.id, recipient.id, timezone);
        remainingLimit = Math.max(0, limit - count);
        if (remainingLimit <= 0) {
          const tomorrow = nextDailyOccurrence(
            new Date(Date.now() + 60_000),
            { digest_time: "00:00", timezone },
          );
          const { error: limitError } = await db
            .from("delivery_events")
            .update({
              status: "pending",
              next_retry_at: tomorrow.toISOString(),
              error_message: "Daily limit reached",
            })
            .eq("id", event.id)
            .eq("status", "processing");
          if (limitError) throw limitError;
          totals.deferred++;
          continue;
        }
      }

      if (pref && pref.delivery_mode !== "instant") {
        try {
          const claimedGroup = await claimDigestEvents(
            { ...event, status: "processing" },
            page,
          );
          for (const item of claimedGroup) handled.add(String(item.id));

          const validGroup: any[] = [];
          for (const item of claimedGroup) {
            const candidate = await enrichDetails(item.listings, detailCache);
            if (!matches(profile, candidate)) {
              await markSkipped(item.id, "No longer matches profile");
              totals.skipped++;
              continue;
            }
            validGroup.push({ ...item, listings: candidate });
          }

          let group = validGroup;
          if (remainingLimit != null && group.length > remainingLimit) {
            const overflow = group.slice(remainingLimit);
            group = group.slice(0, remainingLimit);
            const timezone = String(pref.timezone || "Europe/Berlin");
            const tomorrow = nextDailyOccurrence(
              new Date(Date.now() + 60_000),
              { digest_time: "00:00", timezone },
            );
            const { error: overflowError } = await db
              .from("delivery_events")
              .update({
                status: "pending",
                next_retry_at: tomorrow.toISOString(),
                error_message: "Daily limit reached",
              })
              .in("id", overflow.map((item: any) => item.id))
              .eq("status", "processing");
            if (overflowError) throw overflowError;
            totals.deferred += overflow.length;
          }
          if (!group.length) continue;

          const title = pref.delivery_mode === "daily_digest"
            ? "Tägliche Zusammenfassung"
            : "Stündliche Zusammenfassung";
          const lines = [
            `📬 <b>${title}</b>`,
            "",
            ...group.map(
              (item: any, index: number) =>
                `${index + 1}. <a href="${esc(item.listings?.canonical_url)}">${esc(String(item.listings?.title || "Wohnung").slice(0, 80))}</a>`,
            ),
          ];
          const message = await telegram(token, "sendMessage", {
            chat_id: Number(recipient.chat_id),
            text: lines.join("\n"),
            parse_mode: "HTML",
            disable_web_page_preview: true,
          });
          const ids = group.map((item: any) => item.id);
          const { error: digestError } = await db
            .from("delivery_events")
            .update({
              status: "sent",
              telegram_message_id: message?.message_id || null,
              sent_at: new Date().toISOString(),
              last_attempt_at: new Date().toISOString(),
              error_message: null,
              next_retry_at: null,
            })
            .in("id", ids)
            .eq("status", "processing");
          if (digestError) throw digestError;
          totals.sent += ids.length;
        } catch (digestError) {
          await markFailure(event, digestError);
          totals.failed++;
        }
        continue;
      }

      try {
        const { data: destination, error: destinationError } = await db
          .from("user_destinations")
          .select("address,transport_mode")
          .eq("user_id", recipient.id)
          .order("created_at")
          .limit(1)
          .maybeSingle();
        if (destinationError) throw destinationError;
        const listingAddress = address(listing);
        const routeUrl = destination && listingAddress
          ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(destination.address)}&destination=${encodeURIComponent(listingAddress)}&travelmode=${destination.transport_mode === "cycling" ? "bicycling" : destination.transport_mode}`
          : null;

        const messageId = await sendListing(
          token,
          Number(recipient.chat_id),
          listing,
          recipient.ui_language || "de",
          premium,
          routeUrl,
        );
        const { error: sentError } = await db
          .from("delivery_events")
          .update({
            status: "sent",
            telegram_message_id: messageId,
            sent_at: new Date().toISOString(),
            last_attempt_at: new Date().toISOString(),
            dispatch_attempts: Number(event.dispatch_attempts || 0) + 1,
            error_message: null,
            next_retry_at: null,
          })
          .eq("id", event.id)
          .eq("status", "processing");
        if (sentError) throw sentError;
        totals.sent++;
      } catch (sendError) {
        await markFailure(event, sendError);
        totals.failed++;
      }
    }

    if (page.length < PAGE_SIZE || claimedThisPage === 0) break;
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
    const token = await secret("telegram_bot_token_runtime");
    return Response.json({ ok: true, totals: await run(token) });
  } catch (error) {
    console.error(error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
