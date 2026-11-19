// Kleinanzeigen contact forms can vary by advertiser. Translate the existing shared
// applicant_profiles.profile JSON into the fields required by the live form.
// No credentials, provider endpoints or sends belong in this adapter.
const text = (value) => String(value ?? "").trim();
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const labelFor = (uiSchema, key) => {
  const controls = [];
  const scan = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(scan);
    if (node.type === "Control" && typeof node.scope === "string") controls.push(node);
    for (const child of Object.values(node)) if (typeof child === "object") scan(child);
  };
  scan(uiSchema);
  return text(controls.find((item) => item.scope.endsWith("/properties/" + key))?.label) || key;
};
function canonical(key) { return text(key).toLowerCase().replace(/[^a-z0-9äöüß]/g, ""); }
function knownField(key) {
  return /(message|nachricht|anschreiben|bewerbungstext|contacttext|firstname|vorname|givenname|lastname|nachname|surname|familyname|contactname|fullname|displayname|contactperson|email|mailadresse|mailaddress|phone|telefon|mobile|handy|housenumber|hausnummer|streetnumber|street|straße|strasse|postcode|postalcode|zipcode|zip|plz|city|stadt|wohnort|town|household|haushalt|personenzahl|numberofpersons|income|einkommen|nettogehalt|employment|beschäftigung|beschaeftigung|beruf|movein|einzug|schufa|bonität|bonitaet|pets|haustier|wbs|wohnberechtigung|salutation|anrede)/.test(canonical(key));
}
function fieldValue(key, profile, message, property) {
  const k = canonical(key);
  // Consent is specific to each advertiser. A general profile flag cannot grant it.
  if (/(consent|privacy|datenschutz|widerruf|einwilligung|agb|terms)/.test(k)) return undefined;
  const field = (...names) => {
    for (const name of names) if (own(profile, name) && text(profile[name])) return profile[name];
    return undefined;
  };
  if (/(message|nachricht|anschreiben|bewerbungstext|contacttext)/.test(k)) return message;
  if (/(firstname|vorname|givenname)/.test(k)) return field("first_name");
  if (/(lastname|nachname|surname|familyname)/.test(k)) return field("last_name");
  if (/(contactname|fullname|displayname|contactperson)/.test(k))
    return [field("first_name"), field("last_name")].filter(Boolean).join(" ") || undefined;
  if (/(email|mailadresse|mailaddress)/.test(k)) return field("email");
  if (/(phone|telefon|mobile|handy)/.test(k)) return field("phone");
  if (/(housenumber|hausnummer|streetnumber)/.test(k)) return field("house_number");
  if (/(street|straße|strasse)/.test(k)) return field("street");
  if (/(postcode|postalcode|zipcode|zip|plz)/.test(k)) return field("postcode");
  if (/(city|stadt|wohnort|town)/.test(k)) return field("city");
  if (/(household|haushalt|personenzahl|numberofpersons)/.test(k)) {
    if (["number", "integer"].includes(property.type)) return field("household_size");
    return field("household_type");
  }
  if (/(income|einkommen|nettogehalt)/.test(k)) {
    if (["number", "integer"].includes(property.type)) return field("monthly_net_income");
    return field("income_range");
  }
  if (/(employment|beschäftigung|beschaeftigung|beruf)/.test(k)) return field("employment_status");
  if (/(movein|einzug)/.test(k)) return field("move_in_date", "move_in_preference");
  if (/(schufa|bonität|bonitaet)/.test(k)) return field("schufa_status");
  if (/(pets|haustier)/.test(k)) return field("pets");
  if (/(wbs|wohnberechtigung)/.test(k)) return field("wbs_status");
  if (/(salutation|anrede)/.test(k)) return field("salutation");
  // Never fabricate consent, custom answers, identity claims or checkboxes.
  return own(profile, key) ? profile[key] : undefined;
}
function normalizedValue(property, raw) {
  if (raw === undefined || raw === null || text(raw) === "") return undefined;
  const type = text(property.type);
  if (type === "boolean") {
    if (typeof raw === "boolean") return raw;
    if ([1, "1", "true", "yes", "ja"].includes(raw)) return true;
    if ([0, "0", "false", "no", "nein"].includes(raw)) return false;
    return undefined;
  }
  if (type === "integer" || type === "number") {
    if (typeof raw === "number" && Number.isFinite(raw)) return type === "integer" && !Number.isInteger(raw) ? undefined : raw;
    const numeric = Number(raw);
    return Number.isFinite(numeric) && (type !== "integer" || Number.isInteger(numeric)) ? numeric : undefined;
  }
  if (type && type !== "string") return undefined;
  const value = text(raw);
  if (Array.isArray(property.enum)) {
    const possible = property.enum.find((option) => text(option).toLowerCase() === value.toLowerCase());
    if (possible !== undefined) return possible;
    const alias = {
      MR: ["MALE", "HERR"], MS: ["FEMALE", "FRAU"],
      DIVERSE: ["DIVERS"], NEUTRAL: ["NOT_SPECIFIED", "NO_SALUTATION"],
    }[value.toUpperCase()] || [];
    const mapped = property.enum.find((option) => alias.includes(text(option).toUpperCase()));
    if (mapped !== undefined) return mapped;
    return undefined;
  }
  if (property.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  if (Number.isInteger(property.minLength) && value.length < property.minLength) return undefined;
  if (Number.isInteger(property.maxLength) && value.length > property.maxLength) return undefined;
  return value;
}
// Form diagnostics must never persist field values, names, email addresses,
// prefilled account details or bearer tokens. Record only field identifiers
// and JSON Schema type/shape metadata, bounded for D1 event retention.
function safeFieldId(id) {
  const value = String(id ?? "");
  return /^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(value) ? value : null;
}
function safeFieldNames(value, cap = 48) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).slice(0, cap).map(safeFieldId).filter(Boolean);
}
export function describeKleinanzeigenForm(form) {
  const schema = form?.schema, properties = schema?.properties;
  const required = Array.isArray(schema?.required)
    ? [...new Set(schema.required.map(safeFieldId).filter(Boolean))].slice(0, 48) : [];
  const fieldIds = safeFieldNames(properties);
  return {
    envelope_keys: safeFieldNames(form, 20),
    schema_keys: safeFieldNames(schema, 20),
    schema_type: typeof schema?.type === "string" ? schema.type.slice(0, 24) : null,
    required_present: Array.isArray(schema?.required),
    required_ids: required,
    field_ids: fieldIds,
    fields: fieldIds.map(id => {
      const prop = properties[id];
      return {
        id, type: typeof prop?.type === "string" ? prop.type.slice(0, 24) : null,
        required: required.includes(id),
        enum_count: Array.isArray(prop?.enum) ? prop.enum.length : 0,
        one_of_count: Array.isArray(prop?.oneOf) ? prop.oneOf.length : 0,
        any_of_count: Array.isArray(prop?.anyOf) ? prop.anyOf.length : 0,
        has_default: Object.prototype.hasOwnProperty.call(prop || {}, "default"),
      };
    }),
    form_data_keys: safeFieldNames(form?.data, 48),
  };
}

