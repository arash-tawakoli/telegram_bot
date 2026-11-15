import test from "node:test";
import assert from "node:assert/strict";
import { applicationIdempotencyHash } from "../src/application-dedupe.js";
import { matchesProfile, queueMatches } from "../src/matching.js";

const apartment = { title: "Wohnung in Hamburg", city: "Hamburg", district: "Altona", warm_rent: 900, rooms: 2, area_sqm: 60 };
const hamburg = { property_types: ["Wohnung"], location_mode: "all_hamburg", max_warm_rent: 1200 };

test("matching respects property type, region, neighborhood and required facts", () => {
  assert.equal(matchesProfile(hamburg, apartment, 1), true);
  assert.equal(matchesProfile({ ...hamburg, property_types: ["Haus"] }, apartment, 1), false);
  assert.equal(matchesProfile(hamburg, { ...apartment, city: "Lübeck", title: "Wohnung in Lübeck" }, 69), false);
  assert.equal(matchesProfile({ ...hamburg, location_mode: "boroughs", boroughs: ["Altona"], districts: ["Altona"] }, apartment, 1), true);
  assert.equal(matchesProfile({ ...hamburg, location_mode: "neighborhoods", neighborhoods: ["Langenhorn"] }, apartment, 1), false);
  assert.equal(matchesProfile({ ...hamburg, location_mode: "boroughs", boroughs: "Hamburg-Mitte", districts: "Altona" }, apartment, 1), false);
  assert.equal(matchesProfile({ ...hamburg, require_known_warm_rent: true }, { ...apartment, warm_rent: null }, 1), false);
  assert.equal(matchesProfile({ ...hamburg, max_warm_rent: null }, apartment, 1), true);
  assert.equal(matchesProfile({ ...hamburg, max_deposit: 1000 }, apartment, 1), false);
  assert.equal(matchesProfile({ ...hamburg, wbs_only: true }, apartment, 1), false);
  assert.equal(matchesProfile(hamburg, { ...apartment, title: "Maisonette zur Miete in Hamburg" }, 3), true);
  assert.equal(matchesProfile(hamburg, { ...apartment, title: "Wohnung zum Kauf in Hamburg" }, 3), false);
  assert.equal(matchesProfile(hamburg, { ...apartment, title: "Wohnung zur Miete – Nachmieter gesucht" }, 3), true);
  assert.equal(matchesProfile(hamburg, { ...apartment, title: "Wohnung gesucht in Hamburg" }, 3), false);
  assert.equal(matchesProfile({ ...hamburg, property_types: ["WG"] }, { ...apartment, title: "Wohnung zur Miete, Wohnen auf Zeit" }, 3), true);
  assert.equal(matchesProfile({ ...hamburg, property_types: ["WG"], min_room_area_sqm: 70 }, { ...apartment, title: "WG-Zimmer zur Miete" }, 3), false);
  assert.equal(matchesProfile(hamburg, { ...apartment, title: "Wohnung zur Miete, ohne Tauschwohnung" }, 3), true);
  assert.equal(matchesProfile({ ...hamburg, property_types: ["Haus"] }, { ...apartment, property_type: "Haus", title: "Modernes Haus in Altona" }, 1), true);
  assert.equal(matchesProfile(hamburg, { ...apartment, city: "Hamburg, Altona" }, 1), true);
});

test("Schleswig-Holstein selections require a matching municipality or county", () => {
  const areas = [{ name: "Lübeck", area_type: "independent_city", area_code: "01003", parent_code: "SH" }, { name: "Wedel", area_type: "municipality", area_code: "01056048", parent_code: "01056" }];
  const criteria = { property_types: ["Wohnung"], location_mode: "schleswig_holstein_areas", location_area_codes: ["01056"] };
  assert.equal(matchesProfile(criteria, { ...apartment, city: "Wedel" }, 71, areas), true);
  assert.equal(matchesProfile(criteria, { ...apartment, city: "Lübeck" }, 71, areas), false);
  assert.equal(matchesProfile({ ...criteria, location_mode: "all_schleswig_holstein" }, { ...apartment, city: "Hamburg" }, 69, areas), false);
});

test("unmatched profiles never create a delivery or an application", async () => {
  const calls = [];
  const sql = async (parts) => {
    const query = parts.join("?"); calls.push(query);
    if (query.includes("SELECT DISTINCT sp.participant_id")) return [{ participant_id: "u", criteria: JSON.stringify(hamburg) }];
    return [];
  };
  assert.equal(await queueMatches(sql, "offer", 69, "hash", { ...apartment, city: "Lübeck" }), 0);
  assert.equal(calls.some(query => query.includes("INSERT INTO housing.deliveries") || query.includes("INSERT INTO housing.applications")), false);
});

