import { listingImageUrl } from "./telegram-listing-preview.js";
import { missingApplicantFields, premiumParticipant } from "./application-policy.js";

const MAX_AUTH_AGE_SECONDS = 86_400;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const PROFILE_FIELDS = Object.freeze([
  "first_name", "last_name", "email", "phone", "street", "house_number", "postcode", "city",
]);
const REASONS = Object.freeze({
  premium_required: "Premium erforderlich",
  profile_incomplete: "Bewerberprofil vervollständigen",
  test_mode_profile_incomplete: "Bewerberprofil vervollständigen",
  wbs_required: "WBS erforderlich",
  auto_apply_disabled: "Auto-Bewerbung deaktiviert",
  test_mode_active: "Testmodus aktiv",
  test_mode_not_authorized: "Testbewerbung nicht freigegeben",
  provider_contract_unverified: "Plattform-Zugang prüfen",
  provider_transport_pending: "Manuell bei der Plattform bewerben",
  central_identity_mismatch: "Plattform-Konto überprüfen",
  submission_unconfirmed: "Versand nicht bestätigt",
});

function respond(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store", "x-content-type-options": "nosniff",
    },
  });
}
function object(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
function safeLink(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}
function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function rowOffer(row) {
  const facts = object(row.facts);
  return {
    id: String(row.offer_id || row.offer_identity_id || ""),
    title: String(facts.title || row.title || "Wohnungsangebot").slice(0, 140),
    source: String(row.source_name || "Angebot").slice(0, 65),
    city: String(facts.city || "").slice(0, 75),
    district: String(facts.district || facts.borough || "").slice(0, 90),
    warmRent: numeric(facts.warm_rent) ?? numeric(row.warm_rent),
    coldRent: numeric(facts.cold_rent),
    rooms: numeric(facts.rooms),
    area: numeric(facts.area_sqm),
    image: listingImageUrl(facts.image_url),
    url: safeLink(row.canonical_url),
    saved: Boolean(row.saved),
    date: row.sent_at || row.saved_at || row.created_at || "",
  };
}
function rowApplication(row) {
  const f = object(row.facts);
  return {
    id: row.id, provider: row.provider, status: row.status,
    title: String(f.title || "Wohnungsbewerbung").slice(0, 140),
    reason: REASONS[row.last_error] || (row.status === "manual_required" ? "Aktion erforderlich" : ""),
    url: safeLink(row.canonical_url), createdAt: row.created_at,
  };
}
function rowSearch(row) {
  const c = object(row.criteria);
  return {
    id: row.id, slot: Number(row.profile_slot), active: Number(row.active) === 1,
    name: String(c.name || "Meine Suche " + row.profile_slot).slice(0, 90),
    mode: String(c.location_mode || ""),
    location: String(c.location_mode === "all_hamburg" ? "Ganz Hamburg"
      : c.location_mode === "all_berlin" ? "Ganz Berlin"
      : c.location_mode === "all_schleswig_holstein" ? "Ganz Schleswig-Holstein"
      : (Array.isArray(c.berlin_boroughs) && c.berlin_boroughs.length ? c.berlin_boroughs.join(", ")
      : Array.isArray(c.berlin_localities) && c.berlin_localities.length ? c.berlin_localities.join(", ")
      : Array.isArray(c.districts) ? c.districts.join(", ") : "Ausgewählte Gebiete")).slice(0, 180),
    rent: numeric(c.max_warm_rent),
    rooms: numeric(c.min_rooms), area: numeric(c.min_area_sqm),
    propertyTypes: Array.isArray(c.property_types) ? c.property_types.slice(0, 3) : [],
  };
}

async function hmac(key, content) {
  const bytes = key instanceof Uint8Array ? key : new TextEncoder().encode(key);
  const imported = await crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, new TextEncoder().encode(content)));
}

/** Verifies Telegram's HMAC SHA-256 signature, age and user ID before any D1 reads. */
export async function verifyMiniAppInitData(raw, botToken, now = Date.now()) {
  if (typeof raw !== "string" || !raw || raw.length > 4096 || !botToken) return null;
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  if (keys.length > 32 || new Set(keys).size !== keys.length) return null;
  const hash = params.get("hash");
  const auth = params.get("auth_date");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash) || !/^\d{10}$/.test(auth || "")) return null;
  const age = Math.floor(now / 1000) - Number(auth);
  if (age < -60 || age > MAX_AUTH_AGE_SECONDS) return null;
  // Telegram's bot-token HMAC covers every field except hash, including the
  // newer Ed25519 "signature" field. Only third-party Ed25519 verification
  // excludes both signature and hash from its data-check string.
  const check = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => key + "=" + value).join("\n");
  const secret = await hmac("WebAppData", botToken);
  const expected = await hmac(secret, check);
  const given = Uint8Array.from(hash.match(/.{2}/g), pair => parseInt(pair, 16));
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ given[i];
  if (difference !== 0) return null;
  try {
    const user = JSON.parse(params.get("user") || "{}");
    if (!Number.isSafeInteger(user.id) || user.id <= 0) return null;
    return { userId: user.id };
  } catch { return null; }
}

