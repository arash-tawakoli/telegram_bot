import { decryptProviderCredentials, encryptProviderCredentials } from "./provider-credentials.js";
import { getCentralApplicationCredentials } from "./immoscout-central-token.js";
import { refreshImmoweltCookies } from "./immowelt-auth.js";

const PROVIDERS = new Set(["immoscout24", "immowelt", "immomio", "kleinanzeigen"]);
const OWNER_TELEGRAM_ID = 8538226539;

const REFRESH_ENDPOINTS = {
  immomio: "https://sso.immomio.com/auth/realms/immomio/protocol/openid-connect/token",
};

async function refreshCentralProvider(sql, env, provider, row, credentials, force = false) {
  let refreshed, expiresAt;
  if (provider === "kleinanzeigen") {
    if (!credentials.refresh_token || !credentials.oauth_client_id) throw new Error("needs_login");
    const response = await fetch("https://login.kleinanzeigen.de/oauth/token", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token",
        refresh_token: String(credentials.refresh_token),
        client_id: String(credentials.oauth_client_id) }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => { throw new Error("temporary_network_error"); });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.access_token) throw new Error("needs_login");
    expiresAt = new Date(Date.now() + Math.max(60, Number(payload.expires_in || 600)) * 1000).toISOString();
    refreshed = { ...credentials, access_token: String(payload.access_token),
      refresh_token: String(payload.refresh_token || credentials.refresh_token), expires_at: expiresAt };
  } else if (provider === "immowelt") {
    if (!Array.isArray(credentials.cookies) || !credentials.cookies.length) throw new Error("needs_login");
    refreshed = await refreshImmoweltCookies(credentials, force);
    expiresAt = refreshed.expires_at || null;
  } else {
    if (!credentials.refresh_token) throw new Error("needs_login");
    const clientId = "immomio-oidc-web";
    const form = new URLSearchParams({
      grant_type: "refresh_token", client_id: clientId, refresh_token: String(credentials.refresh_token),
    });
    const response = await fetch(REFRESH_ENDPOINTS[provider], {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    const payload = await response?.json().catch(() => null);
    if (!response?.ok || !payload?.access_token) throw new Error("needs_login");
    expiresAt = new Date(Date.now() + Math.max(60, Number(payload.expires_in || 300)) * 1000).toISOString();
    refreshed = {
      ...credentials,
      access_token: String(payload.access_token),
      refresh_token: String(payload.refresh_token || credentials.refresh_token),
      expires_at: expiresAt,
    };
  }
  const encrypted = await encryptProviderCredentials(env, refreshed, row.participant_id, provider);
  await sql`
    UPDATE housing.provider_connections
    SET ciphertext = ${encrypted.ciphertext}, iv = ${encrypted.iv},
        key_version = ${encrypted.key_version}, expires_at = ${expiresAt},
        updated_at = CURRENT_TIMESTAMP
    WHERE participant_id = ${row.participant_id} AND provider = ${provider}
      AND status = 'connected'
  `;
  return refreshed;
}

// Immowelt and Immomio use the administrator's existing encrypted connection.
// These credentials are never read from the applicant's provider_connections row.
export async function getCentralProviderCredentials(sql, env, provider, { testMode = false } = {}) {
  if (!PROVIDERS.has(provider)) throw new Error("provider_not_allowlisted");
  if (provider === "immoscout24") {
    return { credentials: await getCentralApplicationCredentials(env, { testMode }), ownerId: null };
  }

  const rows = await sql`
    SELECT pc.participant_id, pc.status, pc.ciphertext, pc.iv, pc.key_version, pc.account_hint, pc.expires_at, pc.updated_at
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
  let credentials = await decryptProviderCredentials(env, row, row.participant_id, provider);
  if (!credentials || typeof credentials !== "object") throw new Error("central_provider_unavailable");
  const expiry = Date.parse(String(credentials.expires_at || row.expires_at || ""));
  const updatedAt = Date.parse(String(row.updated_at || ""));
  const hourlyProviderRefresh = ["immowelt", "immomio"].includes(provider) &&
    Number.isFinite(updatedAt) && updatedAt <= Date.now() - 55 * 60_000;
  const cookieSession = provider === "immowelt" && Array.isArray(credentials.cookies) && credentials.cookies.length > 0;
  if (cookieSession) {
    if (!credentials.cookies.some((cookie) => cookie.name === "oauth.access.token")) throw new Error("needs_login");
    if (hourlyProviderRefresh || (Number.isFinite(expiry) && expiry < Date.now() + 60_000))
      credentials = await refreshCentralProvider(sql, env, provider, row, credentials, hourlyProviderRefresh);
  } else if ((Number.isFinite(expiry) && expiry < Date.now() + 60_000) ||
      (provider === "immomio" && hourlyProviderRefresh)) {
    if (!credentials.refresh_token) throw new Error("needs_login");
    credentials = await refreshCentralProvider(sql, env, provider, row, credentials);
  }
  if (!credentials.access_token && !(provider === "immowelt" && cookieSession)) throw new Error("needs_login");
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
