import { hasRetainedApplicationKey, rememberApplicationKey } from "./application-dedupe.js";
import { applicationProvider, missingApplicantFields, premiumParticipant, timestampMillis } from "./application-policy.js";
import { applicationIdempotencyKey, sourceForId } from "./source-allowlist.js";

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
  const matchingAreas = city ? areas.filter(x => ["municipality", "independent_city"].includes(x.area_type) && normalize(x.name) === city) : [];
  const isHamburg = state === "HH" || (!state && (city === "hamburg" || city.startsWith("hamburg-") || city.startsWith("hamburg,") || city.startsWith("hamburg ") || (!city && [1, 3, 23, 29, 34, 35].includes(Number(sourceId)))));
  const isSchleswigHolstein = state === "SH" || (!state && !isHamburg && (matchingAreas.length > 0 || (!city && [69, 71].includes(Number(sourceId)))));
  const mode = criteria.location_mode;
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

export async function queueMatches(sql, offerId, sourceId, identityHash, facts) {
  const source = sourceForId(sourceId);
  if (source?.delivery_mode !== "live") return 0;
  const targetProvider = applicationProvider(source, facts);
  const rows = await sql`
    SELECT DISTINCT sp.participant_id, sp.criteria,
      p.test_auto_apply_allowed, p.test_auto_apply_enabled,
      p.test_auto_apply_daily_limit, p.auto_apply_enabled, p.telegram_user_id,
      p.plan_override, p.plan_override_expires_at, p.referral_bonus_until,
      s.status AS subscription_status, s.current_period_end AS subscription_period_end,
      ap.profile AS applicant_profile, pref.enabled AS preferences_enabled,
      pref.immoscout_enabled, pref.immowelt_enabled, pref.immomio_enabled,
      pc.status AS provider_connection_status
    FROM housing.search_profiles sp
    JOIN housing.source_links sl ON sl.search_profile_id = sp.id AND sl.source_id = ${sourceId}
    JOIN housing.participants p ON p.id = sp.participant_id AND p.status = 'active'
    LEFT JOIN housing.applicant_profiles ap ON ap.participant_id = p.id
    LEFT JOIN housing.application_preferences pref ON pref.participant_id = p.id
    LEFT JOIN housing.provider_connections pc ON pc.participant_id = p.id AND pc.provider = ${targetProvider || ""}
    LEFT JOIN housing.user_subscriptions s ON s.participant_id = p.id AND s.provider = 'stripe'
    WHERE sp.active = true
  `;
  const cutover = (await sql`
    SELECT i.first_seen_at, i.expires_at, c.enabled_at
    FROM housing.offer_identities i
    JOIN housing.application_queue_cutover c ON c.id = 1
    WHERE i.id = ${offerId}
  `)[0];
  const now = Date.now();
  const autoApplyFresh = cutover
    && timestampMillis(cutover.first_seen_at) >= timestampMillis(cutover.enabled_at)
    && (!cutover.expires_at || timestampMillis(cutover.expires_at) > now);
  let queued = 0;
  const needsAreas = rows.some(row => String(object(row.criteria).location_mode || "").includes("schleswig_holstein"));
  const areas = needsAreas ? await geographicAreas(sql) : [];
  for (const row of rows) {
    const criteria = object(row.criteria);
    if (!matchesProfile(criteria, facts, sourceId, areas)) continue;
    const key = `${row.participant_id}:${identityHash}`;
    const inserted = await sql`
      INSERT INTO housing.deliveries (id, participant_id, offer_identity_id, idempotency_key, status)
      VALUES (gen_random_uuid(), ${row.participant_id}, ${offerId}, ${key}, 'pending')
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `;
    if (inserted.length) {
      queued++;
      await sql`INSERT INTO housing.jobs (id, kind, payload, status) VALUES (gen_random_uuid(), 'delivery', ${JSON.stringify({ delivery_id: inserted[0].id })}::jsonb, 'queued')`;
    }

    const provider = targetProvider;
    const providerEnabled = provider === "immoscout24" ? row.immoscout_enabled
      : provider === "immowelt" ? row.immowelt_enabled
        : provider === "immomio" ? row.immomio_enabled : false;
    const profile = object(row.applicant_profile);
    if (autoApplyFresh && provider && enabled(row.auto_apply_enabled) && premiumParticipant(row)
      && enabled(row.preferences_enabled) && enabled(providerEnabled)
      && row.provider_connection_status === "connected" && missingApplicantFields(profile).length === 0) {
      const applicationKey = applicationIdempotencyKey(row.participant_id, provider, identityHash);
      if (!await hasRetainedApplicationKey(sql, applicationKey)) {
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

    // The personal test path is deliberately separate from participant plugin connections.
    if (autoApplyFresh && [1, 69].includes(Number(sourceId))
      && Number(row.telegram_user_id) === 8538226539
      && (row.test_auto_apply_allowed === true || row.test_auto_apply_allowed === 1)
      && (row.test_auto_apply_enabled === true || row.test_auto_apply_enabled === 1)
      && !(row.auto_apply_enabled === true || row.auto_apply_enabled === 1)) {
      const dailyLimit = Math.min(5, Math.max(1, Number(row.test_auto_apply_daily_limit || 1)));
      const dayStart = berlinDayStartISO();
      const testKey = `test:${row.participant_id}:${identityHash}`;
      if (!await hasRetainedApplicationKey(sql, testKey)) {
        const testApplication = await sql`
          INSERT INTO housing.applications
            (id, participant_id, offer_identity_id, provider, idempotency_key, status, test_mode)
          SELECT
            gen_random_uuid(), ${row.participant_id}, ${offerId}, 'immoscout24', ${testKey}, 'pending', true
          WHERE EXISTS (
            SELECT 1 FROM housing.participants p
            WHERE p.id = ${row.participant_id}
              AND p.status = 'active'
              AND p.telegram_user_id = 8538226539
              AND p.test_auto_apply_allowed = true
              AND p.test_auto_apply_enabled = true
              AND p.auto_apply_enabled = false
          )
            AND NOT EXISTS (
              SELECT 1 FROM housing.application_preferences pref
              WHERE pref.participant_id = ${row.participant_id} AND pref.enabled = true
            )
            AND NOT EXISTS (
              SELECT 1 FROM housing.applications a
              WHERE a.participant_id = ${row.participant_id}
                AND a.test_mode = true
                AND a.status IN ('pending','processing')
            )
            AND (
              SELECT COUNT(*) FROM housing.applications a
              WHERE a.participant_id = ${row.participant_id}
                AND a.test_mode = true
                AND a.submission_started_at >= ${dayStart}
            ) < ${dailyLimit}
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

function html(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function telegramText(facts) {
  const rows = [facts?.title, facts?.city, facts?.district, facts?.postal_code, facts?.warm_rent != null ? `${facts.warm_rent} € warm` : null, facts?.rooms != null ? `${facts.rooms} Zimmer` : null, facts?.area_sqm != null ? `${facts.area_sqm} m²` : null].filter(Boolean);
  return `<b>${html(rows.shift() || "Wohnungsangebot")}</b>\n${rows.map(html).join(" · ")}\n<a href="${html(facts?.canonical_url || facts?.url || "")}">Originalangebot öffnen</a>`;
}

