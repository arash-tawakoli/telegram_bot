export function providerStaticMissing(_provider, profile = {}, message = "") {
  const missing = [];
  for (const [key, label] of [["first_name", "Vorname"], ["last_name", "Nachname"], ["email", "E-Mail-Adresse"]]) {
    if (!String(profile[key] || "").trim()) missing.push(label);
  }
  if (!String(message || profile.message || "").trim()) missing.push("Bewerbungstext");
  return missing;
}
