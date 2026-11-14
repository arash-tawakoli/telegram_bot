import { decryptProviderCredentials, encryptProviderCredentials } from "./provider-credentials.js";

const GQL = "https://gql-ps.immomio.com/tenant/graphql";
const ORIGIN = "https://tenant.immomio.com";
const REDIRECT = "https://tenant.immomio.com/de/auth/login";
const BASE = "https://sso.immomio.com/auth";
const REALM = "immomio";
const CLIENT = "immomio-oidc-web";
const APPLY = /^https:\/\/tenant\.immomio\.com\/(?:de\/)?apply\/[0-9a-f-]{36}\/?(?:[?#].*)?$/i;
const PROFILE_QUERY = "query currentUser { user { id email } }";
const PROPERTY_QUERY = "query propertyBySourceIdentifier($sourceIdentifier: ID!) { propertyBySourceIdentifier(sourceIdentifier: $sourceIdentifier) { id smsVerificationRequired captchaSettings { siteKey applicationSubmissionActive } } }";
const EXISTING_QUERY = "query checkApplicationExist($propertyId: ID!) { checkApplicationExist(propertyId: $propertyId) { id smsVerificationRequired } }";
const QUESTIONS_QUERY = "query applicationQuestions($id: ID!) { customQuestionsByProperty(id: $id) { customQuestions { key } questions { __typename } } }";
const CREATE_MUTATION = "mutation createApplication($userId: ID!, $propertyId: ID!, $captchaResponse: String) { createApplication(userId: $userId propertyId: $propertyId captchaResponse: $captchaResponse) { id status } }";
const APPLICATION_QUERY = "query propertyApplyProcessPSBean($id: ID!) { propertyApplyProcessPSBean(id: $id) { id status hasQuestions hasUnansweredQuestions smsVerificationRequired } }";

function clean(value, max = 4000) { return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
function value(profile, ...keys) { for (const key of keys) if (profile?.[key] != null && String(profile[key]).trim()) return String(profile[key]).trim(); return ""; }
function parse(value, fallback = {}) { if (value && typeof value === "object") return value; try { return JSON.parse(value || "{}"); } catch { return fallback; } }
function sourceIdentifier(facts) {
  const link = [facts?.applicationLink, facts?.application_link, facts?.applicationUrl, facts?.application_url].map((value) => String(value || "").trim()).find((value) => APPLY.test(value));
  if (!link) return null;
  try { return new URL(link).pathname.split("/").filter(Boolean).pop() || null; } catch { return null; }
}
function headers(token) { return { "content-type": "application/json", accept: "application/json", origin: ORIGIN, referer: `${ORIGIN}/`, "user-agent": "TraumWohnungHamburg/1.0", ...(token ? { authorization: token } : {}) }; }
async function gql(query, variables, token) {
  let response;
  try { response = await fetch(GQL, { method: "POST", headers: headers(token), body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(25_000) }); } catch { throw new Error("temporary_network_error"); }
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.errors?.length) return { response, body };
  return { response, body };
}
async function refresh(sql, env, application, credentials) {
  if (credentials?.access_token && Date.parse(credentials.expires_at || "") > Date.now() + 60_000) return credentials;
  if (!credentials?.refresh_token) throw new Error("needs_login");
  const response = await fetch(`${BASE}/realms/${REALM}/protocol/openid-connect/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: String(credentials.refresh_token), client_id: CLIENT }), signal: AbortSignal.timeout(25_000) }).catch(() => null);
  const token = await response?.json().catch(() => null);
  if (!response?.ok || !token?.access_token) throw new Error(response?.status === 401 || token?.error === "invalid_grant" ? "needs_login" : "temporary_network_error");
  const updated = { ...credentials, access_token: String(token.access_token), refresh_token: String(token.refresh_token || credentials.refresh_token), expires_at: new Date(Date.now() + Math.max(60, Number(token.expires_in || 300)) * 1000).toISOString() };
  const encrypted = await encryptProviderCredentials(env, updated, application.participant_id, "immomio");
  await sql`UPDATE provider_connections SET ciphertext=${encrypted.ciphertext}, iv=${encrypted.iv}, key_version=${encrypted.key_version}, expires_at=${updated.expires_at}, updated_at=CURRENT_TIMESTAMP WHERE participant_id=${application.participant_id} AND provider='immomio'`;
  return updated;
}

export async function refreshImmomioSession(sql, env, connection) {
  const application = {
    participant_id: connection.participant_id,
    connection_ciphertext: connection.ciphertext,
    connection_iv: connection.iv,
    connection_key_version: connection.key_version,
  };
  const credentials = await decryptProviderCredentials(env, {
    ciphertext: connection.ciphertext, iv: connection.iv, key_version: connection.key_version,
  }, connection.participant_id, "immomio");
  const refreshed = await refresh(sql, env, application, credentials);
  const user = await gql(PROFILE_QUERY, {}, refreshed.access_token);
  if (!user.response.ok || user.body?.errors?.length || !user.body?.data?.user?.id) {
    if ([401, 403].includes(user.response.status)) throw new Error("needs_login");
    throw new Error("temporary_network_error");
  }
  return refreshed;
}

export async function sendImmomioApplication(application, env, sql) {
  const profile = parse(application.profile);
  const facts = parse(application.facts);
  const source = sourceIdentifier(facts);
  if (!source) return { status: "manual_required", error: "application_link_missing" };
  let credentials;
  try { credentials = await refresh(sql, env, application, await decryptProviderCredentials(env, { ciphertext: application.connection_ciphertext, iv: application.connection_iv, key_version: application.connection_key_version }, application.participant_id, "immomio")); }
  catch (error) { return { status: "manual_required", error: ["needs_login", "temporary_network_error", "credential_decrypt_failed"].includes(String(error?.message || "")) ? String(error.message) : "provider_contract_unverified" }; }
  const user = await gql(PROFILE_QUERY, {}, credentials.access_token);
  if (!user.response.ok || user.body?.errors?.length || !user.body?.data?.user?.id) return { status: "manual_required", error: user.response.status === 401 || user.response.status === 403 ? "needs_login" : "provider_contract_unverified" };
  const accountId = String(user.body.data.user.id);
  const property = await gql(PROPERTY_QUERY, { sourceIdentifier: source }, credentials.access_token);
  if (!property.response.ok || property.body?.errors?.length) return { status: "manual_required", error: property.response.status === 404 ? "listing_unavailable" : "provider_contract_unverified" };
  const target = property.body?.data?.propertyBySourceIdentifier;
  if (!target?.id) return { status: "manual_required", error: "listing_unavailable" };
  if (target.smsVerificationRequired === true) return { status: "manual_required", error: "sms_verification_required" };
  if (target.captchaSettings?.applicationSubmissionActive === true && target.captchaSettings?.siteKey) return { status: "manual_required", error: "captcha_required" };
  const existing = await gql(EXISTING_QUERY, { propertyId: String(target.id) }, credentials.access_token);
  if (!existing.response.ok || existing.body?.errors?.length) return { status: "manual_required", error: "application_check_failed" };
  if (existing.body?.data?.checkApplicationExist?.id) return { status: "failed", error: "already_applied" };
  const questions = await gql(QUESTIONS_QUERY, { id: String(target.id) }, credentials.access_token);
  if (!questions.response.ok || questions.body?.errors?.length) return { status: "manual_required", error: "question_contract_unverified" };
  const custom = questions.body?.data?.customQuestionsByProperty?.customQuestions || [];
  if (custom.length) return { status: "manual_required", error: "dynamic_questions_required" };
  const created = await gql(CREATE_MUTATION, { userId: accountId, propertyId: String(target.id), captchaResponse: null }, credentials.access_token);
  if (!created.response.ok || created.body?.errors?.length || !created.body?.data?.createApplication?.id) return { status: "manual_required", error: "submission_unconfirmed" };
  const applicationId = String(created.body.data.createApplication.id);
  for (const delay of [500, 900, 1600, 2600]) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const check = await gql(EXISTING_QUERY, { propertyId: String(target.id) }, credentials.access_token);
    if (check.body?.data?.checkApplicationExist?.id === applicationId) {
      const detail = await gql(APPLICATION_QUERY, { id: applicationId }, credentials.access_token);
      const row = detail.body?.data?.propertyApplyProcessPSBean || {};
      return { status: "sent", confirmation: "immomio_application_created", applicationId, followUpRequired: row.smsVerificationRequired === true ? "sms_verification" : row.hasQuestions || row.hasUnansweredQuestions ? "questions" : null };
    }
  }
  return { status: "manual_required", error: "submission_unconfirmed", applicationId };
}
