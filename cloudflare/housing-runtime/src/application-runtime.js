const PROVIDERS = new Set(["immoscout24", "immowelt", "immomio"]);
import { sendImmoweltApplication } from "./immowelt-application.js";
import { sendImmoScoutApplication } from "./immoscout-application.js";
import { sendImmomioApplication } from "./immomio-application.js";
import { matchesActiveSearch } from "./matching.js";
import { applicationProvider, applicationSchedule, missingApplicantFields, listingRequiresWbs, premiumParticipant, timestampMillis } from "./application-policy.js";
import { effectiveApplicationMessages } from "./application-text.js";
import { sourceForId } from "./source-allowlist.js";
import { centralCredentialError, getCentralProviderCredentials } from "./central-provider-credentials.js";

function enabled(value) { return value === true || value === 1; }

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
  const match = label.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
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
    await tx`
      UPDATE housing.applications
      SET status = 'manual_required', last_error = 'submission_unconfirmed', lease_until = NULL, updated_at = now()
      WHERE status = 'processing' AND lease_until < now() AND submission_started_at IS NOT NULL
    `;
    await tx`
      UPDATE housing.applications
      SET status = 'pending', next_attempt_at = now(), lease_until = NULL, updated_at = now()
      WHERE status = 'processing' AND lease_until < now() AND submission_started_at IS NULL
    `;
    const rows = await tx`
      SELECT a.id, a.participant_id, a.offer_identity_id, a.provider, a.status, a.created_at,
        a.test_mode, a.submission_started_at, a.sent_at, a.attempts,
        p.status AS participant_status, p.first_name, p.last_name, p.email, p.telegram_chat_id,
        p.telegram_user_id, p.test_auto_apply_allowed, p.test_auto_apply_enabled, p.test_auto_apply_daily_limit,
        p.auto_apply_enabled, p.plan_override, p.plan_override_expires_at, p.referral_bonus_until,
        ap.profile, oi.canonical_url, oi.external_id, oi.source_id, oi.first_seen_at, oi.expires_at, oi.facts,
        pref.enabled AS preferences_enabled, pref.daily_limit, pref.timezone,
        pref.allowed_weekdays, pref.send_window_start, pref.send_window_end,
        CASE a.provider
          WHEN 'immoscout24' THEN pref.immoscout_enabled
          WHEN 'immowelt' THEN pref.immowelt_enabled
          WHEN 'immomio' THEN pref.immomio_enabled
          ELSE false
        END AS provider_enabled,
        sub.status AS subscription_status, sub.current_period_end AS subscription_period_end,
        cutover.enabled_at AS cutover_enabled_at
      FROM housing.applications a
      JOIN housing.participants p ON p.id = a.participant_id
      LEFT JOIN housing.applicant_profiles ap ON ap.participant_id = a.participant_id
      LEFT JOIN housing.offer_identities oi ON oi.id = a.offer_identity_id
      LEFT JOIN housing.application_preferences pref ON pref.participant_id = a.participant_id
      LEFT JOIN housing.user_subscriptions sub ON sub.participant_id = a.participant_id AND sub.provider = 'stripe'
      LEFT JOIN housing.application_queue_cutover cutover ON cutover.id = 1
      WHERE a.status = 'pending' AND a.next_attempt_at <= now()
        AND (a.lease_until IS NULL OR a.lease_until < now())
        AND (${!freshOnly} = true OR a.test_mode = true OR (
          a.created_at >= now() - interval '24 hours'
          AND oi.expires_at > now() AND oi.first_seen_at >= cutover.enabled_at
        ))
      ORDER BY CASE WHEN a.test_mode = true THEN 0 ELSE 1 END, a.created_at
      LIMIT 1
      FOR UPDATE OF a SKIP LOCKED
    `;
    if (!rows[0]) return null;
    const claimed = await tx`
      UPDATE housing.applications
      SET status = 'processing', attempts = attempts + 1, lease_until = now() + interval '3 minutes', updated_at = now()
      WHERE id = ${rows[0].id} AND status = 'pending' RETURNING id
    `;
    if (!claimed.length) return null;
    const row = rows[0];
    try { row.profile = typeof row.profile === "string" ? JSON.parse(row.profile || "{}") : (row.profile || {}); } catch { row.profile = {}; }
    try { row.facts = typeof row.facts === "string" ? JSON.parse(row.facts || "{}") : (row.facts || {}); } catch { row.facts = {}; }
    row.profile = effectiveApplicationMessages(row.profile);
    const propertyType = String(row.facts.property_type || row.facts.property_kind || row.facts.title || "");
    const isHouse = /(?:^|\\b)(?:Haus|Einfamilienhaus|Reihenhaus|Doppelhaushälfte)(?:\\b|$)/i.test(propertyType);
    row.profile.message = isHouse ? row.profile.message_house : row.profile.message_apartment;
    row.preferences_enabled = enabled(row.preferences_enabled);
    row.provider_enabled = enabled(row.provider_enabled);
    row.test_mode = enabled(row.test_mode);
    row.test_auto_apply_allowed = enabled(row.test_auto_apply_allowed);
    row.test_auto_apply_enabled = enabled(row.test_auto_apply_enabled);
    row.auto_apply_enabled = enabled(row.auto_apply_enabled);
    row.subscription_status = String(row.subscription_status || "");
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
    await sql`UPDATE housing.applications SET status = ${status}, last_error = ${reason}, lease_until = NULL, wait_reason = NULL, updated_at = now() WHERE id = ${application.id}`;
    await event(sql, application.id, provider, "processor", status, reason, metadata);
    return { status: 200, body: { ok: true, status, provider, reason, application_id: application.id } };
  };
  if (!PROVIDERS.has(provider)) return fail("failed", "provider_not_allowlisted");
  if (!application.offer_identity_id || !application.canonical_url) return fail("failed", "listing_expired");

  if (application.test_mode && application.expires_at && Date.parse(application.expires_at) <= Date.now()) {
    return fail("failed", "listing_expired");
  }

  if (application.test_mode) {
    if (Number(application.telegram_user_id) !== 8538226539
      || !application.test_auto_apply_allowed || !application.test_auto_apply_enabled
      || application.auto_apply_enabled || application.preferences_enabled
      || !application.provider_enabled || sourceForId(application.source_id)?.family !== provider) {
      return fail("manual_required", "test_mode_not_authorized");
    }
    const missing = missingApplicantFields(application.profile);
    if (missing.length) return fail("manual_required", "test_mode_profile_incomplete", { missing });
    let submissionStarted = false;
    const authorizeTestSend = async () => {
      const reserved = await sql`
        UPDATE housing.applications
        SET submission_started_at = now(), lease_until = NULL, updated_at = now()
        WHERE id = ${application.id}
          AND status = 'processing'
          AND test_mode = true
          AND submission_started_at IS NULL
          AND EXISTS (
            SELECT 1 FROM housing.participants p
            WHERE p.id = ${application.participant_id}
              AND p.status = 'active'
              AND p.telegram_user_id = 8538226539
              AND p.test_auto_apply_allowed = true
              AND p.test_auto_apply_enabled = true
              AND p.auto_apply_enabled = false
          )
          AND EXISTS (
            SELECT 1 FROM housing.application_preferences pref
            WHERE pref.participant_id = ${application.participant_id}
              AND pref.enabled = false
              AND CASE ${provider}
                WHEN 'immoscout24' THEN pref.immoscout_enabled
                WHEN 'immowelt' THEN pref.immowelt_enabled
                WHEN 'immomio' THEN pref.immomio_enabled
                ELSE false END = true
          )
        RETURNING id
      `;
      submissionStarted = reserved.length > 0;
      return submissionStarted;
    };
    let result;
    try {
      if (provider === "immoscout24") {
        result = await sendImmoScoutApplication({ ...application, authorizeTestSend }, env, sql);
      } else {
        // Verify central credentials and the provider's offer before reserving
        // the one-shot test send. Each sender reserves immediately before its
        // irreversible network submission, not before login/preflight.
        const central = await getCentralProviderCredentials(sql, env, provider, { testMode: true });
        const sender = provider === "immowelt" ? sendImmoweltApplication : sendImmomioApplication;
        result = await sender({ ...application, authorizeTestSend }, env, sql, central);
      }
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
        lease_until = NULL, wait_reason = NULL,
        updated_at = now()
      WHERE id = ${application.id}
    `;
    await event(sql, application.id, provider, "test_provider_submission", result.status, result.error || null, {
      test_mode: true, confirmation: result.confirmation || null, submission_started: submissionStarted,
      provider_http_status: result.provider_http_status || null,
      provider_message_code: result.provider_message_code || null,
      provider_validation_field: result.provider_validation_field || null,
      provider_validation_rule: result.provider_validation_rule || null,
    });
    return { status: 200, body: {
      ok: true, status: result.status, provider, test_mode: true,
      reason: result.error || result.confirmation || null, application_id: application.id,
    } };
  }

  if (application.test_auto_apply_enabled) return fail("manual_required", "test_mode_active");
  if (application.preferences_enabled !== true || application.provider_enabled !== true) return fail("manual_required", "auto_apply_disabled");

  // Infrastructure can be deployed before operator logins and test submissions.
  // Never send or consume queued normal applications until explicitly enabled.
  if (env.CENTRAL_AUTO_APPLY_ENABLED !== "1") {
    const nextAttemptAt = new Date(Date.now() + 60 * 60_000).toISOString();
    await sql`
      UPDATE housing.applications
      SET status = 'pending', wait_reason = 'central_auto_apply_paused',
        next_attempt_at = ${nextAttemptAt}, lease_until = NULL, updated_at = now()
      WHERE id = ${application.id} AND status = 'processing'
    `;
    return { status: 200, body: {
      ok: true, status: "deferred", provider,
      reason: "central_auto_apply_paused", application_id: application.id,
    } };
  }

  const now = new Date();
  const providerSource = sourceForId(application.source_id);
  const facts = { ...application.facts, canonical_url: application.canonical_url };
  if (!providerSource || applicationProvider(providerSource, facts) !== provider) return fail("failed", "not_eligible");
  if (application.participant_status !== "active" || !application.auto_apply_enabled
    || !premiumParticipant(application, now.getTime())) return fail("failed", "not_eligible");
  if (!application.expires_at || timestampMillis(application.expires_at) <= now.getTime()
    || !application.first_seen_at || timestampMillis(application.first_seen_at) < timestampMillis(application.cutover_enabled_at)) {
    return fail("failed", "listing_expired");
  }
  const missing = missingApplicantFields(application.profile);
  if (missing.length) return fail("manual_required", "profile_incomplete", { missing });
  if (!await matchesActiveSearch(sql, application.participant_id, application.source_id, facts)) return fail("failed", "not_eligible");
  const delivery = await sql`
    SELECT 1 FROM housing.deliveries
    WHERE participant_id = ${application.participant_id}
      AND offer_identity_id = ${application.offer_identity_id}
      AND status IN ('pending','processing','sent')
    LIMIT 1
  `;
  if (!delivery.length) return fail("failed", "not_eligible");

  if (listingRequiresWbs(application.facts)) {
    return fail("manual_required", "wbs_required");
  }
  const schedule = applicationSchedule(application, now);
  if (!schedule.allowed) {
    await sql`
      UPDATE housing.applications
      SET status = 'pending', wait_reason = ${schedule.reason}, next_attempt_at = ${schedule.nextAttemptAt}, lease_until = NULL, updated_at = now()
      WHERE id = ${application.id} AND status = 'processing'
    `;
    return { status: 200, body: { ok: true, status: "deferred", provider, reason: schedule.reason, application_id: application.id } };
  }
  // Provider credentials are resolved centrally; applicants never link accounts.
  // Fail before quota reservation when central authentication is unavailable.
  if (provider === "immowelt" && env.CENTRAL_IMMOWELT_TRANSPORT_VERIFIED !== "1") {
    return fail("manual_required", "provider_contract_unverified");
  }
  let central;
  try { central = await getCentralProviderCredentials(sql, env, provider); }
  catch (error) { return fail("manual_required", centralCredentialError(error)); }
  if (provider === "immomio"
    && (central.ownerId !== application.participant_id
      || !central.accountHint || String(central.accountHint).trim().toLowerCase()
      !== String(application.profile.email || "").trim().toLowerCase())) {
    return fail("manual_required", "central_identity_mismatch");
  }
  // Uploaded applicant documents are not part of the simplified application flow.
  const configuredLimit = Number(application.daily_limit);
  const dailyLimit = application.daily_limit == null || !Number.isFinite(configuredLimit)
    ? 2_147_483_647 : Math.max(0, Math.floor(configuredLimit));
  const reserved = await sql`
    UPDATE housing.applications
    SET submission_started_at = now(), quota_local_date = ${schedule.localDate}, wait_reason = NULL, updated_at = now()
    WHERE id = ${application.id} AND status = 'processing' AND submission_started_at IS NULL
      AND (SELECT COUNT(*) FROM housing.applications q WHERE q.participant_id = ${application.participant_id}
        AND q.quota_local_date = ${schedule.localDate} AND q.id <> ${application.id}) < ${dailyLimit}
    RETURNING id
  `;
  if (!reserved.length) {
    const nextAttemptAt = new Date(now.getTime() + 6 * 60 * 60_000).toISOString();
    await sql`
      UPDATE housing.applications
      SET status = 'pending', wait_reason = 'daily_limit', next_attempt_at = ${nextAttemptAt}, lease_until = NULL, updated_at = now()
      WHERE id = ${application.id} AND status = 'processing'
    `;
    return { status: 200, body: { ok: true, status: "deferred", provider, reason: "daily_limit", application_id: application.id } };
  }

  if (provider === "immowelt") {
    let result;
    try { result = await sendImmoweltApplication(application, env, sql, central); }
    catch (error) { result = { status: "manual_required", error: centralCredentialError(error) }; }
    await sql`UPDATE housing.applications SET status = ${result.status}, last_error = ${result.error || null}, sent_at = CASE WHEN ${result.status} = 'sent' THEN now() ELSE sent_at END, lease_until = NULL, wait_reason = NULL, updated_at = now() WHERE id = ${application.id}`;
    await event(sql, application.id, provider, "provider_submission", result.status, result.error || null, { confirmation: result.confirmation || null });
    return { status: 200, body: { ok: true, status: result.status, provider, reason: result.error || result.confirmation || null, application_id: application.id } };
  }

  if (provider === "immoscout24") {
    let result;
    try {
      result = await sendImmoScoutApplication({ ...application, document_package_url: null }, env, sql, central);
    } catch (error) {
      result = { status: "manual_required", error: centralCredentialError(error) };
    }
    await sql`UPDATE housing.applications SET status = ${result.status}, last_error = ${result.error || null}, sent_at = CASE WHEN ${result.status} = 'sent' THEN now() ELSE sent_at END, lease_until = NULL, wait_reason = NULL, updated_at = now() WHERE id = ${application.id}`;
    await event(sql, application.id, provider, "provider_submission", result.status, result.error || null, {
      confirmation: result.confirmation || null,
      provider_http_status: result.provider_http_status || null,
      provider_message_code: result.provider_message_code || null,
      provider_validation_field: result.provider_validation_field || null,
      provider_validation_rule: result.provider_validation_rule || null,
    });
    return { status: 200, body: { ok: true, status: result.status, provider, reason: result.error || result.confirmation || null, application_id: application.id } };
  }

  if (provider === "immomio") {
    let result;
    try { result = await sendImmomioApplication(application, env, sql, central); }
    catch (error) { result = { status: "manual_required", error: centralCredentialError(error) }; }
    await sql`UPDATE housing.applications SET status = ${result.status}, last_error = ${result.error || null}, sent_at = CASE WHEN ${result.status} = 'sent' THEN now() ELSE sent_at END, lease_until = NULL, wait_reason = NULL, updated_at = now() WHERE id = ${application.id}`;
    await event(sql, application.id, provider, "provider_submission", result.status, result.error || null, { confirmation: result.confirmation || null, application_id: result.applicationId || null, follow_up: result.followUpRequired || null });
    return { status: 200, body: { ok: true, status: result.status, provider, reason: result.error || result.confirmation || null, application_id: application.id } };
  }

  return fail("manual_required", "provider_transport_pending", { provider, canonical_url: application.canonical_url });
}
