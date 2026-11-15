import { decryptProviderCredentials } from "./provider-credentials.js";
import { getCentralApplicationCredentials } from "./immoscout-central-token.js";

const PROVIDERS = new Set(["immoscout24", "immowelt", "immomio"]);
const OWNER_TELEGRAM_ID = 8538226539;

// Immowelt and Immomio use the administrator's existing encrypted connection.
// These credentials are never read from the applicant's provider_connections row.
export async function getCentralProviderCredentials(sql, env, provider, { testMode = false } = {}) {
  if (!PROVIDERS.has(provider)) throw new Error("provider_not_allowlisted");
  if (provider === "immoscout24") {
    return { credentials: await getCentralApplicationCredentials(env, { testMode }), ownerId: null };
  }

  const rows = await sql`
    SELECT pc.participant_id, pc.status, pc.ciphertext, pc.iv, pc.key_version, pc.account_hint, pc.expires_at
    FROM housing.provider_connections pc
    JOIN housing.participants owner ON owner.id = pc.participant_id
    WHERE owner.telegram_user_id = ${OWNER_TELEGRAM_ID}
      AND owner.status = 'active' AND pc.provider = ${provider}
    LIMIT 1
  `;
  const row = rows[0];
  if (row?.status !== "connected" || !row.ciphertext || !row.iv) {
    throw new Error("central_provider_unavailable");
  }
  if (provider === "immowelt" && row.expires_at && Date.parse(row.expires_at) < Date.now() + 60_000) {
    throw new Error("needs_login");
  }
  const credentials = await decryptProviderCredentials(env, row, row.participant_id, provider);
  if (!credentials || typeof credentials !== "object") throw new Error("central_provider_unavailable");
  if (provider === "immomio" && !credentials.access_token && !credentials.refresh_token) {
    throw new Error("needs_login");
  }
  if (provider === "immowelt" && (!Array.isArray(credentials.cookies) || credentials.cookies.length === 0)) {
    throw new Error("needs_login");
  }
  return { credentials, ownerId: row.participant_id, accountHint: row.account_hint || null };
}

export function centralCredentialError(error) {
  const reason = String(error?.message || "");
  const allowed = new Set([
    "central_provider_unavailable", "test_mode_central_account_unavailable",
    "central_account_mismatch", "central_identity_mismatch",
    "needs_login", "temporary_network_error", "credential_decrypt_failed",
    "provider_contract_unverified",
  ]);
  return allowed.has(reason) ? reason : "provider_contract_unverified";
}
