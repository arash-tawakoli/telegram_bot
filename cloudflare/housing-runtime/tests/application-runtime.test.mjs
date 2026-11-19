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
  const result = await processHousingApplication(db.query, { APPLICATION_RUN_TOKEN: "secret", CENTRAL_AUTO_APPLY_ENABLED: "1", AUTO_APPLY_PROVIDERS: "immomio" }, new Request("https://runtime.test/internal/application/process", { method: "POST", headers: { authorization: "Bearer secret" } }));
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
  assert.equal(db.writes.some(({ text, values }) => /wait_reason = /.test(text) && values.includes("central_auto_apply_paused")), true);
});

test("gate off: a free opt-in Immowelt application is deferred, not failed", async () => {
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
  // The provider gate is off: the application waits instead of failing.
  assert.equal(result.body.status, "deferred");
  assert.equal(result.body.reason, "provider_send_disabled");
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

test("test-mode provider failure records a truncated error_detail", async () => {
  const db = sqlFor({
    id: "app-detail", participant_id: "owner-1", offer_identity_id: "offer-1", provider: "immowelt",
    source_id: 3, status: "pending", test_mode: 1, telegram_user_id: 8538226539,
    test_auto_apply_allowed: 1, test_auto_apply_enabled: 1, auto_apply_enabled: 0, preferences_enabled: 0,
    provider_enabled: 1, canonical_url: "https://www.immowelt.de/expose/b9280be8-15b0-4d66-bc46-13a65184a747",
    expires_at: "2099-01-01T00:00:00Z",
    profile: {
      first_name: "Eva", last_name: "Test", email: "eva@example.com", phone: "+491711234567",
      street: "Testweg", house_number: "1", postcode: "20095", city: "Hamburg", salutation: "MS",
      household_type: "SINGLE", employment_status: "EMPLOYEE", income_range: "NOT_SPECIFIED", pets: "Keine",
      move_in_preference: "NOT_SPECIFIED", schufa_status: "NOT_SPECIFIED",
    },
  });
  const result = await processHousingApplication(db.query, { APPLICATION_RUN_TOKEN: "secret", AUTO_APPLY_PROVIDERS: "immowelt" },
    new Request("https://runtime.test/internal/application/process", { method: "POST", headers: { authorization: "Bearer secret" } }));
  assert.equal(result.body.reason, "provider_contract_unverified");
  const event = db.writes.find(({ values }) => values.includes("test_provider_submission"));
  const metadata = JSON.parse(event.values.find((value) => typeof value === "string" && value.startsWith("{")));
  assert.equal(metadata.error_detail, "central_provider_unavailable");
});

const welt = (extra = {}) => ({
  id: "app-welt", participant_id: "user-1", offer_identity_id: "offer-1", provider: "immowelt",
  source_id: 3, status: "pending", test_mode: 0, canonical_url: "https://www.immowelt.de/expose/b9280be8-15b0-4d66-bc46-13a65184a747",
  expires_at: "2099-01-01T00:00:00Z", facts: { title: "Wohnung in Hamburg", city: "Hamburg" },
  profile: {
    first_name: "Eva", last_name: "Test", email: "eva@example.com", phone: "+491711234567",
    street: "Testweg", house_number: "1", postcode: "20095", city: "Hamburg", salutation: "MS",
    household_type: "SINGLE", employment_status: "EMPLOYEE", income_range: "NOT_SPECIFIED", pets: "Keine",
    move_in_preference: "NOT_SPECIFIED", schufa_status: "NOT_SPECIFIED",
  },
  plan_override: "premium", participant_status: "active", auto_apply_enabled: true,
  preferences_enabled: true, provider_enabled: true, ...extra,
});
const post = () => new Request("https://runtime.test/internal/application/process", { method: "POST", headers: { authorization: "Bearer secret" } });

test("test-mode Immowelt send is blocked by the gate before any reservation", async () => {
  const db = sqlFor(welt({ test_mode: 1, telegram_user_id: 8538226539, test_auto_apply_allowed: 1,
    test_auto_apply_enabled: 1, auto_apply_enabled: 0, preferences_enabled: 0 }));
  const result = await processHousingApplication(db.query, { APPLICATION_RUN_TOKEN: "secret" }, post());
  assert.equal(result.body.reason, "provider_transport_unverified");
  assert.equal(db.writes.some(({ text }) => /SET submission_started_at = now\(\)/.test(text)), false);
});

test("gate on: normal Immowelt application sends and stores diagnostics in the event", async () => {
  const { encryptProviderCredentials } = await import("../src/provider-credentials.js");
  const env = { APPLICATION_RUN_TOKEN: "secret", CENTRAL_AUTO_APPLY_ENABLED: "1", AUTO_APPLY_PROVIDERS: "immowelt", APPLICATION_CREDENTIAL_KEY: "ab".repeat(32) };
  const encrypted = await encryptProviderCredentials(env, {
    cookies: [{ name: "oauth.access.token", value: "central-session", domain: ".immowelt.de", expires: 4070908800 }],
    expires_at: "2099-01-01T00:00:00Z",
  }, "owner-id", "immowelt");
  const db = sqlFor(welt());
  const query = (strings, ...values) => /FROM housing\.provider_connections pc/.test(strings.join("?"))
    ? Promise.resolve([{ participant_id: "owner-id", status: "connected", ciphertext: encrypted.ciphertext, iv: encrypted.iv,
      key_version: encrypted.key_version, account_hint: "owner", expires_at: "2099-01-01T00:00:00Z", updated_at: new Date().toISOString() }])
    : db.query(strings, ...values);
  query.begin = db.query.begin;
  const original = globalThis.fetch;
  let soap = "";
  globalThis.fetch = async (_url, init) => { soap = String(init.body); return new Response("<r><SendContactMailResult>true</SendContactMailResult></r>", { status: 200 }); };
  try {
    const result = await processHousingApplication(query, env, post());
    assert.equal(result.body.status, "sent");
    assert.match(soap, /<EMail>eva@example\.com<\/EMail>/);
  } finally { globalThis.fetch = original; }
  const event = db.writes.find(({ values }) => values.includes("provider_submission"));
  const metadata = JSON.parse(event.values.find((value) => typeof value === "string" && value.startsWith("{")));
  assert.equal(metadata.provider_http_status, 200);
  assert.match(metadata.provider_response_excerpt, /SendContactMailResult/);
});
