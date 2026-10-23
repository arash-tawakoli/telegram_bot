export { HH_ZIPS } from "../_shared/hamburg.ts";
import { HH_ZIPS } from "../_shared/hamburg.ts";
import { fetchProvider } from "./provider-fetch.ts";
import { checked } from "./checked.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const KEY =
  JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default ||
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const db = createClient(SUPABASE_URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
export const UA =
  "Mozilla/5.0 (compatible; TraumwohnungHamburgBot/13.0; +https://traumwohnunghamburg.de)";

export type Source = {
  id: number;
  name: string;
  source_type: string;
  tier: string;
  homepage_url: string | null;
  search_url: string | null;
  coverage_strategy: string;
  runtime_mode: string;
  baseline_completed_at: string | null;
  consecutive_failures: number;
  last_success_at?: string | null;
  search_capabilities?: any;
};
export type Connector = {
  priority: number;
  label: string;
  connector_kind: string;
  enumerable: boolean;
  shadow_only: boolean;
  config: any;
  warmed_at?: string | null;
};
export type Candidate = {
  key?: string;
  url: string;
  title?: string | null;
  address?: string | null;
  district?: string | null;
  city?: string | null;
  zip?: string | null;
  warm?: number | null;
  cold?: number | null;
  additional?: number | null;
  operating?: number | null;
  heating?: number | null;
  deposit?: number | null;
  depositText?: string | null;
  rooms?: number | null;
  area?: number | null;
  available?: string | null;
  type?: string | null;
  furnished?: boolean | null;
  wbs?: boolean | null;
  image?: string | null;
  raw?: any;
};
export const iso = () => new Date().toISOString();
export const emsg = (e: any) => (e instanceof Error ? e.message : String(e));
export async function internalSecret() {
  const { data, error } = await db.rpc("get_bot_secret", {
    secret_name: "internal_worker_secret",
  });
  if (error || !data) throw new Error("internal secret unavailable");
  return String(data);
}
export async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export function deNum(v: any) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
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
export function decode(s: string) {
  return s
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&sup2;|&#178;/gi, "²")
    .replace(/&euro;|&#8364;/gi, "€")
    .replace(/&auml;/gi, "ä")
    .replace(/&ouml;/gi, "ö")
    .replace(/&uuml;/gi, "ü")
    .replace(/&szlig;/gi, "ß");
}
export function strip(h: string) {
  return decode(h)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function absolute(base: string, href: string) {
  try {
    return new URL(decode(href), base).href.replace(/#.*$/, "");
  } catch {
    return null;
  }
}
export function hhZip(z: any) {
  return !z || HH_ZIPS.has(String(z));
}

type SchleswigHolsteinArea = { area_code: string; parent_code: string | null; name: string; area_type: string };
let shAreaLookup: Map<string, SchleswigHolsteinArea | null> | null = null;
function geoNameKey(value: any) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLocaleLowerCase("de-DE")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
async function loadSHAreaLookup() {
  if (shAreaLookup) return shAreaLookup;
  const [first, second, aliases] = await Promise.all([
    db.from("geo_areas").select("area_code,parent_code,name,area_type").eq("state_code", "SH").eq("is_active", true).in("area_type", ["municipality", "independent_city"]).order("area_code").range(0, 999),
    db.from("geo_areas").select("area_code,parent_code,name,area_type").eq("state_code", "SH").eq("is_active", true).in("area_type", ["municipality", "independent_city"]).order("area_code").range(1000, 1999),
    db.from("geo_area_aliases").select("alias,area_code"),
  ]);
  if (first.error) throw first.error;
  if (second.error) throw second.error;
  if (aliases.error) throw aliases.error;
  const rows = [...(first.data || []), ...(second.data || [])] as SchleswigHolsteinArea[];
  const byCode = new Map(rows.map((area) => [String(area.area_code), area]));
  const lookup = new Map<string, SchleswigHolsteinArea | null>();
  const add = (name: string, area: SchleswigHolsteinArea) => {
    const key = geoNameKey(name);
    if (!key) return;
    const previous = lookup.get(key);
    if (previous && previous.area_code !== area.area_code) lookup.set(key, null);
    else if (!lookup.has(key)) lookup.set(key, area);
  };
  for (const area of rows) add(area.name, area);
  for (const alias of aliases.data || []) {
    const area = byCode.get(String(alias.area_code));
    if (area) add(String(alias.alias), area);
  }
  shAreaLookup = lookup;
  return lookup;
}
async function resolveSHArea(c: Candidate): Promise<SchleswigHolsteinArea | null> {
  const values = [
    c.city,
    c.raw?.entry?.address?.city,
    c.raw?.entry?.address?.cityName,
    c.raw?.entry?.address?.town,
    c.raw?.entry?.city,
    c.district,
  ];
  const lookup = await loadSHAreaLookup();
  for (const value of values) {
    const candidate = String(value || "").split(/[;,]/)[0]
      .replace(/\\b(?:schleswig-holstein|deutschland|germany)\\b/ig, "")
      .trim();
    const key = geoNameKey(candidate);
    if (!key) continue;
    const area = lookup.get(key);
    if (area) return area;
  }
  return null;
}
function amountAfter(s: string, labels: string) {
  return deNum(
    s.match(
      new RegExp(
        `(?:${labels})\\s*(?:(?:[:=]|beträgt|ist|von)\\s*)?([\\d.]+(?:,\\d{1,2})?)\\s*€?`,
        "i",
      ),
    )?.[1],
  );
}
function amountBefore(s: string, labels: string) {
  return deNum(
    s.match(
      new RegExp(`([\\d.]+(?:,\\d{1,2})?)\\s*€\\s*(?:${labels})`, "i"),
    )?.[1],
  );
}
function saneRooms(v: any) {
  const n = deNum(v);
  return n != null && n >= 0.5 && n <= 20 ? n : null;
}
export function parseFields(t: string) {
  const s = decode(t).replace(/\s+/g, " ");
  const warm =
    amountBefore(s, "Warmmiete|Bruttowarmmiete|Bruttomiete|Gesamtmiete") ??
    amountAfter(
      s,
      "Warmmiete|Bruttowarmmiete|Bruttomiete|Gesamtmiete|Miete warm",
    );
  const cold =
    amountBefore(s, "Kaltmiete|Nettokaltmiete|Grundmiete|Nettomiete") ??
    amountAfter(s, "Kaltmiete|Nettokaltmiete|Grundmiete|Nettomiete") ??
    deNum(
      s.match(
        /([\d.]+(?:,\d{1,2})?)\s*€\s*Miete\s*zzgl\.?\s*(?:NK|Nebenkosten)/i,
      )?.[1],
    );
  const additional =
    amountBefore(s, "Nebenkosten|sonstige Kosten|Nebenkostenvorauszahlung") ??
    amountAfter(s, "Nebenkosten|sonstige Kosten|Nebenkostenvorauszahlung");
  const operating =
    amountBefore(s, "Betriebskosten|Betriebskostenvorauszahlung") ??
    amountAfter(s, "Betriebskosten|Betriebskostenvorauszahlung");
  const heating =
    amountBefore(s, "Heizkosten|Heizungskosten|Heizkostenvorauszahlung") ??
    amountAfter(s, "Heizkosten|Heizungskosten|Heizkostenvorauszahlung");
  const deposit =
    amountBefore(s, "Kaution|Mietkaution|Mietsicherheit") ??
    amountAfter(s, "Kaution|Mietkaution|Mietsicherheit");
  const rooms = saneRooms(
    s.match(/([\d.,]+)\s*(?:Zimmer|Zi\.?)(?:\b|\s)/i)?.[1] ??
      s.match(/(?:Zimmer|Zi\.?)\s*[:]?\s*([\d.,]+)/i)?.[1],
  );
  const area =
    deNum(s.match(/([\d.,]+)\s*m(?:²|2)/i)?.[1]) ??
    deNum(s.match(/(?:Wohnfläche|Fläche)\s*[:]?\s*([\d.,]+)/i)?.[1]);
  const zip = s.match(/\b(\d{5})\b/)?.[1] || null;
  return {
    warm,
    cold,
    additional,
    operating,
    heating,
    deposit,
    rooms,
    area,
    zip,
    wbs: /\bWBS\b|Wohnberechtigungsschein/i.test(s),
    furnished: /\bmöbliert\b/i.test(s) ? !/\bunmöbliert\b/i.test(s) : null,
  };
}
export function strongUrl(u: string) {
  return /\/expose\/|\/immobilie\/|\/property\/|\/room\/|\/s-anzeige\/|\/tauschangebot\/|\/rent-listing\/|\/immodetail\/|\/wohnung-mieten\//i.test(
    u,
  );
}
export async function fetchText(
  url: string,
  accept = "text/html,application/xhtml+xml,application/json,*/*",
  timeout = 12000,
) {
  let last: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    
    try {
      const r = await fetchProvider(url, {
        redirect: "follow",
        headers: {
          "user-agent": UA,
          accept,
          "accept-language": "de-DE,de;q=0.9",
          "cache-control": "no-cache",
        },
        signal: AbortSignal.timeout(timeout),
      }, SUPABASE_URL);
      if (!r.ok) {
        const e = new Error(`HTTP ${r.status} ${r.statusText}`);
        if (r.status >= 400 && r.status < 500 && r.status !== 429) throw e;
        last = e;
        continue;
      }
      return {
        text: await r.text(),
        url: r.url || url,
        ct: r.headers.get("content-type") || "",
      };
    } catch (e) {
      last = e;
      if (String(e).startsWith("Error: HTTP 4") && !String(e).includes("429"))
        throw e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
export async function fetchJson(url: string, init: RequestInit = {}) {
  const r = await fetchProvider(url, {
    redirect: "follow",
    ...init,
    headers: {
      "user-agent": UA,
      accept: "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(12000),
  }, SUPABASE_URL);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}
function cleanImage(base: string, raw: any) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const v = decode(raw.trim().split(/\s+/)[0]);
  if (/^data:/i.test(v)) return null;
  const u = absolute(base, v);
  if (
    !u ||
    /\.(?:svg)(?:[?#]|$)|(?:logo|favicon|sprite|spinner|placeholder|avatar)(?:[_.\/-]|$)/i.test(
      u,
    )
  )
    return null;
  return u;
}
function attr(tag: string, name: string) {
  return (
    tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] ||
    null
  );
}
function htmlImages(html: string, base: string) {
  const out: string[] = [];
  for (const m of html.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const tag = m[0];
    for (const n of [
      "data-src",
      "data-original",
      "src",
      "data-srcset",
      "srcset",
    ]) {
      const u = cleanImage(base, attr(tag, n));
      if (u && !out.includes(u)) out.push(u);
    }
  }
  return out;
}
export function imageFromHtml(html: string, base: string) {
  return htmlImages(html, base)[0] || null;
}
function meaningfulTitle(v: string) {
  const s = strip(v).replace(/\s+/g, " ").trim();
  if (
    s.length < 4 ||
    /^(?:mehr|mehr erfahren|details?|ansehen|anzeigen|zum angebot|angebot)$/i.test(
      s,
    )
  )
    return null;
  if (/(?:\bclass=|\bdata-[\w-]+=|<path\b|\btarget=|openModal|\\["'])/i.test(s))
    return null;
  return s;
}
export function parseHtml(html: string, base: string) {
  const out: Candidate[] = [],
    seen = new Set<string>();
  for (const m of html.matchAll(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    if (out.length >= 180) break;
    const u = absolute(base, m[1]);
    if (!u || seen.has(u)) continue;
    const idx = m.index || 0,
      chunk = html.slice(
        Math.max(0, idx - 900),
        Math.min(html.length, idx + m[0].length + 1800),
      ),
      text = strip(chunk).slice(0, 5000),
      f = parseFields(text);
    if (f.zip && !hhZip(f.zip)) continue;
    if (
      !strongUrl(u) &&
      [f.warm, f.cold, f.rooms, f.area].filter((x) => x != null).length < 2
    )
      continue;
    if (
      /\b(Stellplatz|Garage|Parkplatz|Gewerbe|Büro|Praxis|Lager)\b/i.test(
        text,
      ) &&
      !/Wohnung|Apartment|Zimmer/i.test(text)
    )
      continue;
    const anchorTitle = meaningfulTitle(
        attr(m[0], "title") || attr(m[0], "aria-label") || "",
      ),
      heading = meaningfulTitle(
        m[2].match(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] || "",
      ),
      anchorText = meaningfulTitle(m[2]);
    const directImage = imageFromHtml(m[0], base),
      nearbyImages = htmlImages(chunk, base),
      image =
        directImage || (nearbyImages.length === 1 ? nearbyImages[0] : null);
    out.push({
      url: u,
      title: (anchorTitle || heading || anchorText || "Wohnungsangebot").slice(
        0,
        240,
      ),
      zip: f.zip,
      warm: f.warm,
      cold: f.cold,
      additional: f.additional,
      operating: f.operating,
      heating: f.heating,
      deposit: f.deposit,
      rooms: f.rooms,
      area: f.area,
      wbs: f.wbs,
      furnished: f.furnished,
      image,
      raw: { text },
    });
    seen.add(u);
  }
  return out;
}
function firstString(...v: any[]) {
  return v.find((x) => typeof x === "string" && x.trim()) || null;
}
function jsonImage(v: any, base: string) {
  const direct = [
    v?.imageUrl,
    v?.imageURL,
    v?.thumbnailUrl,
    v?.pictureUrl,
    v?.photoUrl,
    v?.image,
    v?.thumbnail,
    v?.picture,
    v?.photo,
    v?.titleImage,
  ];
  for (const x of direct) {
    if (typeof x === "string") {
      const u = cleanImage(base, x);
      if (u) return u;
    }
    if (x && typeof x === "object" && !Array.isArray(x)) {
      const u = cleanImage(
        base,
        firstString(x.url, x.contentUrl, x.href, x.src),
      );
      if (u) return u;
    }
  }
  for (const arr of [v?.images, v?.pictures, v?.photos, v?.media])
    if (Array.isArray(arr))
      for (const x of arr) {
        const u =
          typeof x === "string"
            ? cleanImage(base, x)
            : cleanImage(
                base,
                firstString(x?.url, x?.contentUrl, x?.href, x?.src),
              );
        if (u) return u;
      }
  return null;
}
export function collectJson(v: any, base: string, out: Candidate[], depth = 0) {
  if (v == null || depth > 9 || out.length > 220) return;
  if (Array.isArray(v)) {
    for (const x of v) collectJson(x, base, out, depth + 1);
    return;
  }
  if (typeof v !== "object") return;
  const rawUrl = [
    "url",
    "href",
    "link",
    "detailUrl",
    "canonicalUrl",
    "seoUrl",
    "exposeUrl",
    "applicationLink",
  ]
    .map((k) => v[k])
    .find((x) => typeof x === "string");
  const u = rawUrl ? absolute(base, rawUrl) : null;
  const title = firstString(v.title, v.headline, v.objectTitle, v.name);
  const av = v.address && typeof v.address === "object" ? v.address : {};
  const street = firstString(
      av.street,
      av.streetAddress,
      v.street,
      v.streetAddress,
    ),
    house = firstString(av.houseNumber, v.houseNumber),
    zip =
      String(
        av.zipCode ||
          av.postalCode ||
          v.zipCode ||
          v.postalCode ||
          v.postalcode ||
          v.zip ||
          "",
      ) || null,
    city = firstString(av.city, av.addressLocality, v.city, v.addressLocality),
    district = firstString(av.district, v.district);
  const warm = deNum(
      v.totalRentGross ??
        v.warmRent ??
        v.totalRent ??
        v.grossRent ??
        v.monthlyTotalRent,
    ),
    cold = deNum(
      v.coldRent ??
        v.netRent ??
        v.baseRent ??
        v.netColdRent ??
        v.rent ??
        v.price,
    ),
    additional = deNum(
      v.additionalCosts ??
        v.additionalCost ??
        v.ancillaryCosts ??
        v.serviceCosts ??
        v.nebenkosten,
    ),
    operating = deNum(v.operatingCosts ?? v.operatingCost ?? v.betriebskosten),
    heating = deNum(v.heatingCosts ?? v.heatingCost ?? v.heizkosten),
    deposit = deNum(v.deposit ?? v.securityDeposit ?? v.kaution),
    rooms = saneRooms(v.totalRooms ?? v.rooms ?? v.numberOfRooms),
    area = deNum(
      v.size ?? v.livingSpace ?? v.area ?? v.overallSpace ?? v.floorSize?.value,
    ),
    image = jsonImage(v, base);
  if (
    u &&
    hhZip(zip) &&
    ([warm, cold, rooms, area].some((x) => x != null) || strongUrl(u))
  ) {
    const address = [street, house].filter(Boolean).join(" "),
      fallbackTitle = address
        ? `Wohnung ${address}${zip ? `, ${zip} Hamburg` : ""}`
        : null;
    out.push({
      key:
        String(
          v.objectId || v.externalId || v.id || v.identifier || v.guid || "",
        ) || undefined,
      url: u,
      title: (title || fallbackTitle)?.slice(0, 240) || null,
      address: typeof v.address === 'string' && v.address.trim() ? v.address : address
        ? zip
          ? `${address}, ${zip} ${city && /hamburg/i.test(city) ? city : "Hamburg"}`
          : address
        : null,
      district,
      zip,
      warm,
      cold,
      additional,
      operating,
      heating,
      deposit,
      rooms,
      area,
      wbs: !!(v.wbs || v.wbsRequired),
      image,
      raw: v,
    });
  }
  for (const x of Object.values(v)) collectJson(x, base, out, depth + 1);
}
const BAD_CANONICAL_URL =
  /\.(?:css|js|jpg|jpeg|png|webp|gif|svg|ico|pdf)(?:[?#]|$)|(?:maps\.app\.goo\.gl|google\.[^/]+\/maps)|\/(?:impressum|datenschutz|kontakt|cookie(?:-erklaerung)?|barrierefreiheit)(?:[/?#]|$)/i;
const NON_RESIDENTIAL =
  /\b(?:Stellplatz|Garage|Parkplatz|Parkhaus|Gewerbe|Büro|Praxis|Lager|Halle|Laden|Grundstück)\b/i;
const RESIDENTIAL =
  /\b(?:Wohnung|Apartment|Appartement|Zimmer|Studio|Loft|Maisonette|Mietwohnung|Wohnen|Haus|Einfamilienhaus|Reihenhaus|Doppelhaushälfte|Doppelhaus|Villa)\b/i;
function validCandidate(source: Source, c: Candidate) {
  if (!c.url || BAD_CANONICAL_URL.test(c.url)) return false;
  if (source.id === 8 && !/\/wohnungssuche\/hamburg\//i.test(c.url))
    return false;
  if (source.id === 21 && !/^https:\/\/www\.tauschwohnung\.com\/wohnung-mieten\/hamburg\//i.test(c.url) && !(c.raw?.provider === 'tauschwohnung_catalog' && c.key && c.url === `https://www.tauschwohnung.com/expose/${c.key}` && c.zip && hhZip(c.zip)))
    return false;
  if (source.id === 52 && /stellplatz|garage|parkplatz/i.test(c.url)) return false;
  if (source.search_capabilities?.region_state_code === "SH") {
    if (!(c.city || c.raw?.entry?.address?.city || c.raw?.entry?.address?.cityName || c.district)) return false;
  } else if (c.zip && !hhZip(c.zip)) return false;
  const text = `${c.title || ""} ${c.type || ""} ${c.raw?.text || ""}`;
  if (NON_RESIDENTIAL.test(text) && !RESIDENTIAL.test(text)) return false;
  return true;
}
async function normalize(
  source: Source,
  c: Candidate,
  freshDeliveryEligible: boolean,
) {
  const isSH = source.search_capabilities?.region_state_code === "SH";
  const shArea = isSH ? await resolveSHArea(c) : null;
  if (isSH && !shArea) return null;
  let canonicalUrl = c.url,
    keySeed = c.key || null;
  if (source.id === 10) {
    try {
      const u = new URL(canonicalUrl);
      u.searchParams.delete("dataLayerKey");
      canonicalUrl = u.href;
      keySeed = keySeed || u.pathname.split("/").filter(Boolean).at(-1) || null;
    } catch {}
  }
  const key = String(
      keySeed ||
        canonicalUrl.split("/").filter(Boolean).at(-1) ||
        (await sha(canonicalUrl)),
    ).slice(0, 500),
    address = c.address || null,
    basis = address
      ? `${address.toLowerCase()}|${c.warm ?? c.cold ?? ""}|${c.rooms ?? ""}|${c.area ?? ""}`
      : "";
  return {
    source_id: source.id,
    source_listing_key: key,
    external_id: c.key || null,
    canonical_url: canonicalUrl,
    title: c.title || null,
    address,
    district: c.district || null,
    postal_code: c.zip || null,
    city: isSH ? shArea!.name : "Hamburg",
    ...(isSH ? { state_code: "SH", admin_region_code: shArea!.parent_code, municipality_code: shArea!.area_code } : {}),
    warm_rent: c.warm ?? null,
    cold_rent: c.cold ?? null,
    additional_costs: c.additional ?? null,
    operating_costs: c.operating ?? null,
    heating_costs: c.heating ?? null,
    deposit: c.deposit ?? null,
    deposit_text: c.depositText ?? null,
    rooms: saneRooms(c.rooms),
    area_sqm: c.area != null && Number(c.area) > 0 ? c.area : null,
    available_from: c.available || null,
    property_type: (() => {
      if (c.type) return c.type;
      const classification = c.raw?._classification;
      if (classification?.version === 1) {
        if (classification.mode === "swap") return "Tauschwohnung";
        if (classification.kind === "house") return "Haus";
        if (classification.kind === "room") return "WG";
        if (classification.kind === "apartment") return "Wohnung";
        return null;
      }
      const kinds = Array.isArray(source.search_capabilities?.configured_kinds) ? source.search_capabilities.configured_kinds : [];
      const modes = Array.isArray(source.search_capabilities?.offer_modes) ? source.search_capabilities.offer_modes : [];
      if (modes.length === 1 && modes[0] === "swap") return "Tauschwohnung";
      if (kinds.length === 1) return kinds[0] === "house" ? "Haus" : kinds[0] === "room" ? "WG" : kinds[0] === "apartment" ? "Wohnung" : null;
      return null;
    })(),
    furnished: c.furnished ?? null,
    wbs_required: c.wbs ?? false,
    image_url: c.image || null,
    cross_source_hash: basis ? await sha(basis) : null,
    raw: c.raw || {},
    fresh_delivery_eligible: freshDeliveryEligible && c.raw?.provider_registry_mode !== "passive",
    last_seen_at: iso(),
    is_active: true,
  };
}
export async function upsertCandidates(
  source: Source,
  cands: Candidate[],
  freshDeliveryEligible = false,
  presenceEpoch: string | null = null,
) {
  const map = new Map<string, any>();
  for (const c of cands) {
    if (!validCandidate(source, c)) continue;
    try {
      const r = await normalize(source, c, freshDeliveryEligible);
      if (!r) continue;
      map.set(r.source_listing_key, r);
    } catch {}
  }
  const rows = [...map.values()];
  if (!rows.length) return { seen: 0, fresh: 0, keys: [] as string[] };
  let fresh = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const result = checked(
      await db.rpc("ingest_listing_batch_v3", {
        p_source_id: source.id,
        p_rows: rows.slice(i, i + 100),
        p_presence_epoch: presenceEpoch,
      }),
      "ingest listing batch v3",
    );
    fresh += Number(result.fresh);
  }
  return {
    seen: rows.length,
    fresh,
    keys: rows.map((r: any) => String(r.source_listing_key)),
  };
}
export async function markSuccess(
  source: Source,
  started: string,
  connector: Connector | null,
  fetched: number,
  fresh: number,
  metadata: any = {},
) {
  const t = iso(), complete = metadata.complete !== false;
  checked(await db.rpc("record_crawl_result", {
    p_source_id: source.id, p_started_at: started, p_finished_at: t, p_success: true,
    p_connector_priority: connector?.priority || 1,
    p_connector_label: connector?.label || source.coverage_strategy,
    p_fetched_count: fetched, p_inserted_count: fresh, p_error: null,
    p_metadata: {
      architecture: "v3", outcome: fetched > 0 ? "success_with_listing" : "success_no_inventory",
      baseline_initialized: !source.baseline_completed_at && complete, ...metadata,
    },
  }), "record successful crawl");
}
export async function markFailure(source: Source, started: string, e: any) {
  const s = emsg(e);
  checked(await db.rpc("record_crawl_result", {
    p_source_id: source.id, p_started_at: started, p_finished_at: iso(), p_success: false,
    p_connector_priority: null, p_connector_label: null,
    p_fetched_count: 0, p_inserted_count: 0, p_error: s.slice(0, 1500),
    p_metadata: { architecture: "v3", outcome: "connector_error" },
  }), "record failed crawl");
  return { ok: false, source_id: source.id, error: s };
}