async function bootstrap(sql, participant) {
  const id = participant.id;
  const [offers, saved, searches, apps, profiles, prefs] = await Promise.all([
    sql.unsafe("SELECT oi.id AS offer_id, oi.facts, oi.canonical_url, s.name AS source_name, d.sent_at, EXISTS (SELECT 1 FROM saved_offers sv WHERE sv.participant_id=d.participant_id AND sv.offer_identity_id=oi.id) AS saved FROM deliveries d JOIN offer_identities oi ON oi.id=d.offer_identity_id JOIN source_registry s ON s.id=oi.source_id WHERE d.participant_id=$1 AND d.status='sent' ORDER BY d.sent_at DESC LIMIT 60", [id]),
    sql.unsafe("SELECT sv.offer_identity_id AS offer_id, sv.title, sv.source_name, sv.canonical_url, sv.warm_rent, sv.saved_at, oi.facts, 1 AS saved FROM saved_offers sv LEFT JOIN offer_identities oi ON oi.id=sv.offer_identity_id WHERE sv.participant_id=$1 ORDER BY sv.saved_at DESC LIMIT 60", [id]),
    sql.unsafe("SELECT id, profile_slot, criteria, active FROM search_profiles WHERE participant_id=$1 ORDER BY profile_slot LIMIT 4", [id]),
    sql.unsafe("SELECT a.id,a.provider,a.status,a.last_error,a.created_at,oi.facts,oi.canonical_url FROM applications a LEFT JOIN offer_identities oi ON oi.id=a.offer_identity_id WHERE a.participant_id=$1 ORDER BY a.created_at DESC LIMIT 60", [id]),
    sql.unsafe("SELECT profile FROM applicant_profiles WHERE participant_id=$1 LIMIT 1", [id]),
    sql.unsafe("SELECT enabled,immoscout_enabled,immowelt_enabled,immomio_enabled FROM application_preferences WHERE participant_id=$1 LIMIT 1", [id]),
  ]);
  const profile = object(profiles[0]?.profile);
  const personal = Object.fromEntries(PROFILE_FIELDS.map(key => [key, String(profile[key] || "").slice(0, 300)]));
  const missing = missingApplicantFields(profile);
  const preferences = prefs[0] || {};
  return respond({
    ok: true,
    participant: { firstName: String(participant.first_name || "").slice(0, 80) },
    offers: offers.map(rowOffer), saved: saved.map(rowOffer),
    searches: searches.map(rowSearch), applications: apps.map(rowApplication),
    profile: { fields: personal, missing, complete: missing.length === 0 },
    autoApply: {
      enabled: Number(preferences.enabled) === 1,
      immoscout: Number(preferences.immoscout_enabled) === 1,
      immowelt: Number(preferences.immowelt_enabled) === 1,
      immomio: Number(preferences.immomio_enabled) === 1,
    },
  });
}

async function updateSaved(sql, participantId, body) {
  const offerId = String(body.offerId || "");
  if (!UUID.test(offerId) || typeof body.saved !== "boolean") return respond({ error: "invalid_selection" }, 422);
  if (body.saved) {
    const rows = await sql.unsafe("SELECT oi.id,oi.canonical_url,oi.facts,s.name AS source_name FROM deliveries d JOIN offer_identities oi ON oi.id=d.offer_identity_id JOIN source_registry s ON s.id=oi.source_id WHERE d.participant_id=$1 AND d.status='sent' AND oi.id=$2 LIMIT 1", [participantId, offerId]);
    const offer = rows[0];
    if (!offer || !safeLink(offer.canonical_url)) return respond({ error: "offer_not_delivered" }, 403);
    const facts = object(offer.facts);
    await sql.unsafe("INSERT OR IGNORE INTO saved_offers(participant_id,offer_identity_id,canonical_url,title,source_name,warm_rent) VALUES($1,$2,$3,$4,$5,$6)", [
      participantId, offerId, safeLink(offer.canonical_url),
      String(facts.title || "Wohnungsangebot").slice(0, 170),
      String(offer.source_name).slice(0, 70), numeric(facts.warm_rent),
    ]);
  } else {
    await sql.unsafe("DELETE FROM saved_offers WHERE participant_id=$1 AND offer_identity_id=$2", [participantId, offerId]);
  }
  return respond({ ok: true, offerId, saved: body.saved });
}