test("expired premium entitlements cannot receive matches from premium-only profile slots", async () => {
  const calls = [];
  const sql = async (parts) => {
    const query = parts.join("?");
    calls.push(query);
    if (query.includes("SELECT DISTINCT sp.participant_id")) return [{
      participant_id: "u",
      profile_slot: 2,
      criteria: JSON.stringify(hamburg),
      plan_override: null,
      plan_override_expires_at: null,
      referral_bonus_until: "2026-11-01T00:00:00.000Z",
      subscription_status: "canceled",
      subscription_period_end: "2026-11-01T00:00:00.000Z",
    }];
    if (query.includes("SELECT i.first_seen_at")) return [];
    if (query.includes("INSERT INTO housing.deliveries")) return [{ id: "delivery-1" }];
    return [];
  };
  assert.equal(await queueMatches(sql, "offer", 1, "hash", apartment), 0);
  assert.equal(calls.some(query => query.includes("INSERT INTO housing.deliveries")), false);
});

test("shadow sources can be observed but cannot queue deliveries or applications", async () => {
  let queries = 0;
  const sql = async () => { queries++; return []; };
  assert.equal(await queueMatches(sql, "offer", 71, "hash", { ...apartment, canonical_url: "https://www.immowelt.de/expose/123" }), 0);
  assert.equal(queries, 0);
});

