import { decryptProviderCredentials, encryptProviderCredentials } from "./provider-credentials.js";
import { getCentralApplicationCredentials } from "./immoscout-central-token.js";

const TOKEN_URL = "https://login.immobilienscout24.de/oauth2/aus1227au6oBG6hGH417/v1/token";
const CLIENT_ID = "is24-android-de";
const USER_AGENT = "ImmoScout24_1458_34_._";

function value(profile, ...keys) {
  for (const key of keys) if (profile?.[key] != null && String(profile[key]).trim()) return String(profile[key]).trim();
  return "";
}

function fieldKey(key) {
  return String(key).replace(/Field$/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function fieldValue(key, profile, message, packageUrl) {
  const k = fieldKey(key);
  if (/first(name|givenname|vorname)/.test(k)) return value(profile, "first_name", "firstname");
  if (/last(name|surname|familyname|nachname)/.test(k)) return value(profile, "last_name", "lastname");
  if (/email/.test(k)) return value(profile, "email");
  if (/phone|telefon|mobil/.test(k)) return value(profile, "phone");
  if (/street|strasse|adresse|address/.test(k)) return value(profile, "street");
  if (/house(number|nr)|hausnummer/.test(k)) return value(profile, "house_number");
  if (/post(code|al)|zip|plz/.test(k)) return value(profile, "postcode");
  if (/city|stadt|ort/.test(k)) return value(profile, "city");
  if (/applicationpackagecompleted/.test(k)) return Boolean(packageUrl);
  if (/applicationpackagelink/.test(k)) return packageUrl || undefined;
  if (/message|nachricht|bewerbung|contact/.test(k)) return String(message || "").trim();
  if (/privacy|datenschutz/.test(k)) return true;
  if (Object.prototype.hasOwnProperty.call(profile || {}, key)) return profile[key];
  return undefined;
}

function prepare(config, profile, message, packageUrl) {
  const form = { "@xmlns": { common: "http://rest.immobilienscout24.de/schema/common/1.0" } };
  const missing = [];
  for (const [key, raw] of Object.entries(config || {})) {
    if (!String(key).endsWith("Field")) continue;
    const required = String(raw?.required || raw?.state || raw).toUpperCase() === "MANDATORY";
    const name = String(key).replace(/Field$/, "");
    const candidate = fieldValue(name, profile, message, packageUrl);
    if (required && (candidate == null || candidate === "")) missing.push(name);
    if (candidate != null && candidate !== "") form[name] = candidate;
  }
  if (!form.message && String(message || "").trim()) form.message = String(message).trim();
  return { form, missing };
}

async function refresh(env, row, participantId, credentials) {
  if (credentials?.access_token && (!credentials.expires_at || Date.parse(credentials.expires_at) > Date.now() + 60_000)) return credentials;
  if (!credentials?.refresh_token) throw new Error("needs_login");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": "okta-oauth2-kotlin/2.0.3 Android/34" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: String(credentials.refresh_token), client_id: CLIENT_ID }),
    signal: AbortSignal.timeout(25_000),
  });
  const token = await response.json().catch(() => null);
  if (!response.ok || !token?.access_token) throw new Error(response.status === 401 ? "needs_login" : "temporary_network_error");
  const updated = { ...credentials, access_token: String(token.access_token), refresh_token: String(token.refresh_token || credentials.refresh_token), expires_at: new Date(Date.now() + Math.max(60, Number(token.expires_in || 3600)) * 1000).toISOString() };
  const encrypted = await encryptProviderCredentials(env, updated, participantId, "immoscout24");
  await row.sql`UPDATE housing.provider_connections SET ciphertext = ${encrypted.ciphertext}, iv = ${encrypted.iv}, key_version = ${encrypted.key_version}, expires_at = ${updated.expires_at}::timestamptz, updated_at = now() WHERE participant_id = ${participantId} AND provider = 'immoscout24'`;
  return updated;
}

export async function refreshImmoScoutSession(sql, env, connection) {
  const row = { ciphertext: connection.ciphertext, iv: connection.iv, key_version: connection.key_version, sql };
  const credentials = await decryptProviderCredentials(env, row, connection.participant_id, "immoscout24");
  return refresh(env, row, connection.participant_id, credentials);
}

export async function sendImmoScoutApplication(application, env, sql, central = null) {
  const profile = application.profile || {};
  const id = String(application.external_id || "").match(/\d{6,20}/)?.[0] || String(application.canonical_url || "").match(/\/expose\/(\d{6,20})/)?.[1];
  if (!id) return { status: "manual_required", error: "provider_identifier_unresolved" };
  const testMode = application.test_mode === true || application.test_mode === 1;
  // Auto-apply never authenticates with the participant's provider connection.
  const credentials = central?.credentials || await getCentralApplicationCredentials(env, { testMode });
  const detailResponse = await fetch(`https://rest.immobilienscout24.de/restapi/api/search/v1.0/expose/${encodeURIComponent(id)}`, { headers: { accept: "application/json", authorization: `Bearer ${credentials.access_token}`, "user-agent": USER_AGENT }, signal: AbortSignal.timeout(25_000) });
  if (detailResponse.status === 401 || detailResponse.status === 403) return { status: "manual_required", error: "needs_login" };
  const detail = await detailResponse.json().catch(() => null);
  if (!detailResponse.ok || !detail) return { status: detailResponse.status >= 500 ? "manual_required" : "failed", error: detailResponse.status === 404 ? "listing_unavailable" : "provider_contract_unverified" };
  const expose = detail?.["expose.expose"] || detail?.expose || detail;
  const baseMessage = value(profile, "message", "message_apartment", "message_house") || "Anfrage zur Immobilie";
  const packageUrl = String(application.document_package_url || "");
  const suffix = packageUrl ? `\n\nBewerbungsunterlagen (geschützter Link): ${packageUrl}` : "";
  const message = suffix && baseMessage.length + suffix.length <= 4000 ? baseMessage + suffix : baseMessage;
  const prepared = prepare(expose?.contactFormConfiguration || {}, profile, message, packageUrl);
  if (prepared.missing.length) return { status: "manual_required", error: `required_profile_data_missing:${prepared.missing.join(",")}` };
  if (testMode) {
    if (typeof application.authorizeTestSend !== "function") return { status: "manual_required", error: "test_send_authorization_missing" };
    const authorized = await application.authorizeTestSend();
    if (!authorized) return { status: "manual_required", error: "test_send_authorization_failed" };
  }
  const response = await fetch(`https://rest.immobilienscout24.de/restapi/api/search/v1.0/expose/${encodeURIComponent(id)}/contact`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${credentials.access_token}`, "user-agent": USER_AGENT },
    body: JSON.stringify({ "expose.contactForm": prepared.form }),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.ok) return { status: "sent", confirmation: "official_rest_2xx" };
  if (response.status === 401 || response.status === 403) return { status: "manual_required", error: "needs_login" };
  if (response.status === 404 || response.status === 410) return { status: "failed", error: "listing_unavailable" };
  return { status: "manual_required", error: response.status >= 500 ? "provider_http_5xx" : "provider_rejected" };
}
