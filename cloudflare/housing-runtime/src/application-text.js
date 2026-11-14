// Shared template contract: store [[Vorname]] unchanged, insert the person's first name only when displayed or sent.
export const DEFAULT_APPLICATION_TEXT = `Sehr geehrte Damen und Herren,

ich bin [[Vorname]] und interessiere mich für die angebotene Immobilie. Gerne würde ich einen Besichtigungstermin vereinbaren.

Ich freue mich über Ihre Rückmeldung.

Mit freundlichen Grüßen
[[Vorname]]`;

export function resolveApplicationText(template, firstName) {
  const first = String(firstName ?? "").trim();
  const source = String(template ?? "").trim() || DEFAULT_APPLICATION_TEXT;
  // Never invent a first name; the application-policy validator requires one.
  return source.replace(/\[\[\s*Vorname\s*\]\]/gi, first || "[[Vorname]]");
}

export function effectiveApplicationMessages(profile = {}) {
  const firstName = String(profile.first_name ?? "").trim();
  return {
    ...profile,
    message_apartment: resolveApplicationText(profile.message_apartment, firstName),
    message_house: resolveApplicationText(profile.message_house, firstName),
    ...(profile.message ? { message: resolveApplicationText(profile.message, firstName) } : {}),
  };
}