async function eligibleSlot(sql, participantId, profileId) {
  const rows = await sql.unsafe("SELECT id, profile_slot FROM search_profiles WHERE participant_id=$1 AND id=$2 LIMIT 1", [participantId, profileId]);
  const row = rows[0];
  if (!row) return false;
  if (Number(row.profile_slot) === 1) return true;
  const entitlements = await sql.unsafe("SELECT p.plan_override,p.plan_override_expires_at,p.referral_bonus_until,sub.status AS subscription_status,sub.current_period_end AS subscription_period_end FROM participants p LEFT JOIN user_subscriptions sub ON sub.participant_id=p.id AND sub.provider='stripe' WHERE p.id=$1 LIMIT 1", [participantId]);
  return premiumParticipant(entitlements[0] || {});
}
async function updateSearch(sql, participantId, body) {
  const id = String(body.id || "");
  if (!UUID.test(id)) return respond({ error: "invalid_selection" }, 422);
  if (!await eligibleSlot(sql, participantId, id)) return respond({ error: "not_available" }, 403);
  if (body.action === "search:toggle") {
    if (typeof body.active !== "boolean") return respond({ error: "invalid_selection" }, 422);
    await sql.unsafe("UPDATE search_profiles SET active=$1,updated_at=CURRENT_TIMESTAMP WHERE participant_id=$2 AND id=$3", [body.active ? 1 : 0, participantId, id]);
    return respond({ ok: true });
  }
  const rent = Number(body.rent), rooms = Number(body.rooms), area = Number(body.area);
  if (![rent, rooms, area].every(Number.isFinite) ||
      !Number.isInteger(rent) || rent < 100 || rent > 20000 ||
      !Number.isInteger(rooms) || rooms < 1 || rooms > 20 ||
      !Number.isInteger(area) || area < 10 || area > 500)
    return respond({ error: "invalid_filters" }, 422);
  await sql.unsafe("UPDATE search_profiles SET criteria=json_patch(criteria,$1),updated_at=CURRENT_TIMESTAMP WHERE participant_id=$2 AND id=$3",
    [JSON.stringify({ max_warm_rent: rent, min_rooms: rooms, min_area_sqm: area }), participantId, id]);
  return respond({ ok: true });
}

async function updateProfile(sql, participantId, body) {
  const values = body.fields;
  if (!values || typeof values !== "object" || Array.isArray(values)
    || Object.keys(values).some(key => !PROFILE_FIELDS.includes(key))) return respond({ error: "invalid_fields" }, 422);
  const patch = {};
  for (const key of PROFILE_FIELDS) {
    if (!Object.hasOwn(values, key)) continue;
    if (typeof values[key] !== "string" || values[key].length > 300) return respond({ error: "invalid_fields" }, 422);
    patch[key] = values[key].trim();
  }
  if (!patch.first_name || !patch.last_name
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email || "")
    || (patch.phone || "").replace(/\D/g, "").length < 7
    || !/^\d{5}$/.test(patch.postcode || "")
    || !patch.city || !patch.street || !patch.house_number)
    return respond({ error: "incomplete_contact" }, 422);
  await sql.unsafe("INSERT INTO applicant_profiles(participant_id,profile) VALUES($1,$2) ON CONFLICT(participant_id) DO UPDATE SET profile=json_patch(applicant_profiles.profile,excluded.profile),updated_at=CURRENT_TIMESTAMP",
    [participantId, JSON.stringify(patch)]);
  return respond({ ok: true });
}

/** Only authenticated private Telegram participants can read or mutate their records. */
export async function miniAppApi(request, env, sql) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return respond({ error: "forbidden_origin" }, 403);
  if (request.method !== "POST" || !/application\/json/i.test(request.headers.get("content-type") || ""))
    return respond({ error: "invalid_request" }, 405);
  if (Number(request.headers.get("content-length") || 0) > 8192) return respond({ error: "request_too_large" }, 413);
  const raw = request.headers.get("x-telegram-init-data");
  const auth = await verifyMiniAppInitData(raw, env.TELEGRAM_BOT_TOKEN);
  if (!auth) return respond({ error: "telegram_auth_required" }, 401);
  const rows = await sql.unsafe("SELECT id,first_name FROM participants WHERE telegram_user_id=$1 AND status='active' LIMIT 1", [auth.userId]);
  const participant = rows[0];
  if (!participant) return respond({ error: "participant_not_found" }, 403);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return respond({ error: "invalid_request" }, 400);
  if (body.action === "bootstrap") return bootstrap(sql, participant);
  if (body.action === "saved:update") return updateSaved(sql, participant.id, body);
  if (body.action === "search:toggle" || body.action === "search:update") return updateSearch(sql, participant.id, body);
  if (body.action === "profile:update") return updateProfile(sql, participant.id, body);
  return respond({ error: "unknown_action" }, 400);
}
