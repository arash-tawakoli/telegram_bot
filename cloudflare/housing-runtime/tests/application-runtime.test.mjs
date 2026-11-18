import test from "node:test";
import assert from "node:assert/strict";
import { processHousingApplication } from "../src/application-runtime.js";

function sqlFor(row) {
  const writes = [];
  const query = (strings, ...values) => {
    const text = strings.join("?");
    writes.push({ text, values });
    if (/SELECT a\.id/i.test(text)) return Promise.resolve(row ? [row] : []);
    if (/SET status = 'processing'/i.test(text)) return Promise.resolve(row ? [{ id: row.id }] : []);
    if (/SELECT DISTINCT sp\.criteria/i.test(text)) return Promise.resolve([{ criteria: JSON.stringify({ property_types: ["Wohnung"], location_mode: "all_hamburg" }) }]);
    if (/FROM housing\.deliveries/i.test(text)) return Promise.resolve([{ id: "delivery-1" }]);
    if (/SET submission_started_at = now\(\)/i.test(text)) return Promise.resolve(row ? [{ id: row.id }] : []);
    return Promise.resolve([]);
  };
  query.begin = async (callback) => callback(query);
  return { query, writes };
}

test("application processor rejects missing run authorization", async () => {
  const db = sqlFor(null);
  const result = await processHousingApplication(db.query, { APPLICATION_RUN_TOKEN: "secret" }, new Request("https://runtime.test/internal/application/process", { method: "POST" }));
  assert.equal(result.status, 401);
  assert.equal(db.writes.length, 0);
});

test("application processor is idle when no pending application exists", async () => {
  const db = sqlFor(null);
  const result = await processHousingApplication(db.query, { APPLICATION_RUN_TOKEN: "secret" }, new Request("https://runtime.test/internal/application/process", { method: "POST", headers: { authorization: "Bearer secret" } }));
  assert.deepEqual(result.body, { ok: true, status: "idle" });
});

test("application processor fails closed when central provider credentials are absent", async () => {
  const db = sqlFor({
    id: "app-1", participant_id: "user-1", offer_identity_id: "offer-1", provider: "immomio", status: "pending",
    participant_status: "active", auto_apply_enabled: true, plan_override: "premium",
    source_id: 23, first_seen_at: "2026-11-13T08:00:00Z", cutover_enabled_at: "2026-11-13T07:59:00Z",
    expires_at: "2099-01-01T00:00:00.000Z", canonical_url: "https://tenant.immomio.com/de/apply/12345678-1234-4234-8234-123456789012",
    facts: { applicationLink: "https://tenant.immomio.com/de/apply/12345678-1234-4234-8234-123456789012", title: "Wohnung in Hamburg", city: "Hamburg" },
    profile: { first_name: "Anna", last_name: "Beispiel", email: "anna@example.com", phone: "+49123456789", street: "Testweg", house_number: "1", postcode: "20095", city: "Hamburg", salutation: "MS", household_type: "SINGLE", employment_status: "EMPLOYEE", income_range: "NOT_SPECIFIED", pets: "Keine", move_in_preference: "NOT_SPECIFIED", schufa_status: "NOT_SPECIFIED", wbs_status: "NOT_SPECIFIED", message_apartment: "Interesse", message_house: "Interesse", message_temporary_wg: "Interesse", message_swap: "Interesse" },
    preferences_enabled: true, provider_enabled: true, daily_limit: null, timezone: "Europe/Berlin",
    allowed_weekdays: null, send_window_start: null, send_window_end: null, connection_status: "connected",
  });
  const result = await processHousingApplication(db.query, { APPLICATION_RUN_TOKEN: "secret", CENTRAL_AUTO_APPLY_ENABLED: "1" }, new Request("https://runtime.test/internal/application/process", { method: "POST", headers: { authorization: "Bearer secret" } }));
  assert.equal(result.body.status, "manual_required");
  assert.equal(result.body.reason, "central_provider_unavailable");
  assert.equal(db.writes.some(({ text }) => /SET submission_started_at = now\(\)/.test(text)), false);
  assert.ok(db.writes.some(({ text }) => /housing\.application_events/.test(text)));
});