test("retained Immomio source identifiers prevent reapplying after application payload expiry", async () => {
  const participantId = "u";
  const immomioId = "12345678-1234-4234-8234-123456789012";
  const legacyHash = await applicationIdempotencyHash(`legacy:immomio:${participantId}:${immomioId}`);
  const calls = [];
  const sql = async (parts, ...values) => {
    const query = parts.join("?"); calls.push({ query, values });
    if (query.includes("SELECT DISTINCT sp.participant_id")) return [{
      participant_id: participantId, criteria: JSON.stringify(hamburg), auto_apply_enabled: 1,
      plan_override: "premium", preferences_enabled: 1, immomio_enabled: 1,
      provider_connection_status: "disconnected",
      applicant_profile: JSON.stringify({ first_name: "A", last_name: "B", email: "a@example.com", phone: "+49123456789", street: "Test", house_number: "1", postcode: "20095", city: "Hamburg", salutation: "MS", household_type: "SINGLE", employment_status: "EMPLOYEE", income_range: "NOT_SPECIFIED", pets: "Keine", move_in_preference: "NOT_SPECIFIED", schufa_status: "NOT_SPECIFIED", wbs_status: "NOT_SPECIFIED", message_apartment: "Interesse", message_house: "Interesse", message_temporary_wg: "Interesse", message_swap: "Interesse" }),
    }];
    if (query.includes("SELECT i.first_seen_at")) return [{ first_seen_at: new Date(Date.now()-5_000).toISOString(), enabled_at: new Date(Date.now()-10_000).toISOString(), expires_at: new Date(Date.now()+86_400_000).toISOString() }];
    if (query.includes("SELECT 1 FROM housing.application_dedupe_keys")) return values[0] === legacyHash ? [{ found: 1 }] : [];
    if (query.includes("INSERT INTO housing.deliveries")) return [{ id: "delivery-1" }];
    return [];
  };
  const facts = { ...apartment, canonical_url: `https://tenant.immomio.com/de/apply/${immomioId}` };
  assert.equal(await queueMatches(sql, "offer", 23, "23:external:object-1", facts), 1);
  assert.equal(calls.some(call => call.query.includes("INSERT INTO housing.deliveries")), true);
  assert.equal(calls.some(call => call.query.includes("INSERT INTO housing.jobs")), false, "delivery idempotency is the only required queue");
  assert.equal(calls.some(call => call.query.includes("INSERT INTO housing.applications")), false);
});
test("incomplete historical ImmoScout application identity blocks auto-apply for that participant", async () => {
  const blockedHash = await applicationIdempotencyHash("legacy:blocked:immoscout24:u");
  const calls = [];
  const sql = async (parts, ...values) => {
    const query = parts.join("?"); calls.push({ query, values });
    if (query.includes("SELECT DISTINCT sp.participant_id")) return [{
      participant_id: "u", criteria: JSON.stringify(hamburg), auto_apply_enabled: 1,
      plan_override: "premium", preferences_enabled: 1, immoscout_enabled: 1,
      provider_connection_status: "connected",
      applicant_profile: JSON.stringify({ first_name: "A", last_name: "B", email: "a@example.com", phone: "+49123456789", street: "Test", house_number: "1", postcode: "20095", city: "Hamburg", salutation: "MS", household_type: "SINGLE", employment_status: "EMPLOYEE", income_range: "NOT_SPECIFIED", pets: "Keine", move_in_preference: "NOT_SPECIFIED", schufa_status: "NOT_SPECIFIED", wbs_status: "NOT_SPECIFIED", message_apartment: "Interesse", message_house: "Interesse", message_temporary_wg: "Interesse", message_swap: "Interesse" }),
    }];
    if (query.includes("SELECT i.first_seen_at")) return [{ first_seen_at: new Date(Date.now()-5_000).toISOString(), enabled_at: new Date(Date.now()-10_000).toISOString(), expires_at: new Date(Date.now()+86_400_000).toISOString() }];
    if (query.includes("SELECT 1 FROM housing.application_dedupe_keys")) return values[0] === blockedHash ? [{ found: 1 }] : [];
    if (query.includes("INSERT INTO housing.deliveries")) return [{ id: "delivery-1" }];
    return [];
  };
  assert.equal(await queueMatches(sql, "offer", 1, "1:external:123456789", { ...apartment, canonical_url: "https://www.immobilienscout24.de/expose/123456789" }), 1);
  assert.equal(calls.some(call => call.query.includes("INSERT INTO housing.deliveries")), true);
  assert.equal(calls.some(call => call.query.includes("INSERT INTO housing.applications")), false);
});
test("incomplete historical ImmoScout identity also blocks personal test AutoApply", async () => {
  const participantId = "u-test";
  const blockedHash = await applicationIdempotencyHash(`legacy:blocked:immoscout24:${participantId}`);
  const calls = [];
  const sql = async (parts, ...values) => {
    const query = parts.join("?"); calls.push({ query, values });
    if (query.includes("SELECT DISTINCT sp.participant_id")) return [{
      participant_id: participantId, criteria: JSON.stringify(hamburg), auto_apply_enabled: 0,
      test_auto_apply_allowed: 1, test_auto_apply_enabled: 1, test_auto_apply_daily_limit: 1,
      telegram_user_id: 8538226539, plan_override: "free", preferences_enabled: 0,
      immoscout_enabled: 1, provider_connection_status: "connected",
      applicant_profile: JSON.stringify({ first_name: "A", last_name: "B", email: "a@example.com", phone: "+49123456789", street: "Test", house_number: "1", postcode: "20095", city: "Hamburg", salutation: "MS", household_type: "SINGLE", employment_status: "EMPLOYEE", income_range: "NOT_SPECIFIED", pets: "Keine", move_in_preference: "NOT_SPECIFIED", schufa_status: "NOT_SPECIFIED", wbs_status: "NOT_SPECIFIED", message_apartment: "Interesse" }),
    }];
    if (query.includes("SELECT i.first_seen_at")) return [{ first_seen_at: new Date(Date.now()-5_000).toISOString(), enabled_at: new Date(Date.now()-10_000).toISOString(), expires_at: new Date(Date.now()+86_400_000).toISOString() }];
    if (query.includes("SELECT 1 FROM housing.application_dedupe_keys")) return values[0] === blockedHash ? [{ found: 1 }] : [];
    if (query.includes("INSERT INTO housing.deliveries")) return [{ id: "delivery-1" }];
    return [];
  };
  assert.equal(await queueMatches(sql, "offer", 1, "1:external:123456789", { ...apartment, canonical_url: "https://www.immobilienscout24.de/expose/123456789" }), 1);
  assert.equal(calls.some(call => call.query.includes("INSERT INTO housing.deliveries")), true);
  assert.equal(calls.some(call => call.query.includes("INSERT INTO housing.applications")), false);
});
test("new fresh matches queue AutoApply for complete premium profiles without personal connections", async () => {
  let testMode = false;
  const calls = [];
  const sql = async (parts, ...values) => {
    const query = parts.join("?"); calls.push({ query, values });
    if (query.includes("SELECT DISTINCT sp.participant_id")) return [{
      participant_id: "u", criteria: JSON.stringify(hamburg), auto_apply_enabled: 1,
      test_auto_apply_allowed: 1, test_auto_apply_enabled: testMode ? 1 : 0,
      plan_override: "premium", preferences_enabled: 1, immomio_enabled: 1,
      provider_connection_status: "connected",
      applicant_profile: JSON.stringify({ first_name: "A", last_name: "B", email: "a@example.com", phone: "+49123456789", street: "Test", house_number: "1", postcode: "20095", city: "Hamburg", salutation: "MS", household_type: "SINGLE", employment_status: "EMPLOYEE", income_range: "NOT_SPECIFIED", pets: "Keine", move_in_preference: "NOT_SPECIFIED", schufa_status: "NOT_SPECIFIED", wbs_status: "NOT_SPECIFIED", message_apartment: "Interesse", message_house: "Interesse", message_temporary_wg: "Interesse", message_swap: "Interesse" }),
    }];
    if (query.includes("SELECT i.first_seen_at")) return [{ first_seen_at: new Date(Date.now()-5_000).toISOString(), enabled_at: new Date(Date.now()-10_000).toISOString(), expires_at: new Date(Date.now()+86_400_000).toISOString() }];
    if (query.includes("INSERT INTO housing.deliveries")) return [{ id: "delivery-1" }];
    if (query.includes("INSERT INTO housing.applications")) return [{ id: "application-1" }];
    return [];
  };
  assert.equal(await queueMatches(sql, "offer", 23, "23:external:abc", { ...apartment, canonical_url: "https://tenant.immomio.com/de/apply/12345678-1234-4234-8234-123456789012" }), 1);
  assert.equal(calls.some(call => call.query.includes("INSERT INTO housing.applications")), true);
  assert.equal(calls.some(call => call.query.includes("INSERT INTO housing.application_dedupe_keys")), true);

  const beforeBlocked = calls.length;
  assert.equal(await queueMatches(sql, "offer-disabled", 23, "23:external:disabled", { ...apartment, canonical_url: "https://tenant.immomio.com/de/apply/12345678-1234-4234-8234-123456789012" }, false), 1);
  assert.equal(calls.slice(beforeBlocked).some(call => call.query.includes("INSERT INTO housing.applications")), false,
    "central rollout disabled must not enqueue applications");

  testMode = true;
  const beforeTestMode = calls.length;
  assert.equal(await queueMatches(sql, "offer-test", 23, "hash-test", { ...apartment, canonical_url: "https://tenant.immomio.com/de/apply/12345678-1234-4234-8234-123456789012" }), 1);
  assert.equal(calls.slice(beforeTestMode).some(call => call.query.includes("INSERT INTO housing.applications")), false);
});


