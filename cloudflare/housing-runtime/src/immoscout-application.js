import { decryptProviderCredentials, encryptProviderCredentials } from "./provider-credentials.js";
import { getCentralApplicationCredentials } from "./immoscout-central-token.js";

const TOKEN_URL = "https://login.immobilienscout24.de/oauth2/aus1227au6oBG6hGH417/v1/token";
const CLIENT_ID = "is24-android-de";
const USER_AGENT = "ImmoScout24_1458_34_._";

function value(profile, ...keys) {
  for (const key of keys) if (profile?.[key] != null && String(profile[key]).trim()) return String(profile[key]).trim();
  return "";
}

// Translate the user's persisted profile into the fields defined by Scout's
// contactFormConfiguration. Keep unknown values missing rather than inventing them.
const SCOUT_EMPLOYMENT = Object.freeze({
  EMPLOYEE: "Angestellte(r)", WORKER: "Arbeiter(in)",
  SELF_EMPLOYED: "Selbstständige(r)", CIVIL_SERVANT: "Beamte(r)",
  APPRENTICE: "Auszubildend", STUDENT: "Studierend",
  DOCTORAL: "Promovierend", HOMEMAKER: "Hausarbeit",
  JOBSEEKER: "Arbeitssuchend", RETIRED: "Im Ruhestand", OTHER: "Sonstiges",
});

// Preserve the historic ImmoScout24 dropdown labels; formatting an income
// range as arbitrary text can cause ERROR_RESOURCE_VALIDATION.
const SCOUT_INCOME_RANGES = Object.freeze({
  UNDER_500: "Unter 500€", "500_1000": "500€ - 1.000€",
  "1000_1500": "1.000€ - 1.500€", "1500_2000": "1.500€ - 2.000€",
  "2000_3000": "2.000€ - 3.000€", "3000_4000": "3.000€ - 4.000€",
  "4000_5000": "4.000€ - 5.000€", OVER_5000: "Über 5000€",
  "5000_6000": "Über 5000€", "6000_7000": "Über 5000€",
  OVER_7000: "Über 5000€",
});

function scoutIncome(profile) {
  const exact = Number(profile?.monthly_net_income);
  if (Number.isFinite(exact) && exact > 0) return Math.round(exact);
  return SCOUT_INCOME_RANGES[value(profile, "income_range").toUpperCase()];
}

function scoutMoveIn(profile) {
  const date = value(profile, "move_in_date");
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const preference = value(profile, "move_in_preference");
  return preference === "IMMEDIATE" ? "Sofort"
    : preference === "FLEXIBLE" ? "Flexibel" : undefined;
}

function scoutAddress(profile) {
  const street = value(profile, "street");
  const houseNumber = value(profile, "house_number");
  const postcode = value(profile, "postcode");
  const city = value(profile, "city");
  return street && houseNumber && /^\d{5}$/.test(postcode) && city ? {
    "@xsi.type": "common:Address", street, houseNumber, postcode, city,
  } : undefined;
}

