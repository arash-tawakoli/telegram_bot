import { prepareKleinanzeigenApplicantForm } from "../kleinanzeigen-application-profile.js";

// All providers consume the same applicant_profiles.profile. Provider-specific
// required questions are checked against each advertiser's live form, not stored
// as a second applicant profile.
export function providerDynamicReadiness(provider, form, profile = {}, message = "") {
  if (provider === "kleinanzeigen")
    return prepareKleinanzeigenApplicantForm(form, profile, message);
  const missing = providerStaticMissing(provider, profile, message);
  return { ok: missing.length === 0, error: missing.length ? "required_profile_data_missing" : null,
    missing: missing.map(label => ({ label })), unsupported: [], fields: [], payload: {} };
}

export function providerStaticMissing(_provider, profile = {}, message = "") {
  const missing = [];
  for (const [key, label] of [["first_name", "Vorname"], ["last_name", "Nachname"], ["email", "E-Mail-Adresse"]]) {
    if (!String(profile[key] || "").trim()) missing.push(label);
  }
  if (!String(message || profile.message || "").trim()) missing.push("Bewerbungstext");
  return missing;
}
