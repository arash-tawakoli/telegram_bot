const ACCOUNT_HINT = "arash@nexalabs.de";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/i;

function requiredString(value, field, max = 4096) {
  if (typeof value !== "string" || !value || value.length > max) {
    throw new Error("legacy_" + field + "_invalid");
  }
  return value;
}

function utcTimestamp(value, field, required = false) {
  if (value == null || value === "") {
    if (required) throw new Error("legacy_" + field + "_invalid");
    return null;
  }
  const raw = String(value);
  const normalized = /(?:Z|[+-][0-9]{2}:?[0-9]{2})$/i.test(raw)
    ? raw
    : raw.replace(" ", "T") + "Z";
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) throw new Error("legacy_" + field + "_invalid");
  return parsed.toISOString();
}

function validateCredential(row) {
  if (!row || row.singleton !== "central") throw new Error("legacy_credentials_invalid");
  if (String(row.account_hint || "").toLowerCase() !== ACCOUNT_HINT) throw new Error("legacy_account_hint_invalid");
  requiredString(row.ciphertext, "credential_ciphertext");
  requiredString(row.iv, "credential_iv", 256);
  if (!Number.isInteger(Number(row.key_version)) || Number(row.key_version) < 1) {
    throw new Error("legacy_credential_key_version_invalid");
  }
  if (!["connected", "needs_login", "error"].includes(String(row.status))) {
    throw new Error("legacy_credential_status_invalid");
  }
  if (![0, 1].includes(Number(row.enabled))) throw new Error("legacy_credential_enabled_invalid");
}

function validateFlow(row) {
  if (!row || !HASH_RE.test(String(row.state_hash || ""))) throw new Error("legacy_oauth_state_invalid");
  requiredString(row.verifier_ciphertext, "oauth_ciphertext");
  requiredString(row.verifier_iv, "oauth_iv", 256);
  if (!UUID_RE.test(String(row.user_id || ""))) throw new Error("legacy_oauth_user_invalid");
  requiredString(String(row.admin_telegram_id || ""), "oauth_admin_id", 64);
  utcTimestamp(row.expires_at, "oauth_expires_at", true);
  utcTimestamp(row.created_at, "oauth_created_at", true);
  utcTimestamp(row.consumed_at, "oauth_consumed_at");
}

function validateAuditEvent(row) {
  if (!row || !Number.isSafeInteger(Number(row.id)) || Number(row.id) < 1) {
    throw new Error("legacy_audit_id_invalid");
  }
  requiredString(row.event_type, "audit_event_type", 160);
  if (row.account_hint != null && String(row.account_hint).length > 320) {
    throw new Error("legacy_audit_account_hint_invalid");
  }
  if (row.admin_telegram_id != null && String(row.admin_telegram_id).length > 64) {
    throw new Error("legacy_audit_admin_id_invalid");
  }
  utcTimestamp(row.created_at, "audit_created_at", true);
}

export async function importLegacyD1Snapshot(sql, snapshot, expectedKeyFingerprint) {
  if (!snapshot || typeof snapshot !== "object") throw new Error("legacy_snapshot_invalid");
  if (!/^[0-9a-f]{64}$/i.test(String(expectedKeyFingerprint || "")) ||
      String(snapshot.key_fingerprint || "").toLowerCase() !== String(expectedKeyFingerprint).toLowerCase()) {
    throw new Error("legacy_encryption_key_mismatch");
  }

  const credentials = snapshot.credentials ?? null;
  const oauthFlows = snapshot.oauth_flows ?? [];
  const auditEvents = snapshot.audit_events ?? [];
  if (!Array.isArray(oauthFlows) || !Array.isArray(auditEvents) || oauthFlows.length > 10000 || auditEvents.length > 10000) {
    throw new Error("legacy_snapshot_size_invalid");
  }
  if (credentials) validateCredential(credentials);
  oauthFlows.forEach(validateFlow);
  auditEvents.forEach(validateAuditEvent);

  return sql.begin(async (tx) => {
    let credentialsInserted = 0;
    let oauthFlowsInserted = 0;
    let auditEventsInserted = 0;

    if (credentials) {
      const rows = await tx.unsafe(
        "INSERT INTO app_private.immoscout_central_credentials (singleton, account_hint, ciphertext, iv, key_version, status, enabled, expires_at, last_verified_at, last_error, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10,$11::timestamptz) ON CONFLICT (singleton) DO NOTHING RETURNING singleton",
        [
          credentials.singleton,
          credentials.account_hint,
          credentials.ciphertext,
          credentials.iv,
          Number(credentials.key_version),
          credentials.status,
          Number(credentials.enabled),
          utcTimestamp(credentials.expires_at, "credential_expires_at"),
          utcTimestamp(credentials.last_verified_at, "credential_last_verified_at"),
          credentials.last_error == null ? null : String(credentials.last_error).slice(0, 1000),
          utcTimestamp(credentials.updated_at, "credential_updated_at", true),
        ],
      );
      credentialsInserted = rows.length ? 1 : 0;
    }

    for (const flow of oauthFlows) {
      const rows = await tx.unsafe(
        "INSERT INTO app_private.immoscout_central_oauth_flows (state_hash, verifier_ciphertext, verifier_iv, admin_telegram_id, user_id, expires_at, consumed_at, created_at) VALUES ($1,$2,$3,$4,$5::uuid,$6::timestamptz,$7::timestamptz,$8::timestamptz) ON CONFLICT (state_hash) DO NOTHING RETURNING state_hash",
        [
          flow.state_hash,
          flow.verifier_ciphertext,
          flow.verifier_iv,
          String(flow.admin_telegram_id),
          flow.user_id,
          utcTimestamp(flow.expires_at, "oauth_expires_at", true),
          utcTimestamp(flow.consumed_at, "oauth_consumed_at"),
          utcTimestamp(flow.created_at, "oauth_created_at", true),
        ],
      );
      oauthFlowsInserted += rows.length ? 1 : 0;
    }

    for (const event of auditEvents) {
      const rows = await tx.unsafe(
        "INSERT INTO app_private.immoscout_central_audit_events (id, event_type, account_hint, admin_telegram_id, created_at) VALUES ($1,$2,$3,$4,$5::timestamptz) ON CONFLICT (id) DO NOTHING RETURNING id",
        [
          Number(event.id),
          event.event_type,
          event.account_hint == null ? null : String(event.account_hint),
          event.admin_telegram_id == null ? null : String(event.admin_telegram_id),
          utcTimestamp(event.created_at, "audit_created_at", true),
        ],
      );
      auditEventsInserted += rows.length ? 1 : 0;
    }

    const sequence = await tx.unsafe(
      "SELECT COALESCE(MAX(id), 0)::bigint AS max_id FROM app_private.immoscout_central_audit_events",
    );
    const maxId = Number(sequence[0]?.max_id || 0);
    if (maxId > 0) {
      await tx.unsafe(
        "SELECT setval(pg_get_serial_sequence('app_private.immoscout_central_audit_events', 'id'), $1, true)",
        [maxId],
      );
    }

    return {
      credentials: credentialsInserted,
      oauth_flows: oauthFlowsInserted,
      audit_events: auditEventsInserted,
    };
  });
}