function fieldKey(key) {
  return String(key).replace(/Field$/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function fieldValue(key, profile, message, packageUrl) {
  const k = fieldKey(key);
  if (k === "address") return scoutAddress(profile);
  if (k === "salutation") {
    const s = value(profile, "salutation").toUpperCase();
    return { MR: "MALE", MS: "FEMALE", COMPANY: "COMPANY",
      NEUTRAL: "NO_SALUTATION", NOT_SPECIFIED: "NO_SALUTATION", DIVERSE: "NO_SALUTATION" }[s];
  }
  if (k === "petsinhousehold") {
    const pets = profile?.pets;
    return typeof pets === "boolean" ? (pets ? "Ja" : "Nein")
      : value(profile, "pets") || undefined;
  }
  if (k === "numberofpersons") {
    const count = Number(profile?.household_size);
    return Number.isInteger(count) && count > 0 && count <= 30 ? count : undefined;
  }
  if (k === "employmentrelationship") {
    return SCOUT_EMPLOYMENT[value(profile, "employment_status").toUpperCase()];
  }
  if (k === "income") return scoutIncome(profile);
  if (k === "moveindate") return scoutMoveIn(profile);
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

// Official contact POST schema is ordered. The expose's contactFormType is
// descriptive metadata, not a valid attribute of the contact POST body.
// Only emit properties defined by this contract; optional provider extensions
// such as applicationPackageLink are placed in the message instead.
const CONTACT_SCHEMA_ORDER = Object.freeze([
  "firstname", "lastname", "phoneNumber", "emailAddress", "appointmentRequested",
  "message", "address", "contactMailCustomStyle", "moveInDate", "petsInHousehold",
  "numberOfPersons", "employmentRelationship", "income", "salutation",
  "schufaInformationProvided", "schufaVerificationCode", "sendProfile",
  "profileImageUrl", "privacyPolicyAccepted", "company", "buyReason",
  "ownCapital", "hasPreapproval", "lotAvailable", "numberOfRequiredWorkingPlaces",
  "plannedInvestment", "commercialUsage", "applicationPackageCompleted",
]);
const CONTACT_SCHEMA_FIELDS = new Set(CONTACT_SCHEMA_ORDER);

function prepare(config, profile, message, packageUrl) {
  const values = new Map();
  const missing = [];
  for (const [key, raw] of Object.entries(config || {})) {
    if (!String(key).endsWith("Field")) continue;
    const required = String(raw?.required || raw?.state || raw).toUpperCase() === "MANDATORY";
    const name = String(key).replace(/Field$/, "");
    if (!CONTACT_SCHEMA_FIELDS.has(name)) {
      if (required) missing.push(name);
      continue;
    }
    const candidate = fieldValue(name, profile, message, packageUrl);
    if (required && (candidate == null || candidate === "")) missing.push(name);
    if (candidate != null && candidate !== "") values.set(name, candidate);
  }
  if (!values.has("message") && String(message || "").trim()) values.set("message", String(message).trim());
  const form = { "@xmlns": { common: "http://rest.immobilienscout24.de/schema/common/1.0" } };
  for (const key of CONTACT_SCHEMA_ORDER) if (values.has(key)) form[key] = values.get(key);
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

// Store provider validation *field names and rule codes* only, never values.
// ImmoScout24 includes the submitted value in its ERROR_RESOURCE_VALIDATION
// text; retaining that text could leak emails, phone numbers or addresses.
const SAFE_VALIDATION_FIELDS = new Set([
  ...CONTACT_SCHEMA_ORDER, "street", "houseNumber", "postcode", "city",
  "address.street", "address.houseNumber", "address.postcode", "address.city",
]);
function safeValidationDetail(messages) {
  for (const message of messages) {
    if (typeof message !== "string" || message.length > 4000) continue;
    const match = /\[\s*MESSAGE\s*:\s*([A-Za-z][A-Za-z0-9_.]*)\s*:[\s\S]*:\s*([A-Z][A-Z0-9_]{2,63})\s*\]/.exec(message);
    if (match && SAFE_VALIDATION_FIELDS.has(match[1])) {
      return { provider_validation_field: match[1], provider_validation_rule: match[2] };
    }
  }
  return {};
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
  const contactFormType = String(expose?.["@contactFormType"] || "").toUpperCase();
  if (contactFormType === "NONE") return { status: "manual_required", error: "provider_contact_disabled" };
  const baseMessage = value(profile, "message", "message_apartment", "message_house") || "Anfrage zur Immobilie";
  const packageUrl = String(application.document_package_url || "");
  const suffix = packageUrl ? `\n\nBewerbungsunterlagen (geschützter Link): ${packageUrl}` : "";
  const message = suffix && baseMessage.length + suffix.length <= 4000 ? baseMessage + suffix : baseMessage;
  const prepared = prepare(expose?.contactFormConfiguration || {}, profile, message, packageUrl);
  if (prepared.missing.length) return { status: "manual_required", error: `required_profile_data_missing:${prepared.missing.join(",")}` };
  if (testMode) {
    if (typeof application.authorizeTestSend !== "function") return { status: "manual_required", error: "test_send_authorization_missing" };
    const authorized = await application.authorizeTestSend();
    if (!authorized) return { status: "manual_required", error: "test_send_not_authorized" };
  }
  const response = await fetch(`https://rest.immobilienscout24.de/restapi/api/search/v1.0/expose/${encodeURIComponent(id)}/contact`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${credentials.access_token}`, "user-agent": USER_AGENT },
    body: JSON.stringify({ "expose.contactForm": prepared.form }),
    signal: AbortSignal.timeout(30_000),
  });
  // Persist only a numeric HTTP status and the provider's machine-readable
  // code. Never store free-form responses, credentials or applicant details.
  const body = await response.text().catch(() => "");
  let machineCode = null;
  let validation = {};
  try {
    const parsed = JSON.parse(body);
    const messages = parsed?.["common.messages"];
    const codes = [
      parsed?.messageCode, parsed?.errorCode, parsed?.code,
      ...(Array.isArray(messages) ? messages.map(item => item?.message?.messageCode) : []),
    ];
    machineCode = codes.find(code => typeof code === "string" && /^[A-Z][A-Z0-9_]{1,79}$/.test(code)) || null;
    validation = safeValidationDetail([
      ...(Array.isArray(messages) ? messages.map(item => item?.message?.message) : []),
      parsed?.message?.message, parsed?.message,
    ]);
  } catch {
    machineCode = /<messageCode>([A-Z][A-Z0-9_]{1,79})<\/messageCode>/i.exec(body)?.[1] || null;
    validation = safeValidationDetail([...body.matchAll(/<message>([^<]{1,2000})<\/message>/g)].map(match => match[1]));
  }
  const diagnostics = { provider_http_status: response.status,
    ...(machineCode ? { provider_message_code: machineCode } : {}), ...validation };
  if (response.ok && !/^ERROR_/i.test(machineCode || "")) {
    return { status: "sent", confirmation: "official_rest_2xx", ...diagnostics };
  }
  if (response.status === 401 || response.status === 403) return { status: "manual_required", error: "needs_login", ...diagnostics };
  if (response.status === 404 || response.status === 410) return { status: "failed", error: "listing_unavailable", ...diagnostics };
  return { status: "manual_required",
    error: response.status >= 500 ? "provider_http_5xx" : "provider_rejected",
    ...diagnostics };
}
