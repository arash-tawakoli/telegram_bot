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

test("Berlin matching respects city, districts and Ortsteile and excludes other regions", () => {
  const berlin = { property_types: ["Wohnung"], location_mode: "all_berlin" };
  const apartment = { title: "Wohnung am Kollwitzplatz", city: "Berlin",
    district: "Prenzlauer Berg", property_type: "Wohnung" };
  assert.equal(matchesProfile(berlin, apartment, 72), true);
  assert.equal(matchesProfile(berlin, { ...apartment, city: "Hamburg" }, 1), false);
  assert.equal(matchesProfile(berlin, { ...apartment, city: "Potsdam" }, 72), false);
  const pankow = { ...berlin, location_mode: "berlin_boroughs", berlin_boroughs: ["Pankow"] };
  const mitte = { ...berlin, location_mode: "berlin_boroughs", berlin_boroughs: ["Mitte"] };
  assert.equal(matchesProfile(pankow, apartment, 72), true,
    "Prenzlauer Berg belongs to district Pankow");
  assert.equal(matchesProfile(mitte, apartment, 72), false);
  assert.equal(matchesProfile({ ...berlin, location_mode: "berlin_localities",
    berlin_localities: ["Prenzlauer Berg"] }, apartment, 72), true);
  assert.equal(matchesProfile({ ...berlin, location_mode: "berlin_localities",
    berlin_localities: ["Kreuzberg"] }, apartment, 72), false);
  assert.equal(matchesProfile(pankow, { ...apartment, city: "Berlin", district: "Kreuzberg" }, 72), false);
});

