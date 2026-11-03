import { test } from "node:test";
import assert from "node:assert/strict";
import { importLegacyD1Snapshot } from "../cloudflare/housing-runtime/src/legacy-migration.js";

const fingerprint = "f".repeat(64);
const userId = "11111111-1111-4111-8111-111111111111";

function snapshot() {
  return {
    key_fingerprint: fingerprint,
    credentials: {
      singleton: "central",
      account_hint: "arash@nexalabs.de",
      ciphertext: "encrypted-token-payload",
      iv: "encrypted-iv",
      key_version: 1,
      status: "connected",
      enabled: 0,
      expires_at: "2026-11-02T16:15:05.115Z",
      last_verified_at: "2026-11-02 16:00:00",
      last_error: null,
      updated_at: "2026-11-02 16:15:05",
    },
    oauth_flows: Array.from({ length: 12 }, (_, index) => ({
      state_hash: index.toString(16).padStart(64, "a"),
      verifier_ciphertext: "encrypted-verifier-" + index,
      verifier_iv: "verifier-iv-" + index,
      admin_telegram_id: "8538226539",
      user_id: userId,
      expires_at: "2026-11-01T14:15:05.000Z",
      consumed_at: index < 5 ? "2026-11-01 14:10:00" : null,
      created_at: "2026-11-01 14:08:38",
    })),
    audit_events: Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      event_type: "central_token_" + index,
      account_hint: "arash@nexalabs.de",
      admin_telegram_id: "8538226539",
      created_at: "2026-11-01 14:08:38",
    })),
  };
}

function fakeSql({ conflictCredentials = false, conflictFlows = false, conflictAudit = false } = {}) {
  const calls = [];
  let transactions = 0;
  const tx = {
    async unsafe(query, params = []) {
      calls.push({ query, params });
      if (query.includes("INSERT INTO app_private.immoscout_central_credentials")) {
        return conflictCredentials ? [] : [{ singleton: "central" }];
      }
      if (query.includes("INSERT INTO app_private.immoscout_central_oauth_flows")) {
        return conflictFlows ? [] : [{ state_hash: params[0] }];
      }
      if (query.includes("INSERT INTO app_private.immoscout_central_audit_events")) {
        return conflictAudit ? [] : [{ id: params[0] }];
      }
      if (query.includes("MAX(id)")) return [{ max_id: 5 }];
      return [];
    },
  };
  return {
    calls,
    get transactions() { return transactions; },
    sql: {
      async begin(callback) {
        transactions += 1;
        return callback(tx);
      },
    },
  };
}

test("imports the encrypted credential, all OAuth flows and audit history atomically", async () => {
  const fake = fakeSql();
  const imported = await importLegacyD1Snapshot(fake.sql, snapshot(), fingerprint);
  assert.deepEqual(imported, { credentials: 1, oauth_flows: 12, audit_events: 5 });
  assert.equal(fake.transactions, 1);
  assert.equal(fake.calls.filter((call) => call.query.includes("INSERT INTO app_private.immoscout_central_oauth_flows")).length, 12);
  assert.equal(fake.calls.filter((call) => call.query.includes("INSERT INTO app_private.immoscout_central_audit_events")).length, 5);
  assert.ok(fake.calls.some((call) => call.query.includes("setval(pg_get_serial_sequence")));
  const credentialCall = fake.calls.find((call) => call.query.includes("INSERT INTO app_private.immoscout_central_credentials"));
  assert.equal(credentialCall.params[6], 0, "the disabled central account must remain disabled");
  const flowCall = fake.calls.find((call) => call.query.includes("INSERT INTO app_private.immoscout_central_oauth_flows"));
  assert.equal(flowCall.params[7], "2026-11-01T14:08:38.000Z");
  const auditCall = fake.calls.find((call) => call.query.includes("INSERT INTO app_private.immoscout_central_audit_events"));
  assert.equal(auditCall.params[4], "2026-11-01T14:08:38.000Z");
});

test("is idempotent when target rows already exist", async () => {
  const fake = fakeSql({ conflictCredentials: true, conflictFlows: true, conflictAudit: true });
  const imported = await importLegacyD1Snapshot(fake.sql, snapshot(), fingerprint);
  assert.deepEqual(imported, { credentials: 0, oauth_flows: 0, audit_events: 0 });
  assert.equal(fake.transactions, 1);
});

test("rejects a different encryption key before opening a transaction", async () => {
  const fake = fakeSql();
  await assert.rejects(
    () => importLegacyD1Snapshot(fake.sql, snapshot(), "0".repeat(64)),
    /legacy_encryption_key_mismatch/,
  );
  assert.equal(fake.transactions, 0);
  assert.equal(fake.calls.length, 0);
});

test("rejects malformed OAuth identities before writing", async () => {
  const fake = fakeSql();
  const legacy = snapshot();
  legacy.oauth_flows[0].user_id = "not-a-uuid";
  await assert.rejects(
    () => importLegacyD1Snapshot(fake.sql, legacy, fingerprint),
    /legacy_oauth_user_invalid/,
  );
  assert.equal(fake.transactions, 0);
});