test("central AutoApply stays paused after deployment and does not reserve or send", async () => {
  const db = sqlFor({
    id: "app-paused", participant_id: "user-1", offer_identity_id: "offer-1",
    canonical_url: "https://tenant.immomio.com/apply/12345678-1234-4234-8234-123456789012",
    provider: "immomio", status: "pending", test_mode: 0,
    preferences_enabled: true, provider_enabled: true, auto_apply_enabled: true, plan_override: "premium",
  });
  const result = await processHousingApplication(db.query, { APPLICATION_RUN_TOKEN: "secret" },
    new Request("https://runtime.test/internal/application/process", {
      method: "POST", headers: { authorization: "Bearer secret" },
    }));
  assert.equal(result.body.status, "deferred");
  assert.equal(result.body.reason, "central_auto_apply_paused");
  assert.equal(db.writes.some(({ text }) => /SET submission_started_at = now\\(\\)/.test(text)), false);
  assert.equal(db.writes.some(({ text }) => /wait_reason = 'central_auto_apply_paused'/.test(text)), true);
});

test("free opt-in can reach provider preflight without any Telegram delivery", async () => {
  const db = sqlFor({
    id: "app-free", participant_id: "user-1", offer_identity_id: "offer-1",
    provider: "immowelt", source_id: 3, status: "pending", test_mode: 0,
    canonical_url: "https://www.immowelt.de/expose/123456",
    expires_at: "2099-01-01T00:00:00Z",
    facts: { title: "Wohnung in Hamburg", city: "Hamburg" },
    profile: {
      first_name: "Eva", last_name: "Test", email: "eva@example.com",
      phone: "+491711234567", street: "Testweg", house_number: "1",
      postcode: "20095", city: "Hamburg", salutation: "MS",
      household_type: "SINGLE", employment_status: "EMPLOYEE",
      income_range: "NOT_SPECIFIED", pets: "Keine",
      move_in_preference: "NOT_SPECIFIED", schufa_status: "NOT_SPECIFIED",
    },
    plan_override: "free", participant_status: "active", auto_apply_enabled: true,
    preferences_enabled: true, provider_enabled: true,
  });
  const result = await processHousingApplication(db.query, {
    APPLICATION_RUN_TOKEN: "secret", CENTRAL_AUTO_APPLY_ENABLED: "1",
  }, new Request("https://runtime.test/internal/application/process", {
    method: "POST", headers: { authorization: "Bearer secret" },
  }));
  // Immowelt's unverified transport still blocks actual sending.
  assert.equal(result.body.status, "manual_required");
  assert.equal(result.body.reason, "provider_contract_unverified");
  assert.equal(db.writes.some(({ text }) => /FROM housing\.deliveries/i.test(text)), false);
  assert.equal(db.writes.some(({ text }) => /SET submission_started_at = now\(\)/i.test(text)), false);
});

test("scheduled application processing ignores the historical pending backlog", async () => {
  const db = sqlFor(null);
  await processHousingApplication(db.query, { APPLICATION_RUN_TOKEN: "secret" }, new Request("https://runtime.test/internal/application/process?fresh_only=1", { method: "POST", headers: { authorization: "Bearer secret" } }));
  assert.match(db.writes[2].text, /a\.created_at >= now\(\) - interval '24 hours'/);
  assert.match(db.writes[2].text, /oi\.expires_at > now\(\)/);
  assert.doesNotMatch(db.writes[2].text, /oi\.first_seen_at >= cutover\.enabled_at/,
    "previously discovered active offers must not be blocked by cutover");
});

test("normal applications stay blocked while personal test mode is enabled", async () => {
  const db = sqlFor({ id:"app-test", participant_id:"user-1", offer_identity_id:"offer-1", canonical_url:"https://www.immobilienscout24.de/expose/123456789", provider:"immoscout24", status:"pending", test_mode:0, test_auto_apply_enabled:1 });
  const result = await processHousingApplication(db.query, { APPLICATION_RUN_TOKEN:"secret" }, new Request("https://runtime.test/internal/application/process", { method:"POST", headers:{ authorization:"Bearer secret" } }));
  assert.equal(result.body.status, "manual_required");
  assert.equal(result.body.reason, "test_mode_active");
  assert.equal(db.writes.some(({text}) => /SET submission_started_at = now\(\)/.test(text)), false);
});