test("Free users receive listing alerts but cannot queue normal AutoApply", async () => {
  const calls = [];
  const profile = {
    first_name: "Eva", last_name: "Test", email: "eva@example.com",
    phone: "+491711234567", street: "Testweg", house_number: "1",
    postcode: "20095", city: "Hamburg", salutation: "MS",
    household_type: "SINGLE", employment_status: "EMPLOYEE",
    income_range: "NOT_SPECIFIED", pets: "Keine",
    move_in_preference: "NOT_SPECIFIED", schufa_status: "NOT_SPECIFIED",
  };
  const sql = async (parts, ...values) => {
    const query = parts.join("?");
    calls.push({ query, values });
    if (query.includes("SELECT DISTINCT sp.participant_id")) return [{
      participant_id: "free-test-user", profile_slot: 1, criteria: JSON.stringify(hamburg),
      applicant_profile: JSON.stringify(profile), auto_apply_enabled: 1,
      preferences_enabled: 1, immoscout_enabled: 1,
      test_auto_apply_enabled: 0, plan_override: "free", subscription_status: null,
    }];
    if (query.includes("SELECT i.first_seen_at")) return [{
      first_seen_at: new Date(Date.now()-50_000).toISOString(),
      expires_at: new Date(Date.now()+3_600_000).toISOString(),
      enabled_at: new Date(Date.now()-90_000).toISOString(),
    }];
    if (query.includes("INSERT INTO housing.deliveries")) return [{id:"delivery"}];
    if (query.includes("INSERT INTO housing.applications")) return [{id:"application"}];
    return [];
  };
  await queueMatches(sql,"offer",1,"1:external:free-test",{
    ...apartment,canonical_url:"https://www.immobilienscout24.de/expose/172800001",
  },true);
  assert.equal(calls.filter(x=>x.query.includes("INSERT INTO housing.applications")).length,0);
  assert.equal(calls.filter(x=>x.query.includes("INSERT INTO housing.deliveries")).length,1);
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
test("a historical provider-wide marker does not block a currently consented personal Scout application", async () => {
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
  assert.equal(calls.some(call => call.query.includes("INSERT INTO housing.applications")), true);
  assert.equal(calls.some(call => call.values[0] === blockedHash), false,
    "unrelated provider-wide migration markers must not block a matched offer");
});
test("Scout test sender accepts still-active earlier discoveries and respects per-offer deduplication", async () => {
  const participantId = "test-owner";
  const identityHash = "1:external:post-activation-001";
  const oldBlock = await applicationIdempotencyHash(`legacy:blocked:immoscout24:${participantId}`);
  const testHash = await applicationIdempotencyHash(`test:${participantId}:${identityHash}`);
  const profile = {
    first_name: "A", last_name: "B", email: "a@example.com", phone: "+49123456789",
    street: "Testweg", house_number: "1", postcode: "20095", city: "Hamburg",
    salutation: "MS", household_type: "SINGLE", employment_status: "EMPLOYEE",
    income_range: "NOT_SPECIFIED", pets: "Keine", move_in_preference: "NOT_SPECIFIED",
    schufa_status: "NOT_SPECIFIED",
  };
  async function scenario(firstSeenOffset, retainedSpecificKey = false) {
    const calls = [], now = Date.now();
    const sql = async (parts, ...values) => {
      const query = parts.join("?"); calls.push({ query, values });
      if (query.includes("SELECT DISTINCT sp.participant_id")) return [{
        participant_id: participantId, criteria: JSON.stringify(hamburg), profile_slot: 1,
        auto_apply_enabled: 0, test_auto_apply_allowed: 1, test_auto_apply_enabled: 1,
        test_auto_apply_enabled_at: new Date(now - 6_000).toISOString(),
        test_auto_apply_daily_limit: 1, telegram_user_id: 8538226539,
        preferences_enabled: 0, immoscout_enabled: 1, applicant_profile: JSON.stringify(profile),
      }];
      if (query.includes("SELECT i.first_seen_at")) return [{
        first_seen_at: new Date(now + firstSeenOffset).toISOString(),
        enabled_at: new Date(now - 30_000).toISOString(),
        expires_at: new Date(now + 86_400_000).toISOString(),
      }];
      if (query.includes("SELECT 1 FROM housing.application_dedupe_keys"))
        return values[0] === oldBlock || (retainedSpecificKey && values[0] === testHash)
          ? [{ found: 1 }] : [];
      if (query.includes("INSERT INTO housing.deliveries")) return [{ id: "delivery-new" }];
      if (query.includes("INSERT INTO housing.applications")) return [{ id: "app-new" }];
      return [];
    };
    const queued = await queueMatches(sql, "offer-new", 1, identityHash,
      { ...apartment, canonical_url: "https://www.immobilienscout24.de/expose/123456789" });
    return { calls, queued };
  }
  const fresh = await scenario(-1_000);
  assert.equal(fresh.queued, 1);
  assert.equal(fresh.calls.some(c => c.query.includes("INSERT INTO housing.applications")), true,
    "fresh consented canary listing queues despite an unrelated historic provider-wide block");
  assert.equal(fresh.calls.some(c => c.values[0] === oldBlock), false,
    "do not drop or query the historical provider-wide blocked marker for the canary");
  assert.equal(fresh.calls.some(c => c.query.includes("INSERT INTO housing.application_dedupe_keys")), true);
  const old = await scenario(-20_000);
  assert.equal(old.queued, 1, "delivery queue remains unaffected");
  assert.equal(old.calls.some(c => c.query.includes("INSERT INTO housing.applications")), true,
    "still-active listings may be applied for even if the first discovery predates Start");
  const duplicate = await scenario(-1_000, true);
  assert.equal(duplicate.calls.some(c => c.query.includes("INSERT INTO housing.applications")), false,
    "the specific test application key always prevents repeated submissions");
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


test("an incomplete applicant profile cannot queue a Scout test application", async () => {
  const calls = [];
  const sql = async (parts, ...values) => {
    const query = parts.join("?");
    calls.push(query);
    if (query.includes("SELECT DISTINCT sp.participant_id")) return [{
      participant_id: "u", criteria: JSON.stringify(hamburg),
      telegram_user_id: 8538226539, test_auto_apply_allowed: 1, test_auto_apply_enabled: 1,
      test_auto_apply_enabled_at: new Date(Date.now() - 20_000).toISOString(),
      auto_apply_enabled: 0, preferences_enabled: 0, immoscout_enabled: 1,
      applicant_profile: "{}", profile_slot: 1,
    }];
    if (query.includes("SELECT i.first_seen_at")) return [{
      first_seen_at: new Date(Date.now() - 5_000).toISOString(),
      enabled_at: new Date(Date.now() - 60_000).toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }];
    if (query.includes("INSERT INTO housing.deliveries")) return [{ id: "del" }];
    return [];
  };
  const facts = {
    ...apartment, canonical_url: "https://www.immobilienscout24.de/expose/123456",
    warm_rent: null, cold_rent: 750,
  };
  assert.equal(await queueMatches(sql, "offer", 1, "1:external:123456", facts), 1);
  assert.ok(calls.some(x => x.includes("INSERT INTO housing.deliveries")));
  assert.ok(!calls.some(x => x.includes("INSERT INTO housing.applications")));
});


test("Scout AutoApply follows search profile + complete applicant + Start across prices and age labels", async () => {
  const complete = {
    first_name: "Eva", last_name: "Test", email: "eva@example.com",
    phone: "+49123456789", street: "Teststraße", house_number: "7", postcode: "20095",
    city: "Hamburg", salutation: "MS", household_type: "SINGLE",
    employment_status: "EMPLOYEE", income_range: "1000_1500",
    pets: "NO", move_in_preference: "FLEXIBLE", schufa_status: "NOT_SPECIFIED",
  };
  async function caseFor({ warm = 900, cold = 750, title = "Wohnung Hamburg",
    senderOn = 1, applicant = complete, maxRent = 1200, expired = false } = {}) {
    const calls = [], now = Date.now();
    const sql = async (parts, ...values) => {
      const query = parts.join("?");
      calls.push({ query, values });
      if (query.includes("SELECT DISTINCT sp.participant_id")) return [{
        participant_id: "test-owner", profile_slot: 1,
        criteria: JSON.stringify({ ...hamburg, max_warm_rent: maxRent }),
        test_auto_apply_allowed: 1, test_auto_apply_enabled: senderOn,
        test_auto_apply_enabled_at: new Date(now - 10_000).toISOString(),
        auto_apply_enabled: 0, telegram_user_id: 8538226539,
        immoscout_enabled: 1, preferences_enabled: 0,
        applicant_profile: JSON.stringify(applicant),
      }];
      if (query.includes("SELECT i.first_seen_at")) return [{
        first_seen_at: new Date(now - 86_400_000).toISOString(),
        enabled_at: new Date(now - 120_000).toISOString(),
        expires_at: new Date(now + (expired ? -30_000 : 3_600_000)).toISOString(),
      }];
      if (query.includes("INSERT INTO housing.deliveries")) return [{ id: "delivery" }];
      if (query.includes("INSERT INTO housing.applications")) return [{ id: "app" }];
      return [];
    };
    await queueMatches(sql, "offer", 1, "1:external:" + title,
      { title, city: "Hamburg", property_type: "Wohnung",
        warm_rent: warm, cold_rent: cold, rooms: 3,
        canonical_url: "https://www.immobilienscout24.de/expose/12345678" });
    return calls.some(c => c.query.includes("INSERT INTO housing.applications"));
  }
  assert.equal(await caseFor({}), true, "normal matching rent is eligible");
  assert.equal(await caseFor({ title: "Mindestalter: 55 Jahre - Service Wohnung" }), true,
    "no new automatic age filter is imposed");
  assert.equal(await caseFor({ warm: null, title: "Wohnung ohne Warmmiete" }), true,
    "unknown warm rent follows search profile policy, not an extra AutoApply blocker");
  assert.equal(await caseFor({ warm: 1300 }), false,
    "the user's configured rent maximum is authoritative");
  assert.equal(await caseFor({ senderOn: 0 }), false, "Pause prevents queueing");
  assert.equal(await caseFor({ applicant: {} }), false, "the applicant profile must be complete");
  assert.equal(await caseFor({ expired: true }), false, "expired offers cannot be sent");
});

test("Scout sends unknown-priced apartment alerts without treating cold rent as verified warm rent", () => {
  const shAreas=[{ name:"Kiel", area_type:"independent_city", area_code:"01002", parent_code:"SH" }];
  const scenarios=[
    {sourceId:1,criteria:hamburg,facts:{...apartment,city:"Hamburg"}},
    {sourceId:69,criteria:{...hamburg,location_mode:"all_schleswig_holstein"},
      facts:{...apartment,title:"Wohnung in Kiel",city:"Kiel"}},
  ];
  for(const {sourceId,criteria,facts} of scenarios){
    assert.equal(matchesProfile(criteria,{...facts,warm_rent:null,cold_rent:750},sourceId,shAreas),true,
      "a search profile permitting unknown warm rents can match without inventing a price");
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
