const PROVIDERS = new Set(["immoscout24", "immowelt", "immomio"]);
import { sendImmoweltApplication } from "./immowelt-application.js";
import { sendImmoScoutApplication } from "./immoscout-application.js";
import { sendImmomioApplication } from "./immomio-application.js";

function enabled(value) { return value === true || value === 1; }

function missingApplicantFields(profile) {
  return ["first_name", "last_name", "email", "phone", "street", "house_number", "postcode", "city"]
    .filter((key) => !String(profile?.[key] ?? "").trim());
}

function berlinDayStartSql(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  const year = Number(part("year")), month = Number(part("month")), day = Number(part("day"));
  const utcMidnight = new Date(Date.UTC(year, month - 1, day));
  const offsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin", timeZoneName: "shortOffset", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(utcMidnight);
  const label = offsetParts.find((entry) => entry.type === "timeZoneName")?.value || "GMT+0";
  const match = label.match(/GMT([+-])(\\d{1,2})(?::?(\\d{2}))?/);
  const offset = match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] || 0)) : 0;
  return new Date(utcMidnight.getTime() - offset * 60_000).toISOString().replace("T", " ").replace("Z", "").slice(0, 19);
}

async function sameSecret(supplied, expected) {
  if (typeof supplied !== "string" || typeof expected !== "string" || supplied.length === 0 || supplied.length !== expected.length) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left), b = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function event(sql, applicationId, provider, type, status, reason, metadata = {}) {
  await sql`
    INSERT INTO housing.application_events
      (id, application_id, provider, event_type, status, reason, metadata)
    VALUES
      (${crypto.randomUUID()}, ${applicationId}, ${provider}, ${type}, ${status}, ${reason}, ${JSON.stringify(metadata)}::jsonb)
  `;
}

async function claim(sql, freshOnly = false) {
  return sql.begin(async (tx) => {
    const rows = freshOnly ? await tx`
      SELECT a.id, a.participant_id, a.offer_identity_id, a.provider,
        a.test_mode, a.submission_started_at, a.sent_at,
        p.first_name, p.last_name, p.email, p.telegram_chat_id,
        p.test_auto_apply_allowed, p.test_auto_apply_enabled, p.test_auto_apply_daily_limit, p.auto_apply_enabled,
        ap.profile,
        oi.canonical_url, oi.external_id, oi.source_id, oi.facts,
        pref.enabled AS preferences_enabled,
        CASE a.provider
          WHEN 'immoscout24' THEN pref.immoscout_enabled
          WHEN 'immowelt' THEN pref.immowelt_enabled
          WHEN 'immomio' THEN pref.immomio_enabled
          ELSE false
        END AS provider_enabled,
        pc.status AS connection_status, pc.ciphertext AS connection_ciphertext, pc.iv AS connection_iv, pc.key_version AS connection_key_version
      FROM housing.applications a
      JOIN housing.participants p ON p.id = a.participant_id
      LEFT JOIN housing.applicant_profiles ap ON ap.participant_id = a.participant_id
      LEFT JOIN housing.offer_identities oi ON oi.id = a.offer_identity_id
      LEFT JOIN housing.application_preferences pref ON pref.participant_id = a.participant_id
      LEFT JOIN housing.provider_connections pc ON pc.participant_id = a.participant_id AND pc.provider = a.provider
      WHERE a.status = 'pending' AND a.created_at >= now() - interval '15 minutes'
      ORDER BY a.created_at
      LIMIT 1
      FOR UPDATE OF a SKIP LOCKED
    ` : await tx`
      SELECT a.id, a.participant_id, a.offer_identity_id, a.provider,
        a.test_mode, a.submission_started_at, a.sent_at,
        p.first_name, p.last_name, p.email, p.telegram_chat_id,
        p.test_auto_apply_allowed, p.test_auto_apply_enabled, p.test_auto_apply_daily_limit, p.auto_apply_enabled,
        ap.profile,
        oi.canonical_url, oi.external_id, oi.source_id, oi.facts,
        pref.enabled AS preferences_enabled,
        CASE a.provider
          WHEN 'immoscout24' THEN pref.immoscout_enabled
          WHEN 'immowelt' THEN pref.immowelt_enabled
          WHEN 'immomio' THEN pref.immomio_enabled
          ELSE false
        END AS provider_enabled,
        pc.status AS connection_status
      FROM housing.applications a
      JOIN housing.participants p ON p.id = a.participant_id
      LEFT JOIN housing.applicant_profiles ap ON ap.participant_id = a.participant_id
      LEFT JOIN housing.offer_identities oi ON oi.id = a.offer_identity_id
      LEFT JOIN housing.application_preferences pref ON pref.participant_id = a.participant_id
      LEFT JOIN housing.provider_connections pc ON pc.participant_id = a.participant_id AND pc.provider = a.provider
      WHERE a.status = 'pending'
      ORDER BY a.created_at
      LIMIT 1
      FOR UPDATE OF a SKIP LOCKED
    `;
    if (!rows[0]) return null;
    const claimed = await tx`UPDATE housing.applications SET status = 'processing', updated_at = now() WHERE id = ${rows[0].id} AND status = 'pending' RETURNING id`;
    if (!claimed.length) return null;
    const row = rows[0];
    try { row.profile = typeof row.profile === "string" ? JSON.parse(row.profile || "{}") : (row.profile || {}); } catch { row.profile = {}; }
    try { row.facts = typeof row.facts === "string" ? JSON.parse(row.facts || "{}") : (row.facts || {}); } catch { row.facts = {}; }
    row.preferences_enabled = enabled(row.preferences_enabled);
    row.provider_enabled = enabled(row.provider_enabled);
    row.test_mode = enabled(row.test_mode);
    row.test_auto_apply_allowed = enabled(row.test_auto_apply_allowed);
    row.test_auto_apply_enabled = enabled(row.test_auto_apply_enabled);
    row.auto_apply_enabled = enabled(row.auto_apply_enabled);
    return row;
  });
}

