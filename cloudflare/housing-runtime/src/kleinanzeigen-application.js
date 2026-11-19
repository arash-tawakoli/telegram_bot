import { providerSendEnabled } from "./application-policy.js";
import { getCentralProviderCredentials } from "./central-provider-credentials.js";
import { prepareKleinanzeigenApplicantForm, describeKleinanzeigenForm } from "./kleinanzeigen-application-profile.js";

const GATEWAY = "https://gateway.kleinanzeigen.de";
const CONTACT = (id) => GATEWAY + "/user-contactdetails/api/v1/ad/" + id + "/contact-form";
const clean = (value) => String(value ?? "").trim();

export function kleinanzeigenListingId(application) {
  const raw = clean(application.canonical_url);
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || !["www.kleinanzeigen.de", "kleinanzeigen.de"].includes(url.hostname)) return null;
  const hit = url.pathname.match(/^\/s-anzeige\/[^/]+\/(\d{6,20})\/?$/);
  const id = hit?.[1] || null;
  const external = clean(application.external_id).match(/\d{6,20}/)?.[0];
  if (external && id && external !== id) return null;
  return id;
}

export function personalizedKleinanzeigenMessage(profile, template) {
  const first = clean(profile.first_name), last = clean(profile.last_name);
  const email = clean(profile.email);
  if (!first || !last || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const body = clean(template);
  if (!body) return null;
  // The actual platform sender remains the central authenticated account.
  const identity = "\n\nBewerber/in: " + first + " " + last
    + "\nE-Mail für Rückfragen: " + email
    + (clean(profile.phone) ? "\nTelefon: " + clean(profile.phone) : "");
  if (body.length + identity.length > 3800) return null;
  return body + identity;
}

function responseError(status) {
  if (status === 401 || status === 403) return "needs_login";
  if (status === 404 || status === 410) return "listing_unavailable";
  if (status === 429 || status >= 500) return "temporary_network_error";
  return "provider_contract_unverified";
}

function headers(credentials, content = false) {
  return {
    accept: "application/json", "accept-language": "de-DE",
    authorization: "Bearer " + credentials.access_token,
    ...(credentials.x_ebayk_app ? {
      "x-ebayk-app": String(credentials.x_ebayk_app),
      "x-ecg-user-agent": "ebayk-android-app-2026.37.1",
      "x-ecg-user-version": "2026.37.1",
    } : {}),
    ...(content ? { "content-type": "application/json" } : {}),
  };
}

async function providerRequest(id, credentials, method, payload) {
  let response;
  try {
    response = await fetch(CONTACT(id), {
      method,
      headers: { ...headers(credentials, method === "POST"),
        ...(method === "POST" ? { "X-EBAYK-WENKSE-SESSION-ID": crypto.randomUUID().replace(/-/g, "") } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) { return { error: method === "POST" ? "submission_unconfirmed" : "temporary_network_error",
      failure_stage: method === "POST" ? "post_fetch_exception" : "get_fetch_exception",
      failure_kind: ["AbortError","TimeoutError","TypeError"].includes(String(error?.name)) ? String(error.name) : "other" }; }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return { error: method === "POST" && (response.status === 429 || response.status >= 500)
      ? "submission_unconfirmed" : responseError(response.status),
      provider_http_status: response.status, failure_stage: method === "POST" ? "post_http_error" : "get_http_error" };
  }
  return { data, provider_http_status: response.status };
}

export async function sendKleinanzeigenApplication(application, env, sql, central = null) {
  // The historical private contact endpoint is not a published partner transport.
  // Normal sends are gated in the runtime; test sends are gated here.
  if (application.test_mode && !providerSendEnabled(env, "kleinanzeigen"))
    return { status: "manual_required", error: "provider_contract_unverified" };
  const id = kleinanzeigenListingId(application);
  if (!id) return { status: "manual_required", error: "provider_identifier_unresolved" };

  const profile = application.profile || {};
  const message = personalizedKleinanzeigenMessage(profile, profile.message);
  if (!message) return { status: "manual_required", error: "required_profile_data_missing" };

  let connected;
  try { connected = central || await getCentralProviderCredentials(sql, env, "kleinanzeigen"); }
  catch { return { status: "manual_required", error: "needs_login" }; }
  const credentials = connected?.credentials;
  if (!clean(credentials?.access_token))
    return { status: "manual_required", error: "needs_login" };

  const inspected = await providerRequest(id, credentials, "GET");
  if (inspected.error)
    return { status: "manual_required", error: inspected.error, provider_http_status: inspected.provider_http_status };

  const mapped = prepareKleinanzeigenApplicantForm(inspected.data, profile, message);
  if (!mapped.ok) return {
    status: "manual_required", error: mapped.error,
    form_diagnostic: describeKleinanzeigenForm(inspected.data),
    required_fields: mapped.fields.map((item) => item.id),
    missing_fields: mapped.missing.map((item) => item.id),
    unsupported_fields: mapped.unsupported.map((item) => item.id),
  };
  for (const [key, value] of Object.entries(mapped.payload)) {
    if (/(email|mailadresse|mailaddress)/i.test(key)
        && clean(value).toLowerCase() !== clean(profile.email).toLowerCase())
      return { status: "manual_required", error: "central_identity_mismatch" };
  }
  if (!Object.keys(mapped.payload).some((key) => /message|nachricht|anschreiben/i.test(key)))
    return { status: "manual_required", error: "message_field_unavailable" };

  // Irreversible network I/O starts only after the existing one-use
  // application reservation is durably granted by the queue processor.
  const authorize = application.test_mode ? application.authorizeTestSend : application.authorizeSend;
  if (typeof authorize !== "function" || await authorize() !== true)
    return { status: "manual_required", error: application.test_mode ? "test_send_not_authorized" : "send_not_authorized" };

  const submitted = await providerRequest(id, credentials, "POST", mapped.payload);
  if (submitted.error)
    return { status: "manual_required", error: submitted.error,
      provider_http_status: submitted.provider_http_status,
      failure_stage: submitted.failure_stage || null, failure_kind: submitted.failure_kind || null };
  const result = submitted.data;
  const responseKeys = result && typeof result === "object" && !Array.isArray(result)
    ? Object.keys(result).filter(key => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)).slice(0, 20) : [];
  if (!result || result.success === false || result.ok === false || result.error || result.errors)
    return { status: "manual_required", error: "submission_unconfirmed",
      provider_http_status: submitted.provider_http_status, failure_stage: "post_response_rejected",
      provider_response_keys: responseKeys };
  const conversationValue = result.conversationId ?? result.data?.conversationId
    ?? result.conversation?.id ?? result.data?.conversation?.id;
  const conversation = conversationValue && typeof conversationValue === "object"
    ? conversationValue.value ?? conversationValue.id : conversationValue;
  if (!conversation || !/^[a-z0-9:_-]{3,128}$/i.test(String(conversation)))
    return { status: "manual_required", error: "submission_unconfirmed",
      provider_http_status: submitted.provider_http_status, failure_stage: "post_confirmation_missing",
      provider_response_keys: responseKeys };
  return {
    status: "sent", confirmation: "kleinanzeigen_conversation_created",
    conversationId: String(conversation), provider_http_status: submitted.provider_http_status,
  };
}