test("Hamburg and Schleswig-Holstein require verified warm rent for Scout budget matching", () => {
  const shAreas=[{ name:"Kiel", area_type:"independent_city", area_code:"01002", parent_code:"SH" }];
  const scenarios=[
    {sourceId:1,criteria:hamburg,facts:{...apartment,city:"Hamburg"}},
    {sourceId:69,criteria:{...hamburg,location_mode:"all_schleswig_holstein"},
      facts:{...apartment,title:"Wohnung in Kiel",city:"Kiel"}},
  ];
  for(const {sourceId,criteria,facts} of scenarios){
    assert.equal(matchesProfile(criteria,{...facts,warm_rent:null,cold_rent:750},sourceId,shAreas),false,
      "basic rent must not be misread as meeting a warm-rent cap");
    assert.equal(matchesProfile(criteria,{...facts,warm_rent:1250,cold_rent:750},sourceId,shAreas),false);
    assert.equal(matchesProfile(criteria,{...facts,warm_rent:1000,cold_rent:750},sourceId,shAreas),true);
  }
  assert.equal(matchesProfile(hamburg,{...apartment,warm_rent:null,cold_rent:750},3),true,
    "other existing connectors retain their previous explicit unknown-rent policy");
});


test("provider city labels match the canonical municipality in both states", () => {
  assert.equal(matchesProfile(hamburg, {...apartment,city:"Harburg, Hamburg"},1),true);
  const areas=[
    {name:"Lübeck",area_type:"independent_city",area_code:"01003",parent_code:"SH"},
    {name:"Barsbüttel",area_type:"municipality",area_code:"01062006",parent_code:"01062"},
  ];
  const sh={property_types:["Wohnung"],location_mode:"schleswig_holstein_areas",location_area_codes:["01003"]};
  assert.equal(matchesProfile(sh,{...apartment,city:"Lübeck / Travemünde",title:"Wohnung in Lübeck"},69,areas),true);
  assert.equal(matchesProfile(sh,{...apartment,city:"Barsbüttel/OT Stellau"},69,areas),false);
});
