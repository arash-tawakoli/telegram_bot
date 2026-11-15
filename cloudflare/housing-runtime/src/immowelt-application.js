import { getCentralProviderCredentials } from "./central-provider-credentials.js";

function xml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function profileValue(profile, ...keys) {
  for (const key of keys) if (profile?.[key] != null && String(profile[key]).trim()) return String(profile[key]).trim();
  return "";
}

function estateId(url, fallback) {
  const raw = String(url || "").match(/\/expose\/([^/?#]+)/i)?.[1] || String(fallback || "");
  try { return decodeURIComponent(raw).replace(/[{}-]/g, "").toUpperCase(); } catch { return raw.replace(/[{}-]/g, "").toUpperCase(); }
}

export async function sendImmoweltApplication(application, env, sql, central = null) {
  const profile = application.profile || {};
  const email = profileValue(profile, "email");
  const firstName = profileValue(profile, "first_name", "firstname");
  const lastName = profileValue(profile, "last_name", "lastname");
  const url = String(application.canonical_url || "");
  if (!/^https:\/\/www\.immowelt\.de\/expose\//i.test(url) || !email || !firstName || !lastName) {
    return { status: "manual_required", error: "required_profile_data_missing" };
  }
  const id = estateId(url, application.external_id);
  if (!/^[0-9A-F]{32}$/.test(id)) return { status: "manual_required", error: "provider_identifier_unresolved" };
  // Immowelt's saved central credential is an authenticated browser session.
  // Only same-site cookies valid for the API host may accompany a request.
  const connection = central || await getCentralProviderCredentials(sql, env, "immowelt");
  const cookies = connection.credentials.cookies.filter((cookie) => {
    const domain = String(cookie.domain || "").toLowerCase();
    const expiry = Number(cookie.expires);
    return (domain === "immowelt.de" || domain === ".immowelt.de")
      && /^[a-z0-9_.-]{1,240}$/i.test(String(cookie.name || ""))
      && typeof cookie.value === "string" && cookie.value.length > 0
      && (!Number.isFinite(expiry) || expiry < 0 || expiry * 1000 > Date.now() + 60_000);
  });
  if (!cookies.length) return { status: "manual_required", error: "needs_login" };
  // SOAP authentication and on-behalf-of delivery have not been verified.
  if (env.CENTRAL_IMMOWELT_TRANSPORT_VERIFIED !== "1") {
    return { status: "manual_required", error: "provider_contract_unverified" };
  }
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const phone = profileValue(profile, "phone");
  const message = profileValue(profile, "message", "message_apartment", "message_house") || "Anfrage zur Immobilie";
  const soap = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
 <soap:Body>
  <SendContactMail xmlns="http://immowelt.de/services"><request>
   <LinkToDetail>${xml(url)}</LinkToDetail><EstateGuid>${xml(id)}</EstateGuid>
   <Enquirer><Name>${xml(`${firstName} ${lastName}`)}</Name><EMail>${xml(email)}</EMail><Phone>${xml(phone)}</Phone></Enquirer>
   <Message>${xml(message.slice(0, 7000))}</Message><Domain>immowelt.de</Domain><SubjectType>Anfrage zur Immobilie</SubjectType>
  </request></SendContactMail>
 </soap:Body>
</soap:Envelope>`;
  let response;
  let text = "";
  try {
    response = await fetch("https://api.immowelt.de/WebServices/CommunicationService.asmx", {
      method: "POST",
      headers: { cookie: cookieHeader, "content-type": "text/xml; charset=utf-8", soapaction: '"http://immowelt.de/services/SendContactMail"', accept: "text/xml,application/xml" },
      body: soap,
      signal: AbortSignal.timeout(30_000),
    });
    text = await response.text();
  } catch {
    return { status: "manual_required", error: "submission_unconfirmed" };
  }
  if (response.ok && /<SendContactMailResult>\s*true\s*<\/SendContactMailResult>/i.test(text)) {
    return { status: "sent", confirmation: "immowelt_communication_service" };
  }
  if (/<SendContactMailResult>\s*false\s*<\/SendContactMailResult>/i.test(text)) return { status: "manual_required", error: "provider_rejected" };
  return { status: "manual_required", error: "submission_unconfirmed" };
}
