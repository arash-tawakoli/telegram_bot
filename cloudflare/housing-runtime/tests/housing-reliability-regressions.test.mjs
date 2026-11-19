import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { runCentralScoutSessionRefresh } from "../src/platform-session-cron.js";
import { sendImmomioApplication } from "../src/immomio-application.js";
import { sendImmoweltApplication } from "../src/immowelt-application.js";

globalThis.crypto ||= webcrypto;

const KEY = "0123456789abcdef".repeat(4);
const future = () => new Date(Date.now() + 60 * 60_000).toISOString();

async function encryptedScoutCredentials() {
  const bytes = Uint8Array.from(KEY.match(/../g), x => Number.parseInt(x, 16));
  const key = await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const raw = JSON.stringify({
    access_token: "expired-scout-access", refresh_token: "expired-scout-refresh",
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  });
  const enc = await crypto.subtle.encrypt({
    name: "AES-GCM", iv,
    additionalData: new TextEncoder().encode("nexalabs:immoscout:central:v1"),
  }, key, new TextEncoder().encode(raw));
  const b64 = data => Buffer.from(data).toString("base64");
  return {
    account_hint: "arash@nexalabs.de",
    ciphertext: b64(new Uint8Array(enc)), iv: b64(iv), status: "connected",
    enabled: 0, expires_at: new Date(Date.now() - 60_000).toISOString(),
  };
}

test("fresh central Scout token does not trigger an unnecessary network refresh", async () => {
  let queries = 0;
  const env = { HOUSING_DB: { prepare() { queries++; return {
    first: async () => ({ status: "connected", enabled: 0, expires_at: future() }),
  }; } } };
  assert.deepEqual(await runCentralScoutSessionRefresh(env), { checked: 0, refreshed: 0 });
  assert.equal(queries, 1);
});

test("401 refresh marks Scout central credential as needs_login without leaking tokens", async () => {
  const row = await encryptedScoutCredentials();
  const mutations = [];
  const database = { prepare(sql) {
    return {
      async first() { return row; },
      bind(...params) {
        return { async run() { mutations.push({ sql, params }); return { meta: { changes: 1 } }; } };
      },
    };
  } };
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => { requests.push(String(url)); return Response.json({ error: "invalid_grant" }, { status: 401 }); };
  try {
    const outcome = await runCentralScoutSessionRefresh({
      HOUSING_DB: database, CENTRAL_TOKEN_ENCRYPTION_KEY: KEY,
    });
    assert.deepEqual(outcome, { checked: 1, refreshed: 0, reason: "needs_login" });
    assert.equal(requests.length, 1);
    assert.match(requests[0], /\/v1\/token$/);
    assert.equal(mutations.length, 1);
    assert.match(mutations[0].sql, /status='needs_login'/);
    assert.deepEqual(mutations[0].params, ["needs_login"]);
    assert.doesNotMatch(JSON.stringify(outcome), /expired-scout/);
  } finally { globalThis.fetch = original; }
});

test("Immomio keeps the test send unreserved until identity and listing checks pass", async () => {
  const original = globalThis.fetch;
  let authorizationCalls = 0;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    const query = payload.query;
    requests.push(query);
    let data;
    if (query.includes("query currentUser")) data = { user: { id: "owner", email: "owner@example.com" } };
    else if (query.includes("query propertyBySourceIdentifier")) data = {
      propertyBySourceIdentifier: { id: "property1", smsVerificationRequired: false, captchaSettings: {} },
    };
    else if (query.includes("query checkApplicationExist")) data = { checkApplicationExist: null };
    else if (query.includes("query applicationQuestions")) data = { customQuestionsByProperty: { customQuestions: [] } };
    else throw new Error("mutation should not be sent");
    return Response.json({ data });
  };
  try {
    const result = await sendImmomioApplication({
      participant_id: "owner-id",
      test_mode: true,
      authorizeTestSend: async () => { authorizationCalls++; return false; },
      profile: { email: "owner@example.com" },
      facts: { applicationLink: "https://tenant.immomio.com/apply/12345678-1234-4234-8234-123456789012" },
    }, {}, null, {
      ownerId: "owner-id",
      credentials: { access_token: "non-expired-central", expires_at: future() },
    });
    assert.deepEqual(result, { status: "manual_required", error: "test_send_not_authorized" });
    assert.equal(authorizationCalls, 1);
    assert.equal(requests.length, 4);
    assert.ok(!requests.some(query => query.includes("mutation createApplication")));
  } finally { globalThis.fetch = original; }
});

