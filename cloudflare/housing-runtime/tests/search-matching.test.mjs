import test from "node:test";
import assert from "node:assert/strict";
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

test("shadow sources can be observed but cannot queue deliveries or applications", async () => {
  let queries = 0;
  const sql = async () => { queries++; return []; };
  assert.equal(await queueMatches(sql, "offer", 71, "hash", { ...apartment, canonical_url: "https://www.immowelt.de/expose/123" }), 0);
  assert.equal(queries, 0);
});

test("new fresh matches queue AutoApply only for complete premium connected profiles", async () => {
  const calls = [];
  const sql = async (parts, ...values) => {
    const query = parts.join("?"); calls.push({ query, values });
    if (query.includes("SELECT DISTINCT sp.participant_id")) return [{
      participant_id: "u", criteria: JSON.stringify(hamburg), auto_apply_enabled: 1,
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
});
