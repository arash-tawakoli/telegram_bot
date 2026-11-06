const PROVIDERS = new Set(["immoscout24", "immowelt", "immomio"]);
import { sendImmoweltApplication } from "./immowelt-application.js";
import { sendImmoScoutApplication } from "./immoscout-application.js";

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
        p.first_name, p.last_name, p.email, p.telegram_chat_id,
        ap.profile,
        oi.canonical_url, oi.external_id, oi.facts,
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
        p.first_name, p.last_name, p.email, p.telegram_chat_id,
        ap.profile,
        oi.canonical_url, oi.external_id, oi.facts,
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
    await tx`UPDATE housing.applications SET status = 'processing', updated_at = now() WHERE id = ${rows[0].id} AND status = 'pending'`;
    return rows[0];
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

  // Provider transports stay fail-closed until their Cloudflare-native adapters are verified.
  return fail("manual_required", "provider_transport_pending", { provider, canonical_url: application.canonical_url });
}