test("unverified Immowelt send never reserves the one-shot test submission", async () => {
  const original = globalThis.fetch;
  let reserved = 0;
  globalThis.fetch = async () => { throw new Error("unverified send must never reach the network"); };
  try {
    const result = await sendImmoweltApplication({
      test_mode: true,
      authorizeTestSend: async () => { reserved++; return true; },
      canonical_url: "https://www.immowelt.de/expose/64f4e6cd-26d3-4bb6-9481-a0a87694bf38",
      profile: { first_name: "Anna", last_name: "Beispiel", email: "anna@example.com" },
    }, {}, null, { ownerId: "owner-id", credentials: {
      cookies: [{ domain: ".immowelt.de", name: "session", value: "opaque", expires: -1 }],
    } });
    assert.deepEqual(result, { status: "manual_required", error: "provider_transport_unverified" });
    assert.equal(reserved, 0);
  } finally { globalThis.fetch = original; }
});

test("verified Immowelt sender does not transmit when atomic test authorization fails", async () => {
  const original = globalThis.fetch;
  let reserved = 0;
  globalThis.fetch = async () => { throw new Error("send must never reach the network"); };
  try {
    const result = await sendImmoweltApplication({
      test_mode: true,
      authorizeTestSend: async () => { reserved++; return false; },
      canonical_url: "https://www.immowelt.de/expose/64f4e6cd-26d3-4bb6-9481-a0a87694bf38",
      profile: { first_name: "Anna", last_name: "Beispiel", email: "anna@example.com" },
    }, { AUTO_APPLY_PROVIDERS: "immowelt" }, null, { ownerId: "owner-id", credentials: {
      cookies: [{ domain: ".immowelt.de", name: "session", value: "opaque", expires: -1 }],
    } });
    assert.deepEqual(result, { status: "manual_required", error: "test_send_not_authorized" });
    assert.equal(reserved, 1);
  } finally { globalThis.fetch = original; }
});

test("scheduler keeps fresh deliveries and closes only expired ordinary pending messages", () => {
  const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(source, /runCentralScoutSessionRefresh\(env/);
  assert.match(source, /minute % 10 === 0/);
  assert.match(source, /for \(let index = 0; index < 15; index\+\+\)/);
  assert.match(source, /error_message IS NULL\s+AND created_at < now\(\) - interval '15 minutes'/);
  assert.match(source, /SET status='skipped',error_message='delivery_window_expired'/);
});


test("Immomio accepts the homepage connector's canonical_url without a duplicate fact link", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const query = JSON.parse(options.body).query;
    requests.push(query);
    if (query.includes("currentUser")) return Response.json({ data: { user: { id: "owner", email: "owner@example.com" } } });
    if (query.includes("propertyBySourceIdentifier")) return Response.json({ data: {
      propertyBySourceIdentifier: { id: "p1", smsVerificationRequired: false, captchaSettings: {} },
    } });
    if (query.includes("checkApplicationExist")) return Response.json({ data: { checkApplicationExist: null } });
    if (query.includes("applicationQuestions")) return Response.json({ data: { customQuestionsByProperty: { customQuestions: [] } } });
    throw new Error("no mutation permitted");
  };
  try {
    const result = await sendImmomioApplication({
      participant_id: "owner",
      test_mode: true,
      authorizeTestSend: async () => false,
      profile: { email: "owner@example.com" },
      facts: { property_type: "Wohnung" },
      canonical_url: "https://tenant.immomio.com/de/apply/12345678-1234-4234-8234-123456789012",
    }, {}, null, { ownerId: "owner", credentials: { access_token: "valid", expires_at: future() } });
    assert.deepEqual(result, { status: "manual_required", error: "test_send_not_authorized" });
    assert.equal(requests.length, 4);
  } finally { globalThis.fetch = original; }
});
