const REQUIRED_ENUMS = {
  salutation: ["MR", "MS", "DIVERSE", "NEUTRAL", "NOT_SPECIFIED", "COMPANY"],
  household_type: ["SINGLE", "TWO_ADULTS", "FAMILY", "SHARED_FLAT", "NOT_SPECIFIED"],
  employment_status: ["EMPLOYEE", "WORKER", "SELF_EMPLOYED", "CIVIL_SERVANT", "APPRENTICE", "STUDENT", "DOCTORAL", "HOMEMAKER", "JOBSEEKER", "RETIRED", "OTHER", "NOT_SPECIFIED"],
  income_range: ["UNDER_500", "500_1000", "1000_1500", "1500_2000", "2000_3000", "3000_4000", "4000_5000", "OVER_5000", "5000_6000", "6000_7000", "OVER_7000", "HOUSING_BENEFIT", "NOT_SPECIFIED"],
  move_in_preference: ["NOT_SPECIFIED", "FLEXIBLE", "IMMEDIATE", "EXACT_DATE", "WITHIN_1_MONTH", "WITHIN_3_MONTHS", "AFTER_3_MONTHS"],
  schufa_status: ["NOT_SPECIFIED", "AVAILABLE", "NOT_AVAILABLE"],
};

function parse(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || "{}"); } catch { return fallback; }
}

export function timestampMillis(value) {
  const text = String(value || "").replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T");
  return Date.parse(text.endsWith("+00") ? `${text.slice(0, -3)}Z` : text);
}

export function missingApplicantFields(value) {
  const profile = parse(value);
  const missing = [];
  const text = (key) => String(profile[key] ?? "").trim();
  const required = [
    ["first_name", "Vorname"], ["last_name", "Nachname"], ["street", "Straße"],
    ["house_number", "Hausnummer"], ["city", "Ort"], ["pets", "Haustiere"],
    // WBS is required only for explicitly WBS-restricted listings.\n    // Both apartment and house texts have a safe default containing [[Vorname]].
  ];
  for (const [key, label] of required) if (!text(key)) missing.push(label);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text("email"))) missing.push("E-Mail-Adresse");
  if (text("phone").replace(/\D/g, "").length < 7) missing.push("Telefonnummer");
  if (!/^\d{5}$/.test(text("postcode"))) missing.push("PLZ");
  for (const [key, values] of Object.entries(REQUIRED_ENUMS)) if (!values.includes(text(key))) missing.push(key);
  if (profile.move_in_preference === "EXACT_DATE" && !text("move_in_date")) missing.push("Einzugstermin");
  return missing;
}

export function premiumParticipant(row, now = Date.now()) {
  if (row.plan_override === "free") return false;
  const override = timestampMillis(row.plan_override_expires_at);
  if (row.plan_override === "premium" && (!row.plan_override_expires_at || override > now)) return true;
  if (timestampMillis(row.referral_bonus_until) > now) return true;
  const periodEnd = timestampMillis(row.subscription_period_end);
  return ["active", "trialing"].includes(String(row.subscription_status))
    && (!row.subscription_period_end || periodEnd > now);
}

export function applicationSchedule(preferences, now = new Date()) {
  const timezone = String(preferences?.timezone || "Europe/Berlin");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  const localDate = `${part("year")}-${part("month")}-${part("day")}`;
  const weekday = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[part("weekday")];
  let allowed = preferences?.allowed_weekdays;
  if (typeof allowed === "string") {
    try { allowed = JSON.parse(allowed); } catch { allowed = allowed.match(/\d+/g)?.map(Number) || []; }
  }
  if (!Array.isArray(allowed) || !allowed.length) allowed = [1, 2, 3, 4, 5, 6, 7];
  const nowMinutes = Number(part("hour")) * 60 + Number(part("minute"));
  const parseTime = (value) => {
    const match = String(value || "").match(/^(\d{2}):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const start = parseTime(preferences?.send_window_start);
  const end = parseTime(preferences?.send_window_end);
  let reason = null;
  if (!allowed.map(Number).includes(weekday)) reason = "weekday_blocked";
  else if ((start !== null || end !== null) && (start === null || end === null
    || (start <= end ? nowMinutes < start || nowMinutes > end : nowMinutes < start && nowMinutes > end))) {
    reason = "outside_send_window";
  }
  const delay = reason === "weekday_blocked" ? 6 * 60_000 : 15 * 60_000;
  return { allowed: reason === null, reason, localDate, nextAttemptAt: new Date(now.getTime() + delay).toISOString() };
}

export function applicationProvider(source, facts = {}) {
  const url = String(facts.canonical_url || facts.applicationLink || facts.application_link || facts.applicationUrl || facts.application_url || "");
  if (source?.family === "immoscout24" && /^https:\/\/(?:www\.)?immobilienscout24\.de\/expose\//i.test(url)) return "immoscout24";
  if (source?.family === "immowelt" && /^https:\/\/www\.immowelt\.de\/expose\//i.test(url)) return "immowelt";
  if (source?.family === "immomio" && /^https:\/\/tenant\.immomio\.com\/(?:de\/)?apply\/[0-9a-f-]{36}(?:[/?#]|$)/i.test(url)) return "immomio";
  return null;
}
