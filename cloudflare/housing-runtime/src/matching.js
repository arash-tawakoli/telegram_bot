import { hasRetainedApplicationKey, rememberApplicationKey } from "./application-dedupe.js";
import { applicationProvider, missingApplicantFields, premiumParticipant, timestampMillis } from "./application-policy.js";
import { applicationIdempotencyKey, sourceForId } from "./source-allowlist.js";
import { BERLIN_BOROUGHS, berlinBoroughFor } from "./berlin-geography.js";

const enabled = value => value === true || value === 1;

function number(value) {
  if (value == null || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function object(value) {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try { return JSON.parse(value || "{}") || {}; } catch { return {}; }
  }
  return {};
}

const normalize = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase("de-DE").trim();
const list = value => Array.isArray(value) ? value : [];

function listingCategory(facts) {
  const label = normalize([facts?.property_type, facts?.property_kind, facts?.offer_mode, facts?.title].filter(Boolean).join(" "));
  if (/\b(verkauf|kaufpreis|zum kauf|mietkauf|erbpacht)\b/.test(label) || /\b(wohnung|apartment|wg[ -]*zimmer|zimmer|haus)\s+gesucht\b/.test(label) || /\b(ich|wir)\s+suche(?:n)?\s+.{0,50}(wohnung|apartment|wg[ -]*zimmer|zimmer|haus)/.test(label)) return null;
  if (/tauschwohnung|wohnungstausch|tauschangebot|\bswap\b/.test(label) && !/(kein(?:e|en)?|ohne)\s+(tauschwohnung|wohnungstausch|tausch)/.test(label)) return "Tauschwohnung";
  if (/wohnen[ -]+auf[ -]+zeit|zeitwohnen|temporary[ -]+rent|\bwg\b|wohngemeinschaft|wg-zimmer|\broom\b/.test(label)) return "WG";
  const explicit = normalize(facts?.property_type || facts?.property_kind);
  if (["haus", "house"].includes(explicit)) return "Haus";
  if (["wohnung", "apartment", "flat"].includes(explicit)) return "Wohnung";
  if (/einfamilienhaus|reihenhaus|doppelhaus|stadthaus|haus\s+(?:zur miete|mieten)|\bhouse\b|\bhaus\b(?=\s*$)|villa|bungalow/.test(label)) return "Haus";
  if (/wohnung|apartment|appartment|\bflat\b|penthouse|maisonette|\bloft\b|\bstudio\b/.test(label)) return "Wohnung";
  return null;
}

export function matchesProfile(criteria, facts, sourceId, areas = []) {
  const types = Array.isArray(criteria.property_types) ? criteria.property_types : criteria.property_type ? [criteria.property_type] : [];
  if (types.length !== 1 || listingCategory(facts) !== types[0]) return false;
  const warm = number(facts?.warm_rent), cold = number(facts?.cold_rent), maxRent = number(criteria.max_warm_rent ?? criteria.maxWarmRent);
  if (criteria.require_known_warm_rent && !(warm > 0)) return false;
  // A missing Scout warm rent must not silently hide a listing from Telegram.
  // The notification identifies prices as unknown. Never use an unverified
  // basic rent to authorize an automatic application (checked below).
  if (maxRent != null && ((warm > 0 && warm > maxRent) || (!(warm > 0) && !criteria.require_known_warm_rent && cold > maxRent))) return false;
  const deposit = number(facts?.deposit), maxDeposit = number(criteria.max_deposit);
  if (maxDeposit != null && (deposit == null || deposit > maxDeposit)) return false;
  if (criteria.wbs_only && facts?.wbs_required !== true && facts?.wbs_required !== 1) return false;
  if (criteria.furnished_preference === "yes" && facts?.furnished !== true && facts?.furnished !== 1) return false;
  if (criteria.furnished_preference === "no" && facts?.furnished !== false && facts?.furnished !== 0) return false;
  const rooms = number(facts?.rooms), minRooms = number(criteria.min_rooms ?? criteria.minRooms);
  const area = number(facts?.area_sqm), minArea = number(criteria.min_area_sqm ?? criteria.minAreaSqm ?? (types[0] === "WG" ? criteria.min_room_area_sqm : null));
  if (minRooms > 0 && rooms > 0 && rooms < minRooms) return false;
  if (minArea > 0 && area > 0 && area < minArea) return false;

  const city = normalize(facts?.city), state = String(facts?.state_code || "").toUpperCase();
  // Provider labels such as "Lübeck / Travemünde" refer to the same
  // municipality as "Lübeck" in the existing SH geography snapshot.
  const mainCity = city.split(/\s*\/\s*/)[0];
  const matchingAreas = city ? areas.filter(x => ["municipality", "independent_city"].includes(x.area_type)
    && [city, mainCity].includes(normalize(x.name))) : [];
  const isHamburg = state === "HH" || (!state && (city === "hamburg" || city.startsWith("hamburg-") || city.startsWith("hamburg,") || city.startsWith("hamburg ") || city.endsWith(", hamburg") || (!city && [1, 3, 23, 29, 35, 66].includes(Number(sourceId)))));
  const isSchleswigHolstein = state === "SH" || (!state && !isHamburg && (matchingAreas.length > 0 || (!city && [69, 71].includes(Number(sourceId)))));
  const isBerlin = state === "BE" || (!state && (
    /^berlin(?:$|[\s,/-])/.test(city) || (!city && Number(sourceId) === 72)));
  const mode = criteria.location_mode;
  if (mode === "all_berlin") return isBerlin;
  if (mode === "berlin_boroughs" || mode === "berlin_localities") {
    if (!isBerlin) return false;
    const wanted = list(mode === "berlin_boroughs" ? criteria.berlin_boroughs : criteria.berlin_localities).map(normalize);
    if (!wanted.length) return false;
    // ImmoScout's quarter is usually an Ortsteil rather than one of 12 Bezirke.
    const cityLocality = city.startsWith("berlin-") ? city.slice(7) : "";
    const observed = normalize(facts?.district || cityLocality).split(/\s*\(/)[0].trim();
    if (mode === "berlin_localities") {
      if (wanted.includes(observed)) return true;
      const title = normalize(facts?.title);
      return wanted.some(name => name && title.includes(name));
    }
    if (wanted.length === BERLIN_BOROUGHS.length) return true;
    const borough = berlinBoroughFor(observed) || BERLIN_BOROUGHS.find(name => normalize(name) === observed);
    return !!borough && wanted.includes(normalize(borough));
  }
  if (mode === "all_hamburg") return isHamburg;
  if (mode === "all_schleswig_holstein") return isSchleswigHolstein;
  if (mode === "schleswig_holstein_areas") {
    if (!isSchleswigHolstein) return false;
    const wanted = new Set(list(criteria.location_area_codes).map(String));
    const codes = [facts?.municipality_code, facts?.admin_region_code].filter(Boolean).map(String);
    if (matchingAreas.length === 1) codes.push(String(matchingAreas[0].area_code), String(matchingAreas[0].parent_code));
    return codes.some(code => wanted.has(code));
  }
  if (mode === "boroughs" || mode === "neighborhoods") {
    if (!isHamburg) return false;
    if (mode === "boroughs" && list(criteria.boroughs).length >= 7) return true;
    const haystack = normalize([facts?.district, facts?.address, facts?.title, facts?.search_text].filter(Boolean).join(" "));
    const names = [...list(criteria.neighborhoods), ...list(criteria.districts), ...(mode === "boroughs" ? list(criteria.boroughs) : [])];
    return names.some(name => normalize(name) && haystack.includes(normalize(name)));
  }
  return false;
}

export async function matchesActiveSearch(sql, participantId, sourceId, facts) {
  const rows = await sql`
    SELECT DISTINCT sp.criteria
    FROM housing.search_profiles sp
    JOIN housing.source_links sl ON sl.search_profile_id = sp.id AND sl.source_id = ${sourceId}
    WHERE sp.participant_id = ${participantId} AND sp.active = true
  `;
  const criteriaRows = rows.map(row => object(row.criteria));
  const areas = criteriaRows.some(row => String(row.location_mode || "").includes("schleswig_holstein"))
    ? await geographicAreas(sql) : [];
  return criteriaRows.some(criteria => matchesProfile(criteria, facts, sourceId, areas));
}

let geoCache = null;
async function geographicAreas(sql) {
  if (geoCache && geoCache.expires > Date.now()) return geoCache.areas;
  const rows = await sql`SELECT payload FROM housing.coach_geo_snapshot WHERE id = ${"de-hh-sh"}`;
  const areas = object(rows[0]?.payload).schleswigHolsteinAreas;
  if (!Array.isArray(areas)) throw new Error("geography_unavailable");
  geoCache = { areas, expires: Date.now() + 5 * 60_000 };
  return areas;
}

function berlinDayStartISO(now = new Date()) {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type) => dateParts.find((entry) => entry.type === type)?.value;
  const year = Number(part("year")), month = Number(part("month")), day = Number(part("day"));
  const utcMidnight = new Date(Date.UTC(year, month - 1, day));
  const offsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin", timeZoneName: "shortOffset", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(utcMidnight);
  const offsetLabel = offsetParts.find((entry) => entry.type === "timeZoneName")?.value || "GMT+0";
  const match = offsetLabel.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  const offsetMinutes = match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] || 0)) : 0;
  return new Date(utcMidnight.getTime() - offsetMinutes * 60_000).toISOString().replace("T", " ").replace("Z", "").slice(0, 19);
}