export function prepareKleinanzeigenApplicantForm(form, profile = {}, applicationMessage = "") {
  const schema = form?.schema;
  if (!schema || schema.type !== "object" || !schema.properties || typeof schema.properties !== "object" ||
      !Array.isArray(schema.required) || schema.if || schema.then || schema.allOf || schema.anyOf || schema.oneOf)
    return { ok: false, error: "form_schema_unverified", fields: [], payload: {}, missing: [], unsupported: [] };
  const required = [...new Set(schema.required.map(String))];
  if (required.some((key) => !own(schema.properties, key)))
    return { ok: false, error: "form_schema_unverified", fields: [], payload: {}, missing: [], unsupported: [] };
  const message = text(applicationMessage);
  if (!message) return {
    ok: false, error: "required_profile_data_missing", fields: [], payload: {},
    missing: [{ id: "message", label: "Bewerbungstext" }], unsupported: [],
  };
  const fields = [], missing = [], unsupported = [], payload = {};
  // Optional message/name/contact fields are provided only when explicitly
  // represented by the provider. Mandatory fields are derived from the live schema.
  for (const [key, property] of Object.entries(schema.properties)) {
    const isRequired = required.includes(key);
    // Also overwrite optional identity/contact fields that a provider might prefill from the central account.
    // The actual applicant, never the operator, supplies these values.
    if (!isRequired && !/(message|nachricht|anschreiben|bewerbungstext|firstname|vorname|givenname|lastname|nachname|surname|familyname|contactname|fullname|displayname|contactperson|email|mailadresse|mailaddress|phone|telefon|mobile|handy)/.test(canonical(key))) continue;
    const item = { id: key, label: labelFor(form.uiSchema, key), required: isRequired, type: text(property?.type) };
    if (isRequired) fields.push(item);
    if (!property || typeof property !== "object" || property.readOnly || property.oneOf || property.anyOf || property.allOf) {
      if (isRequired) unsupported.push(item);
      continue;
    }
    const raw = fieldValue(key, profile, message, property);
    if (raw === undefined && isRequired) { (knownField(key) ? missing : unsupported).push(item); continue; }
    if (raw === undefined) continue;
    const value = normalizedValue(property, raw);
    if (value === undefined) {
      if (isRequired) missing.push(item);
      continue;
    }
    payload[key] = value;
  }
  const ok = missing.length === 0 && unsupported.length === 0;
  return { ok, error: ok ? null : unsupported.length ? "required_field_contract_unverified" : "required_profile_data_missing",
    fields, payload: ok ? payload : {}, missing, unsupported };
}
