import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { queueMatches } from "../src/matching.js";
import { processHousingApplication } from "../src/application-runtime.js";

globalThis.crypto ||= webcrypto;

const encoder = new TextEncoder();
const base64 = (bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

async function centralCredentialRow({ enabled = 0 } = {}) {
  const keyBytes = Uint8Array.from("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".match(/../g), (v) => parseInt(v, 16));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const credentials = {
    access_token: "central-access-token-for-test",
    refresh_token: "central-refresh-token-for-test",
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  };
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode("nexalabs:immoscout:central:v1") },
    key,
    encoder.encode(JSON.stringify(credentials)),
  );
  return {
    account_hint: "arash@nexalabs.de",
    ciphertext: base64(new Uint8Array(ciphertext)),
    iv: base64(iv),
    status: "connected",
    enabled,
    expires_at: credentials.expires_at,
  };
}

function applicationRow(overrides = {}) {
  return {
    id: "app-test-1",
    participant_id: "owner-1",
    offer_identity_id: "offer-1",
    provider: "immoscout24",
    test_mode: 1,
    submission_started_at: null,
    sent_at: null,
    source_id: 1,
    external_id: "123456789",
    canonical_url: "https://www.immobilienscout24.de/expose/123456789",
    profile: {
      first_name: "Arash", last_name: "Tawakoli", email: "arash@nexalabs.de",
      phone: "+491700000000", street: "Kreuzweg", house_number: "7",
      postcode: "20099", city: "Hamburg", message_apartment: "Anfrage zur Immobilie",
    },
    facts: {},
    test_auto_apply_allowed: 1,
    test_auto_apply_enabled: 1,
    test_auto_apply_daily_limit: 1,
    auto_apply_enabled: 0,
    preferences_enabled: 0,
    provider_enabled: 0,
    connection_status: null,
    ...overrides,
  };
}

function sqlFor(row, { reserve = true } = {}) {
  const writes = [];
  const query = async (strings, ...values) => {
    const text = strings.join("?");
    writes.push({ text, values });
    if (/SELECT a\.id/i.test(text)) return row ? [row] : [];
    if (/UPDATE housing\.applications SET status = 'processing'/i.test(text)) return row ? [{ id: row.id }] : [];
    if (/SET submission_started_at = now\(\)/i.test(text)) return reserve ? [{ id: row?.id || "app-test-1" }] : [];
    return [];
  };
  query.begin = async (callback) => callback(query);
  return { query, writes };
}

function fakeCentralDb(row) {
  return {
    prepare() {
      return {
        first: async () => row,
      };
    },
  };
}

test("matching queues a separate ImmoScout test application only for an opted-in allowlisted owner", async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (/SELECT DISTINCT sp\.participant_id/i.test(text)) {
      return [{
        participant_id: "owner-1",
        criteria: JSON.stringify({ max_warm_rent: 1800 }),
        test_auto_apply_allowed: 1,
        test_auto_apply_enabled: 1,
        test_auto_apply_daily_limit: 1,
        auto_apply_enabled: 0,
      }];
    }
    if (/INSERT INTO housing\.deliveries/i.test(text)) return [{ id: "delivery-test-1" }];
    if (/INSERT INTO housing\.applications/i.test(text)) return [{ id: "app-test-1" }];
    return [];
  };
  const queued = await queueMatches(sql, "offer-1", 1, "1:external:123", { warm_rent: 900, rooms: 2, area_sqm: 65 });
  assert.equal(queued, 1);
  const insert = calls.find((call) => /INSERT INTO housing\.applications/i.test(call.text));
  assert.ok(insert);
  assert.match(insert.text, /test_mode/);
  assert.match(insert.text, /test_auto_apply_enabled = true/);
  assert.match(insert.text, /submission_started_at/);
});

test("matching never queues the personal ImmoScout test path for another provider or an opted-out user", async () => {
  for (const sourceId of [3, 1]) {
    const calls = [];
    const sql = async (strings, ...values) => {
      const text = strings.join("?");
      calls.push({ text, values });
      if (/SELECT DISTINCT sp\.participant_id/i.test(text)) {
        return [{
          participant_id: "other-user",
          criteria: "{}",
          test_auto_apply_allowed: sourceId === 1 ? 0 : 1,
          test_auto_apply_enabled: 1,
          test_auto_apply_daily_limit: 1,
          auto_apply_enabled: 0,
        }];
      }
      return [];
    };
    await queueMatches(sql, "offer-1", sourceId, "hash", {});
    assert.equal(calls.some((call) => /INSERT INTO housing\.applications/i.test(call.text)), false);
  }
});

test("test application sends through the central credential without requiring a participant plugin", async () => {
  const central = await centralCredentialRow();
  const db = sqlFor(applicationRow());
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), method: init.method || "GET", body: init.body });
      if (String(url).includes("/contact")) return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ "expose.expose": { contactFormConfiguration: {} } }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    };
    const result = await processHousingApplication(db.query, {
      APPLICATION_RUN_TOKEN: "run-secret",
      CENTRAL_TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      HOUSING_DB: fakeCentralDb(central),
    }, new Request("https://runtime.test/internal/application/process", {
      method: "POST", headers: { authorization: "Bearer run-secret" },
    }));
    assert.equal(result.body.status, "sent");
    assert.equal(result.body.test_mode, true);
    assert.equal(requests.length, 2);
    assert.match(requests[0].url, /\/expose\/123456789$/);
    assert.match(requests[1].url, /\/expose\/123456789\/contact$/);
    assert.ok(db.writes.some(({ text }) => /submission_started_at = now\(\)/i.test(text)));
    assert.equal(db.writes.some(({ text }) => /provider_connections/i.test(text)), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("test application does not send when the daily quota reservation fails", async () => {
  const central = await centralCredentialRow();
  const db = sqlFor(applicationRow(), { reserve: false });
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url) => {
      requests.push(String(url));
      return new Response(JSON.stringify({ "expose.expose": { contactFormConfiguration: {} } }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    };
    const result = await processHousingApplication(db.query, {
      APPLICATION_RUN_TOKEN: "run-secret",
      CENTRAL_TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      HOUSING_DB: fakeCentralDb(central),
    }, new Request("https://runtime.test/internal/application/process", {
      method: "POST", headers: { authorization: "Bearer run-secret" },
    }));
    assert.equal(result.body.status, "manual_required");
    assert.equal(result.body.reason, "test_daily_limit_reached");
    assert.equal(requests.length, 1);
    assert.equal(requests.some((url) => url.includes("/contact")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("test application fails closed when the central credential is globally enabled", async () => {
  const central = await centralCredentialRow({ enabled: 1 });
  const db = sqlFor(applicationRow());
  const originalFetch = globalThis.fetch;
  let called = false;
  try {
    globalThis.fetch = async () => { called = true; throw new Error("unexpected_fetch"); };
    const result = await processHousingApplication(db.query, {
      APPLICATION_RUN_TOKEN: "run-secret",
      CENTRAL_TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      HOUSING_DB: fakeCentralDb(central),
    }, new Request("https://runtime.test/internal/application/process", {
      method: "POST", headers: { authorization: "Bearer run-secret" },
    }));
    assert.equal(result.body.status, "manual_required");
    assert.equal(result.body.reason, "test_mode_central_account_unavailable");
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
