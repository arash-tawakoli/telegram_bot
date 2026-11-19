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
  return /(message|nachricht|anschreiben|bewerbungstext|contacttext|firstname|vorname|givenname|lastname|nachname|surname|familyname|contactname|fullname|displayname|contactperson|email|mailadresse|mailaddress|phone|telefon|mobile|handy|housenumber|hausnummer|streetnumber|street|straße|strasse|postcode|postalcode|zipcode|zip|plz|city|stadt|wohnort|town|household|haushalt|personenzahl|numberofpersons|phonecall|callback|rückruf|ruckruf|income|einkommen|nettogehalt|employment|beschäftigung|beschaeftigung|beruf|movein|einzug|schufa|bonität|bonitaet|pets|haustier|wbs|wohnberechtigung|salutation|anrede)/.test(canonical(key));
}
function fieldValue(key, profile, message, property) {
  const k = canonical(key);
  // Consent is specific to each advertiser. A general profile flag cannot grant it.
  if (/(consent|privacy|datenschutz|widerruf|einwilligung|agb|terms)/.test(k)) return undefined;
  const field = (...names) => {
    for (const name of names) if (own(profile, name) && text(profile[name])) return profile[name];
    return undefined;
  };
  if (/(phonecalldesired|callbackdesired|rückrufgewünscht|ruckrufgewunscht)/.test(k))
    return own(profile, "phone_call_desired") && typeof profile.phone_call_desired === "boolean"
      ? profile.phone_call_desired : false;
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
  if (/(schufa|bonität|bonitaet)/.test(k)) {
    const status = String(field("schufa_status") || "NOT_SPECIFIED");
    if (["AVAILABLE", "PRESENT_RECENT"].includes(status)) return "Vorhanden (< 3 Monate)";
    if (status === "NOT_AVAILABLE") return "Nicht vorhanden";
    if (status === "NOT_SPECIFIED") return "Keine Angabe";
    return undefined;
  }
  if (/(pets|haustier)/.test(k)) return field("pets");
  if (/(wbs|wohnberechtigung)/.test(k)) return field("wbs_status");
  if (/(salutation|anrede)/.test(k)) return field("salutation");
  // Never fabricate consent, custom answers, identity claims or checkboxes.
  return own(profile, key) ? profile[key] : undefined;
}
function fold(value) {
  return text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function enumAlternatives(property) {
  const values = Array.isArray(property.enum) ? property.enum : [];
  const alternatives = [...(Array.isArray(property.oneOf) ? property.oneOf : []),
    ...(Array.isArray(property.anyOf) ? property.anyOf : [])];
  const labels = property.enumNames || property["x-enumNames"] || [];
  const options = values.map((value, i) => {
    const matched = alternatives.find(option => String(option?.const ?? option?.value) === String(value));
    return { value, labels: [labels[i],matched?.title,matched?.label,matched?.description].filter(x=>x!=null) };
  });
  if (options.length) return options;
  return alternatives.map(x=>({
    value:x?.const??x?.value??x?.enum?.[0],labels:[x?.title,x?.label,x?.description].filter(y=>y!=null)
  })).filter(x=>x.value!==undefined);
}
function enumCandidates(key, value) {
  const k=canonical(key),raw=text(value);
  if (/salutation|anrede/.test(k)) {
    const aliases={MR:["Herr","MALE","MR","männlich"], MS:["Frau","FEMALE","MS","weiblich"],
      DIVERSE:["Divers","DIVERSE"],NEUTRAL:["Keine Angabe","NOT_SPECIFIED","NO_SALUTATION"]};
    return [...new Set([raw,...(aliases[raw.toUpperCase()]||[])])];
  }
  if (/schufa|bonit/.test(k)) {
    const aliases={
      "vorhanden 3 monate":["Vorhanden (< 3 Monate)","PRESENT_RECENT","AVAILABLE","SCHUFA_AVAILABLE"],
      "nicht vorhanden":["Nicht vorhanden","NOT_AVAILABLE","NO_SCHUFA"],
      "keine angabe":["Keine Angabe","NOT_SPECIFIED","NO_ANSWER"]
    };
    return [...new Set([raw,...(aliases[fold(raw)]||[])])];
  }
  if (/income|einkommen/.test(k)) {
    const codes={UNDER_500:"LESS_THAN_500_EUR","500_1000":"EUR_500_TO_1000",
      "1000_1500":"EUR_1000_TO_1500","1500_2000":"EUR_1500_TO_2000",
      "2000_3000":"EUR_2000_TO_3000","3000_4000":"EUR_3000_TO_4000",
      "4000_5000":"EUR_4000_TO_5000",OVER_5000:"MORE_THAN_5000_EUR"};
    return [raw,codes[raw.toUpperCase()]].filter(Boolean);
  }
  return [raw];
}
function normalizedValue(property, raw, key = "") {
  if (raw === undefined || raw === null || text(raw) === "") return undefined;
  const type = text(property.type);
  if (type === "boolean") {
    if (typeof raw === "boolean") return raw;
    if ([1, "1", "true", "yes", "ja"].includes(raw)) return true;
    if ([0, "0", "false", "no", "nein"].includes(raw)) return false;
    return undefined;
  }
  if (type === "integer" || type === "number") {
    if (typeof raw === "number" && Number.isFinite(raw))
      return type === "integer" && !Number.isInteger(raw) ? undefined : raw;
    const numeric = Number(raw);
    return Number.isFinite(numeric) && (type !== "integer" || Number.isInteger(numeric)) ? numeric : undefined;
  }
  if (type && type !== "string") return undefined;
  const value = text(raw);
  if (Array.isArray(property.enum) || Array.isArray(property.oneOf) || Array.isArray(property.anyOf)) {
    const alternatives=enumAlternatives(property);
    const candidates=enumCandidates(key,value);
    for (const candidate of candidates) {
      const match=alternatives.find(option =>
        [option.value,...option.labels].some(label=>fold(label)===fold(candidate)));
      if (match) return match.value;
    }
    return undefined;
  }
  if (property.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  if (Number.isInteger(property.minLength) && value.length < property.minLength) return undefined;
  if (Number.isInteger(property.maxLength) && value.length > property.maxLength) return undefined;
  return value;
}
// Support standard bounded JSON Schema "allOf/if/then/else" conditional
// requirements. Unknown conditions block sending instead of being ignored.
function conditionalMatch(condition, properties, profile, message) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)
      || Object.keys(condition).some(k=>!["properties","required","type"].includes(k)))
    return null;
  if (condition.type && condition.type!=="object") return null;
  const props=condition.properties||{};
  if (typeof props!=="object" || Array.isArray(props)) return null;
  const required=Array.isArray(condition.required) ? condition.required : [];
  if (required.some(k=>typeof k!=="string")) return null;
  for (const key of required) {
    const value=fieldValue(key,profile,message,properties[key]||{});
    if (value === undefined || value === null || text(value)==="") return false;
  }
  for (const [key,rule] of Object.entries(props)) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)
        || Object.keys(rule).some(k=>!["const","enum","type"].includes(k))) return null;
    const raw=fieldValue(key,profile,message,properties[key]||{});
    if (raw===undefined) return false;
    const value=normalizedValue(properties[key]||{},raw,key);
    if (value===undefined) return null;
    if (Object.prototype.hasOwnProperty.call(rule,"const") && value!==rule.const) return false;
    if (Array.isArray(rule.enum) && !rule.enum.includes(value)) return false;
    if (rule.type && typeof value!==rule.type) return false;
  }
  return true;
}
function resolveKleinanzeigenSchema(schema,profile,message) {
  if (schema.if || schema.then || schema.else || schema.anyOf || schema.oneOf || schema.not) return null;
  const properties={...schema.properties};
  const required=new Set(schema.required.map(String));
  const rules=schema.allOf||[];
  if (!Array.isArray(rules) || rules.length>12) return null;
  for (const rule of rules) {
    if (!rule || typeof rule!=="object" || Array.isArray(rule)) return null;
    let clause=rule;
    if (rule.if) {
      if (Object.keys(rule).some(k=>!["if","then","else"].includes(k))) return null;
      const matched=conditionalMatch(rule.if,properties,profile,message);
      if(matched===null)return null;
      clause=matched?rule.then:rule.else;
      if(!clause)continue;
    }
    if (Object.keys(clause).some(k=>!["type","properties","required"].includes(k))
        || clause.type && clause.type!=="object") return null;
    if (clause.required && !Array.isArray(clause.required))return null;
    if (clause.required) for (const key of clause.required) {
      if(typeof key!=="string")return null;
      required.add(key);
    }
    if (clause.properties) {
      if (typeof clause.properties!=="object" || Array.isArray(clause.properties))return null;
      for (const [key,restrictions] of Object.entries(clause.properties)) {
        if(!properties[key]||!restrictions||typeof restrictions!=="object")return null;
        properties[key]={...properties[key],...restrictions};
      }
    }
  }
  return {properties,required:[...required]};
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
      Array.isArray(schema.properties) || !Array.isArray(schema.required))
    return { ok: false, error: "form_schema_unverified", fields: [], payload: {}, missing: [], unsupported: [] };
  const resolved=resolveKleinanzeigenSchema(schema,profile,applicationMessage);
  if (!resolved) return { ok: false, error: "form_schema_unverified", fields: [], payload: {}, missing: [], unsupported: [] };
  const required = resolved.required;
  if (required.some((key) => !own(resolved.properties, key)))
    return { ok: false, error: "form_schema_unverified", fields: [], payload: {}, missing: [], unsupported: [] };
  const message = text(applicationMessage);
  if (!message) return {
    ok: false, error: "required_profile_data_missing", fields: [], payload: {},
    missing: [{ id: "message", label: "Bewerbungstext" }], unsupported: [],
  };
  const fields = [], missing = [], unsupported = [], payload = {};
  // Optional message/name/contact fields are provided only when explicitly
  // represented by the provider. Mandatory fields are derived from the live schema.
  for (const [key, property] of Object.entries(resolved.properties)) {
    const isRequired = required.includes(key);
    // Also overwrite optional identity/contact fields that a provider might prefill from the central account.
    // The actual applicant, never the operator, supplies these values.
    if (!isRequired && !/(message|nachricht|anschreiben|bewerbungstext|firstname|vorname|givenname|lastname|nachname|surname|familyname|contactname|fullname|displayname|contactperson|email|mailadresse|mailaddress|phone|telefon|mobile|handy)/.test(canonical(key))) continue;
    const item = { id: key, label: labelFor(form.uiSchema, key), required: isRequired, type: text(property?.type) };
    if (isRequired) fields.push(item);
    if (!property || typeof property !== "object" || property.readOnly || property.allOf) {
      if (isRequired) unsupported.push(item);
      continue;
    }
    const raw = fieldValue(key, profile, message, property);
    if (raw === undefined && isRequired) { (knownField(key) ? missing : unsupported).push(item); continue; }
    if (raw === undefined) continue;
    const value = normalizedValue(property, raw, key);
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