export async function processHousingApplication(sql, env, request) {
  const expected = String(env.APPLICATION_RUN_TOKEN || "");
  if (!await sameSecret(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "", expected)) {
    return { status: 401, body: { error: "unauthorized" } };
  }
  const application = await claim(sql, new URL(request.url).searchParams.get("fresh_only") === "1");
  if (!application) return { status: 200, body: { ok: true, status: "idle" } };
  const provider = String(application.provider || "");
  const fail = async (status, reason, metadata = {}) => {
    await sql`UPDATE housing.applications SET status = ${status}, last_error = ${reason}, updated_at = now() WHERE id = ${application.id}`;
    await event(sql, application.id, provider, "processor", status, reason, metadata);
    return { status: 200, body: { ok: true, status, provider, reason, application_id: application.id } };
  };
  if (!PROVIDERS.has(provider)) return fail("failed", "provider_not_allowlisted");
  if (!application.offer_identity_id || !application.canonical_url) return fail("failed", "listing_expired");

  if (application.test_mode) {
    if (provider !== "immoscout24" || !application.test_auto_apply_allowed || !application.test_auto_apply_enabled
      || application.auto_apply_enabled || ![1, 69].includes(Number(application.source_id))) {
      return fail("manual_required", "test_mode_not_authorized");
    }
    const missing = missingApplicantFields(application.profile);
    if (missing.length) return fail("manual_required", "test_mode_profile_incomplete", { missing });
    let submissionStarted = false;
    const authorizeTestSend = async () => {
      const dailyLimit = Math.min(5, Math.max(1, Number(application.test_auto_apply_daily_limit || 1)));
      const reserved = await sql`
        UPDATE housing.applications
        SET submission_started_at = now(), updated_at = now()
        WHERE id = ${application.id}
          AND status = 'processing'
          AND test_mode = true
          AND submission_started_at IS NULL
          AND (
            SELECT COUNT(*) FROM housing.applications q
            WHERE q.participant_id = ${application.participant_id}
              AND q.test_mode = true
              AND q.submission_started_at >= ${berlinDayStartSql()}
          ) < ${dailyLimit}
        RETURNING id
      `;
      submissionStarted = reserved.length > 0;
      return submissionStarted;
    };
    let result;
    try {
      result = await sendImmoScoutApplication({ ...application, authorizeTestSend }, env, sql);
    } catch (error) {
      const code = String(error?.message || "");
      result = {
        status: "manual_required",
        error: submissionStarted ? "submission_unconfirmed"
          : ["needs_login", "temporary_network_error", "credential_decrypt_failed", "test_mode_central_account_unavailable"].includes(code)
            ? code : "provider_contract_unverified",
      };
    }
    await sql`
      UPDATE housing.applications
      SET status = ${result.status}, last_error = ${result.error || null},
        sent_at = CASE WHEN ${result.status} = 'sent' THEN now() ELSE sent_at END,
        updated_at = now()
      WHERE id = ${application.id}
    `;
    await event(sql, application.id, provider, "test_provider_submission", result.status, result.error || null, {
      test_mode: true, confirmation: result.confirmation || null, submission_started: submissionStarted,
    });
    return { status: 200, body: {
      ok: true, status: result.status, provider, test_mode: true,
      reason: result.error || result.confirmation || null, application_id: application.id,
    } };
  }

  if (application.preferences_enabled !== true || application.provider_enabled !== true) return fail("manual_required", "auto_apply_disabled");
  if (application.connection_status !== "connected") return fail("manual_required", "provider_not_connected");

  if (provider === "immowelt") {
    const result = await sendImmoweltApplication(application, env);
    await sql`UPDATE housing.applications SET status = ${result.status}, last_error = ${result.error || null}, updated_at = now() WHERE id = ${application.id}`;
    await event(sql, application.id, provider, "provider_submission", result.status, result.error || null, { confirmation: result.confirmation || null });
    return { status: 200, body: { ok: true, status: result.status, provider, reason: result.error || result.confirmation || null, application_id: application.id } };
  }

  if (provider === "immoscout24") {
    let result;
    try {
      result = await sendImmoScoutApplication(application, env, sql);
    } catch (error) {
      result = { status: "manual_required", error: ["needs_login", "temporary_network_error", "credential_decrypt_failed"].includes(String(error?.message || "")) ? String(error.message) : "provider_contract_unverified" };
    }
    await sql`UPDATE housing.applications SET status = ${result.status}, last_error = ${result.error || null}, updated_at = now() WHERE id = ${application.id}`;
    await event(sql, application.id, provider, "provider_submission", result.status, result.error || null, { confirmation: result.confirmation || null });
    return { status: 200, body: { ok: true, status: result.status, provider, reason: result.error || result.confirmation || null, application_id: application.id } };
  }

  if (provider === "immomio") {
    let result;
    try { result = await sendImmomioApplication(application, env, sql); }
    catch (error) { result = { status: "manual_required", error: ["needs_login", "temporary_network_error", "credential_decrypt_failed"].includes(String(error?.message || "")) ? String(error.message) : "provider_contract_unverified" }; }
    await sql`UPDATE housing.applications SET status = ${result.status}, last_error = ${result.error || null}, updated_at = now() WHERE id = ${application.id}`;
    await event(sql, application.id, provider, "provider_submission", result.status, result.error || null, { confirmation: result.confirmation || null, application_id: result.applicationId || null, follow_up: result.followUpRequired || null });
    return { status: 200, body: { ok: true, status: result.status, provider, reason: result.error || result.confirmation || null, application_id: application.id } };
  }

  return fail("manual_required", "provider_transport_pending", { provider, canonical_url: application.canonical_url });
}
