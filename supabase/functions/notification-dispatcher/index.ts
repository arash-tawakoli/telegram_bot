import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { label } from "./labels.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const ADMIN_KEY = KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const LEASE = 120000,
  PAGE = 200,
  FREE_DELAY_MS = 2 * 60 * 60 * 1000,
  UA =
    "Mozilla/5.0 (compatible; TraumwohnungHamburgBot/13.0; +https://traumwohnung-hamburg.de)";
const DETAIL_SOURCES = new Set([2, 15, 16]);
async function secret(n: string) {
  const { data, error } = await db.rpc("get_bot_secret", { secret_name: n });
  if (error || !data) throw new Error(`secret ${n} unavailable`);
  return String(data);
}
function esc(v: any) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function money(v: any) {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x)
    ? `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(x)} €`
    : String(v);
}
function num(v: any, m = 2) {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x)
    ? new Intl.NumberFormat("de-DE", { maximumFractionDigits: m }).format(x)
    : String(v);
}
function deNum(v: any) {
  if (v == null || v === "") return null;
  let s = String(v)
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
function attrNum(input: string, key: string) {
  return deNum(
    input.match(new RegExp(`${key}_(?:i|d|s)\\s*:\\s*([\\d.,]+)`, `i`))?.[1],
  );
}
function detailFacts(input: string) {
  return {
    warm: attrNum(input, "warmmiete"),
    cold: attrNum(input, "kaltmiete"),
    additional: attrNum(input, "nebenkosten"),
    heating: attrNum(input, "heizkosten"),
  };
}
function warmFromText(input: string) {
  const structured = detailFacts(input).warm;
  if (structured != null) return structured;
  const s = plain(input);
  const before = s.match(
    /([\d.]+(?:,\d{1,2})?)\s*(?:€|EUR)\s*(?:inkl\.?\s*(?:NK|Nebenkosten)|inklusive\s+Nebenkosten|Warmmiete|Bruttowarmmiete|Bruttomiete|Gesamtmiete)/i,
  )?.[1];
  if (before) return deNum(before);
  const after = s.match(
    /(?:Warmmiete|Bruttowarmmiete|Bruttomiete|Gesamtmiete|Miete\s*warm|Miete\s*inkl\.?\s*(?:NK|Nebenkosten)|warm\s*rent)\s*(?:(?:[:=]|beträgt|ist)\s*)?([\d.]+(?:,\d{1,2})?)\s*(?:€|EUR)?/i,
  )?.[1];
  return deNum(after);
}
function address(l: any) {
  if (l.address && String(l.address).trim()) return String(l.address).trim();
  const p = [l.district, l.postal_code, l.city || "Hamburg"].filter(Boolean);
  return p.length ? p.join(", ") : null;
}
function maps(l: any) {
  const a = address(l);
  return a
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}`
    : null;
}
function listingText(l: any) {
  return `${l.property_type || ""} ${l.title || ""} ${l.district || ""} ${l.address || ""} ${JSON.stringify(l.raw || {}).slice(0, 6000)}`;
}
function wanted(l: any) {
  const h = listingText(l);
  return (
    /(?:^|\s)(?:ich|wir)\s+suche(?:n)?\s+.{0,40}(?:wohnung|apartment|wg-zimmer|zimmer|haus)\b/i.test(
      h,
    ) ||
    /\bsucht\s+(?:dringend\s+)?(?:eine[nr]?\s+)?(?:wohnung|apartment|wg-zimmer|zimmer|haus)\b/i.test(
      h,
    ) ||
    /^\s*(?:wohnung|apartment|wg-zimmer|zimmer|haus)\s+gesucht\b/i.test(
      String(l.title || ""),
    )
  );
}
function nonResidential(l: any) {
  const t = String(l.title || "").trim();
  return (
    /^(?:gewerbe(?:fläche)?|büro(?:fläche)?|praxis(?:fläche)?|laden(?:lokal)?|lager(?:fläche)?|stellplatz|garage|parkplatz)\b/i.test(
      t,
    ) ||
    /\b(?:gewerbefläche|bürofläche|praxisfläche|ladenlokal|lagerfläche)\b/i.test(
      t,
    )
  );
}
function type(l: any) {
  const h = listingText(l);
  if (
    /tauschwohnung|tauschangebot|wohnungstausch|wohnung\s*[- ]?tausch|\btausche\b/i.test(
      h,
    )
  )
    return "Tauschwohnung";
  if (/\bWG\b|WG-Zimmer|Zimmer zur Miete|roommate/i.test(h)) return "WG";
  if (/\bHaus\b|Einfamilienhaus|Reihenhaus|Doppelhaus|Villa/i.test(h))
    return "Haus";
  return "Wohnung";
}
function premiumRow(s: any) {
  if (!s || !["active", "trialing"].includes(String(s.status || "")))
    return false;
  return (
    !s.current_period_end ||
    new Date(s.current_period_end).getTime() > Date.now()
  );
}
async function enrichDetails(l: any, cache: Map<string, Promise<any>>) {
  const key = String(l.id);
  const hit = cache.get(key);
  if (hit) return hit;
  const task = (async () => {
    let x = { ...l },
      detail = "",
      warm = warmFromText(
        `${l.title || ""} ${JSON.stringify(l.raw || {}).slice(0, 8000)}`,
      );
    if (
      DETAIL_SOURCES.has(Number(l.source_id)) &&
      l.canonical_url &&
      (warm == null || Number(l.source_id) === 2)
    ) {
      try {
        const r = await fetch(String(l.canonical_url), {
          redirect: "follow",
          headers: {
            "user-agent": UA,
            accept: "text/html,application/xhtml+xml,*/*",
            "accept-language": "de-DE,de;q=0.9",
            "cache-control": "no-cache",
          },
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          detail = await r.text();
          warm = warm ?? warmFromText(detail);
        }
      } catch {
        /* best-effort */
      }
    }
    const facts = detail
        ? detailFacts(detail)
        : { warm: null, cold: null, additional: null, heating: null },
      cold = Number(l.cold_rent),
      patch: any = {};
    if (
      warm != null &&
      warm > 0 &&
      (!Number.isFinite(cold) || cold <= 0 || warm >= cold)
    ) {
      x.warm_rent = warm;
      patch.warm_rent = warm;
      patch.warm_rent_is_calculated = false;
    }
    if (facts.additional != null && facts.additional >= 0) {
      x.additional_costs = facts.additional;
      patch.additional_costs = facts.additional;
    }
    if (facts.heating != null && facts.heating >= 0) {
      x.heating_costs = facts.heating;
      patch.heating_costs = facts.heating;
    }
    if (facts.cold != null && facts.cold > 0) {
      x.cold_rent = facts.cold;
      patch.cold_rent = facts.cold;
    } else if (
      Number(l.source_id) === 2 &&
      warm != null &&
      Number.isFinite(cold) &&
      cold === warm &&
      (facts.additional || facts.heating)
    ) {
      x.cold_rent = null;
    }
    if (Object.keys(patch).length)
      await db.from("listings").update(patch).eq("id", l.id);
    return x;
  })().catch(() => l);
  cache.set(key, task);
  return task;
}
function match(p: any, l: any) {
  if (
    l.is_primary_listing === false ||
    l.quality_status === "rejected" ||
    l.enrichment_delivery_eligible === false ||
    l.enrichment_status !== "done" ||
    wanted(l) ||
    nonResidential(l)
  )
    return false;
  const ts: string[] = p.property_types || [];
  if (ts.length && !ts.includes(type(l))) return false;
  if (p.max_warm_rent != null) {
    const max = Number(p.max_warm_rent),
      warm = Number(l.warm_rent),
      cold = Number(l.cold_rent),
      hasWarm = Number.isFinite(warm) && warm > 0,
      hasCold = Number.isFinite(cold) && cold > 0;
    if (!hasWarm && !hasCold) return false;
    if ((hasWarm ? warm : cold) > max) return false;
  }
  if (
    Number(p.min_rooms || 0) > 0 &&
    l.rooms != null &&
    Number(l.rooms) < Number(p.min_rooms)
  )
    return false;
  if (
    Number(p.min_area_sqm || 0) > 0 &&
    l.area_sqm != null &&
    Number(l.area_sqm) < Number(p.min_area_sqm)
  )
    return false;
  const mode = String(p.location_mode || "");
  if (
    mode !== "all_hamburg" &&
    !(mode === "boroughs" && (p.boroughs || []).length >= 7)
  ) {
    const ds = (
      mode === "neighborhoods" ? p.neighborhoods || [] : p.districts || []
    ).map((x: string) => x.toLowerCase());
    const h = listingText(l).toLowerCase();
    if (!ds.length || !ds.some((x: string) => h.includes(x))) return false;
  }
  return true;
}
function caption(l: any, lang: string) {
  const lines = [
    `🏠 <b>${esc(
      String(l.title || "Listing")
        .replace(/\s+/g, " ")
        .slice(0, 180),
    )}</b>`,
    "",
  ];
  const warm = money(l.warm_rent),
    cold = money(l.cold_rent);
  if (warm) lines.push(`💶 <b>${esc(label(lang, "warm"))}:</b> ${esc(warm)}`);
  if (cold && Number(l.cold_rent) !== Number(l.warm_rent))
    lines.push(`❄️ <b>${esc(label(lang, "cold"))}:</b> ${esc(cold)}`);
  for (const [e, k, v] of [
    ["🧾", "additional", l.additional_costs],
    ["🏢", "operating", l.operating_costs],
    ["🔥", "heating", l.heating_costs],
  ] as any[]) {
    const x = money(v);
    if (x) lines.push(`${e} <b>${esc(label(lang, k))}:</b> ${esc(x)}`);
  }
  const d = l.deposit_text ? String(l.deposit_text).trim() : money(l.deposit);
  if (d) lines.push(`🔐 <b>${esc(label(lang, "deposit"))}:</b> ${esc(d)}`);
  if (l.area_sqm != null)
    lines.push(
      `📐 <b>${esc(label(lang, "area"))}:</b> ${esc(num(l.area_sqm))} m²`,
    );
  if (l.rooms != null)
    lines.push(
      `🚪 <b>${esc(label(lang, "rooms"))}:</b> ${esc(num(l.rooms, 1))}`,
    );
  const a = address(l);
  if (a) lines.push(`📍 <b>${esc(label(lang, "address"))}:</b> ${esc(a)}`);
  return lines.join("\n");
}
function keyboard(l: any, lang: string, premium: boolean) {
  const rows: any[] = [
      [
        {
          text: l.sources?.button_label
            ? `Zu ${l.sources.button_label}`
            : label(lang, "offer"),
          url: l.canonical_url,
        },
      ],
    ],
    m = maps(l);
  if (m) rows.push([{ text: label(lang, "maps"), url: m }]);
  if (premium)
    rows.push([{ text: label(lang, "save"), callback_data: `save:${l.id}` }]);
  return { inline_keyboard: rows };
}
async function tg(token: string, method: string, body: any) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (r.ok && j.ok) return j.result;
  throw new Error(
    `Telegram ${method} ${r.status}: ${String(j?.description || "failed").slice(0, 300)}`,
  );
}
async function sendListing(
  token: string,
  chat: number,
  l: any,
  lang: string,
  premium: boolean,
) {
  const urls = [
    l.image_status !== "fallback" ? l.resolved_image_url : null,
    l.image_url,
    l.resolved_image_url,
  ]
    .filter(Boolean)
    .map(String)
    .filter((x: string, i: number, a: string[]) => a.indexOf(x) === i);
  let last: any = null;
  for (const u of urls) {
    try {
      const r = await tg(token, "sendPhoto", {
        chat_id: chat,
        photo: u,
        caption: caption(l, lang),
        parse_mode: "HTML",
        reply_markup: keyboard(l, lang, premium),
      });
      return r?.message_id || null;
    } catch (e) {
      last = e;
    }
  }
  try {
    const r = await tg(token, "sendMessage", {
      chat_id: chat,
      text: caption(l, lang),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: keyboard(l, lang, premium),
    });
    return r?.message_id || null;
  } catch (e) {
    throw last || e;
  }
}
async function recover() {
  const stale = new Date(Date.now() - LEASE).toISOString();
  await db
    .from("delivery_events")
    .update({
      status: "failed",
      next_retry_at: new Date().toISOString(),
      error_message: "Recovered stale processing lease",
    })
    .eq("status", "processing")
    .lt("last_attempt_at", stale);
}
async function run(token: string) {
  await recover();
  const totals = {
    sent: 0,
    failed: 0,
    skipped: 0,
    claimed: 0,
    enriched: 0,
    deferred: 0,
  };
  const detailCache = new Map<string, Promise<any>>();
  const premiumUsers = new Set<string>();
  const { subs, error: subErr } = {
    subs: (
      await db
        .from("user_subscriptions")
        .select("user_id,status,current_period_end")
    ).data,
    error: await Promise.resolve(null),
  };
  if (subErr) throw subErr;
  for (const s of subs || [])
    if (premiumRow(s)) premiumUsers.add(String(s.user_id));
  while (true) {
    const iso = new Date().toISOString();
    const { data, error } = await db
      .from("delivery_events")
      .select(
        "id,status,dispatch_attempts,next_retry_at,created_at,search_profiles!inner(id,profile_slot,property_types,max_warm_rent,min_rooms,min_area_sqm,districts,location_mode,boroughs,neighborhoods,is_active,bot_users!inner(id,chat_id,is_active,ui_language,plan_override)),listings!inner(*,sources(button_label,source_type))",
      )
      .in("status", ["pending", "failed"])
      .lt("dispatch_attempts", 5)
      .or(`next_retry_at.is.null,next_retry_at.lte.${iso}`)
      .order("created_at")
      .limit(PAGE);
    if (error) throw error;
    if (!data?.length) break;
    let claimed = 0;
    for (const e of data) {
      const at = new Date().toISOString();
      const { data: c } = await db
        .from("delivery_events")
        .update({ status: "processing", last_attempt_at: at })
        .eq("id", e.id)
        .eq("status", e.status)
        .select("id")
        .maybeSingle();
      if (!c) continue;
      claimed++;
      totals.claimed++;
      const p = e.search_profiles,
        u = p?.bot_users,
        base = e.listings,
        l = await enrichDetails(base, detailCache),
        stripePremium = premiumUsers.has(String(u?.id || "")),
        premium =
          u?.plan_override === "premium"
            ? true
            : u?.plan_override === "free"
              ? false
              : stripePremium;
      if (l.warm_rent != null && base.warm_rent == null) totals.enriched++;
      if (
        !p?.is_active ||
        !u?.is_active ||
        (!premium && Number(p.profile_slot || 1) > 1) ||
        (!premium &&
          String(l.sources?.source_type || "") === "Baugenossenschaft") ||
        !match(p, l)
      ) {
        await db
          .from("delivery_events")
          .update({
            status: "skipped",
            next_retry_at: null,
            error_message:
              !premium && Number(p?.profile_slot || 1) > 1
                ? "Premium profile inactive"
                : !premium &&
                    String(l.sources?.source_type || "") === "Baugenossenschaft"
                  ? "Premium source required"
                  : l?.is_primary_listing === false
                    ? "Suppressed by higher-priority duplicate"
                    : null,
          })
          .eq("id", e.id)
          .eq("status", "processing");
        totals.skipped++;
        continue;
      }
      if (!premium) {
        const first = Date.parse(String(l.first_seen_at || ""));
        if (Number.isFinite(first)) {
          const due = first + FREE_DELAY_MS;
          if (due > Date.now()) {
            await db
              .from("delivery_events")
              .update({
                status: "pending",
                next_retry_at: new Date(due).toISOString(),
                error_message: null,
              })
              .eq("id", e.id)
              .eq("status", "processing");
            totals.deferred++;
            continue;
          }
        }
      }
      try {
        const mid = await sendListing(
          token,
          Number(u.chat_id),
          l,
          u.ui_language || "de",
          premium,
        );
        await db
          .from("delivery_events")
          .update({
            status: "sent",
            telegram_message_id: mid,
            sent_at: new Date().toISOString(),
            last_attempt_at: new Date().toISOString(),
            dispatch_attempts: Number(e.dispatch_attempts || 0) + 1,
            error_message: null,
            next_retry_at: null,
          })
          .eq("id", e.id)
          .eq("status", "processing");
        totals.sent++;
      } catch (err) {
        const a = Number(e.dispatch_attempts || 0) + 1;
        await db
          .from("delivery_events")
          .update({
            status: "failed",
            dispatch_attempts: a,
            last_attempt_at: new Date().toISOString(),
            next_retry_at: new Date(
              Date.now() + Math.min(60, Math.pow(2, a)) * 60000,
            ).toISOString(),
            error_message: err instanceof Error ? err.message : String(err),
          })
          .eq("id", e.id)
          .eq("status", "processing");
        totals.failed++;
      }
    }
    if (data.length < PAGE || claimed === 0) break;
  }
  return totals;
}
Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST")
      return new Response("method not allowed", { status: 405 });
    if (
      (req.headers.get("x-internal-secret") || "") !==
      (await secret("internal_worker_secret"))
    )
      return new Response("unauthorized", { status: 401 });
    const token = await secret("telegram_bot_token_runtime");
    return Response.json({ ok: true, totals: await run(token) });
  } catch (e) {
    console.error(e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});