export async function queueMatches(sql, offerId, sourceId, identityHash, facts, centralAutoApplyEnabled = true, allowTestApplications = true, cache = null) {
  const source = sourceForId(sourceId);
  if (source?.delivery_mode !== "live") return 0;
  const targetProvider = applicationProvider(source, facts);
  const rows = cache?.profileRows ?? await sql`
    SELECT DISTINCT sp.participant_id, sp.profile_slot, sp.criteria,
      p.test_auto_apply_allowed, p.test_auto_apply_enabled,
      p.test_auto_apply_daily_limit, p.test_auto_apply_enabled_at,
      p.auto_apply_enabled, p.telegram_user_id,
      p.plan_override, p.plan_override_expires_at, p.referral_bonus_until,
      s.status AS subscription_status, s.current_period_end AS subscription_period_end,
      ap.profile AS applicant_profile, pref.enabled AS preferences_enabled,
      pref.immoscout_enabled, pref.immowelt_enabled, pref.immomio_enabled
    FROM housing.search_profiles sp
    JOIN housing.source_links sl ON sl.search_profile_id = sp.id AND sl.source_id = ${sourceId}
    JOIN housing.participants p ON p.id = sp.participant_id AND p.status = 'active'
    LEFT JOIN housing.applicant_profiles ap ON ap.participant_id = p.id
    LEFT JOIN housing.application_preferences pref ON pref.participant_id = p.id
    LEFT JOIN housing.user_subscriptions s ON s.participant_id = p.id AND s.provider = 'stripe'
    WHERE sp.active = true
  `;
  if (cache && !cache.profileRows) cache.profileRows = rows;
  const cutover = (await sql`
    SELECT i.first_seen_at, i.expires_at, c.enabled_at
    FROM housing.offer_identities i
    JOIN housing.application_queue_cutover c ON c.id = 1
    WHERE i.id = ${offerId}
  `)[0];
  const now = Date.now();
  // AutoApply eligibility follows the active search profile and sender state,
  // not when the source first discovered a still-active listing.
  const listingActive = cutover && (!cutover.expires_at || timestampMillis(cutover.expires_at) > now);
  let queued = 0;
  const needsAreas = rows.some(row => String(object(row.criteria).location_mode || "").includes("schleswig_holstein"));
  const areas = needsAreas ? await geographicAreas(sql) : [];
  for (const row of rows) {
    const criteria = object(row.criteria);
    const profileLimit = premiumParticipant(row) ? 4 : 1;
    if (Number(row.profile_slot ?? 1) > profileLimit) continue;
    if (!matchesProfile(criteria, facts, sourceId, areas)) continue;
    const key = `${row.participant_id}:${identityHash}`;
    const inserted = await sql`
      INSERT INTO housing.deliveries (id, participant_id, offer_identity_id, idempotency_key, status)
      VALUES (gen_random_uuid(), ${row.participant_id}, ${offerId}, ${key}, 'pending')
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `;
    // The scheduled delivery processor consumes pending housing.deliveries directly.
    // A second housing.jobs record is never consumed and only grows indefinitely.
    queued += inserted.length;

    const provider = targetProvider;
    const providerEnabled = provider === "immoscout24" ? row.immoscout_enabled
      : provider === "immowelt" ? row.immowelt_enabled
        : provider === "immomio" ? row.immomio_enabled : false;
    const profile = object(row.applicant_profile);
    // matchesProfile already enforces every selected search criterion. Do not
    // introduce another warm-rent filter or source-specific application gate.
    if (listingActive && centralAutoApplyEnabled && provider && premiumParticipant(row) && enabled(row.auto_apply_enabled) && !enabled(row.test_auto_apply_enabled)
      && enabled(row.preferences_enabled) && enabled(providerEnabled)
      && missingApplicantFields(profile).length === 0) {
      const applicationKey = applicationIdempotencyKey(row.participant_id, provider, identityHash);
      const immomioId = provider === "immomio"
        ? String(facts.canonical_url || "").match(/^https:\/\/tenant\.immomio\.com\/(?:de\/)?apply\/([0-9a-f-]{36})(?:[/?#]|$)/i)?.[1]?.toLowerCase()
        : null;
      const legacyImmomioKey = immomioId ? `legacy:immomio:${row.participant_id}:${immomioId}` : null;
      const legacyProviderBlockKey = provider === "immoscout24" ? `legacy:blocked:${provider}:${row.participant_id}` : null;
      if (!await hasRetainedApplicationKey(sql, applicationKey)
        && (!legacyImmomioKey || !await hasRetainedApplicationKey(sql, legacyImmomioKey))
        && (!legacyProviderBlockKey || !await hasRetainedApplicationKey(sql, legacyProviderBlockKey))) {
        const application = await sql`
          INSERT INTO housing.applications
            (id, participant_id, offer_identity_id, provider, idempotency_key, status)
          VALUES
            (gen_random_uuid(), ${row.participant_id}, ${offerId}, ${provider}, ${applicationKey}, 'pending')
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id
        `;
        if (application.length) await rememberApplicationKey(sql, applicationKey);
      }
    }

    // The owner's personal sender uses the same profile match as normal
    // AutoApply. Only an active listing, full applicant profile and an enabled
    // sender are required; the per-offer key prevents duplicate applications.
    if (allowTestApplications && listingActive && provider && enabled(providerEnabled)
      && missingApplicantFields(profile).length === 0
      && Number(row.telegram_user_id) === 8538226539
      && (row.test_auto_apply_allowed === true || row.test_auto_apply_allowed === 1)
      && (row.test_auto_apply_enabled === true || row.test_auto_apply_enabled === 1)
      && !(row.auto_apply_enabled === true || row.auto_apply_enabled === 1)) {
      const testKey = `test:${row.participant_id}:${identityHash}`;
      // The per-offer test key prevents repeat submissions. A provider-wide
      // migration marker cannot identify offers first seen after activation.
      if (!await hasRetainedApplicationKey(sql, testKey)) {
        const testApplication = await sql`
          INSERT INTO housing.applications
            (id, participant_id, offer_identity_id, provider, idempotency_key, status, test_mode)
          SELECT
            gen_random_uuid(), ${row.participant_id}, ${offerId}, ${provider}, ${testKey}, 'pending', true
          WHERE EXISTS (
            SELECT 1 FROM housing.participants p
            WHERE p.id = ${row.participant_id}
              AND p.status = 'active'
              AND p.telegram_user_id = 8538226539
              AND p.test_auto_apply_allowed = true
              AND p.test_auto_apply_enabled = true
              AND p.auto_apply_enabled = false
          )
            AND EXISTS (
              SELECT 1 FROM housing.application_preferences pref
              WHERE pref.participant_id = ${row.participant_id} AND pref.enabled = false
                AND CASE ${provider}
                  WHEN 'immoscout24' THEN pref.immoscout_enabled
                  WHEN 'immowelt' THEN pref.immowelt_enabled
                  WHEN 'immomio' THEN pref.immomio_enabled
                  ELSE false END = true
            )
            AND NOT EXISTS (
              SELECT 1 FROM housing.applications a
              WHERE a.participant_id = ${row.participant_id}
                AND a.test_mode = true
                AND a.status IN ('pending','processing')
            )
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id
        `;
        if (testApplication.length) await rememberApplicationKey(sql, testKey);
      }
      // applications is the processor queue; do not create an unconsumed jobs row.
    }
  }
  return queued;
}
