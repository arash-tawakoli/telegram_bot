import test from "node:test";
import assert from "node:assert/strict";
import { importLegacyD1Snapshot, verifyLegacyD1SnapshotKey } from "../src/legacy-migration.js";

const fingerprint = "a".repeat(64);
const credentials = {
  singleton: "central",
  account_hint: "arash@nexalabs.de",
  ciphertext: "ciphertext-preserved-as-is",
  iv: "iv-preserved-as-is",
  key_version: 1,
  status: "connected",
  enabled: 0,
  expires_at: "2026-11-02T16:15:05.115Z",
  last_verified_at: "2026-11-02 12:15:05",
  last_error: null,
  updated_at: "2026-11-02 12:15:05",
};
const flow = {
  state_hash: "b".repeat(64),
  verifier_ciphertext: "oauth-ciphertext",
  verifier_iv: "oauth-iv",
  admin_telegram_id: "8538226539",
  user_id: "00000000-0000-4000-8000-000000000001",
  expires_at: "2026-11-02T12:30:00.000Z",
  consumed_at: null,
  created_at: "2026-11-02 12:15:05",
};
const audit = {
  id: 5,
  event_type: "credential_stored",
  account_hint: "arash@nexalabs.de",
  admin_telegram_id: "8538226539",
  created_at: "2026-11-02 12:15:05",
};

function fakeDatabase({ inserted = true, maxId = 5 } = {}) {
  const calls = [];
  let transactionCount = 0;
  const tx = {
    async unsafe(query, values = []) {
      calls.push({ query, values });
      if (query.startsWith("SELECT COALESCE(MAX(id)")) return [{ max_id: maxId }];
      if (query.startsWith("SELECT setval(")) return [];
      return inserted ? [{ inserted: true }] : [];
    },
  };
  return {
    calls,
    get transactionCount() { return transactionCount; },
    async begin(operation) {
      transactionCount += 1;
      return operation(tx);
    },
  };
}

test("imports encrypted credentials, OAuth flows and audit history without decrypting secrets", async () => {
  const db = fakeDatabase();
  const result = await importLegacyD1Snapshot(db, {
    key_fingerprint: fingerprint,
    credentials,
    oauth_flows: [flow],
    audit_events: [audit],
  }, fingerprint);

  assert.deepEqual(result, { credentials: 1, oauth_flows: 1, audit_events: 1 });
  assert.equal(db.transactionCount, 1);

  const credentialInsert = db.calls.find((call) => call.query.includes("INSERT INTO app_private.immoscout_central_credentials"));
  assert.ok(credentialInsert);
  assert.ok(credentialInsert.query.includes("ON CONFLICT (singleton) DO NOTHING"));
  assert.equal(credentialInsert.values[2], credentials.ciphertext);
  assert.equal(credentialInsert.values[3], credentials.iv);

  const flowInsert = db.calls.find((call) => call.query.includes("INSERT INTO app_private.immoscout_central_oauth_flows"));
  assert.ok(flowInsert);
  assert.equal(flowInsert.values[1], flow.verifier_ciphertext);
  assert.equal(flowInsert.values[2], flow.verifier_iv);

  const auditInsert = db.calls.find((call) => call.query.includes("INSERT INTO app_private.immoscout_central_audit_events"));
  assert.ok(auditInsert);
  assert.equal(auditInsert.values[0], audit.id);
  assert.ok(db.calls.some((call) => call.query.startsWith("SELECT setval(")));
});

test("snapshot import is idempotent and does not overwrite an existing credential", async () => {
  const db = fakeDatabase({ inserted: false });
  const result = await importLegacyD1Snapshot(db, {
    key_fingerprint: fingerprint,
    credentials,
    oauth_flows: [flow],
    audit_events: [audit],
  }, fingerprint);

  assert.deepEqual(result, { credentials: 0, oauth_flows: 0, audit_events: 0 });
  assert.ok(db.calls.every((call) => !/DO UPDATE SET/.test(call.query)));
});

test("rejects an encryption-key mismatch before opening a transaction", async () => {
  const db = fakeDatabase();
  await assert.rejects(
    () => importLegacyD1Snapshot(db, {
      key_fingerprint: "c".repeat(64),
      credentials,
      oauth_flows: [],
      audit_events: [],
    }, fingerprint),
    /legacy_encryption_key_mismatch/,
  );
  assert.equal(db.transactionCount, 0);
});

test("rejects malformed OAuth identities and unsupported credential states before writes", async () => {
  const db = fakeDatabase();
  await assert.rejects(
    () => importLegacyD1Snapshot(db, {
      key_fingerprint: fingerprint,
      credentials,
      oauth_flows: [{ ...flow, user_id: "not-a-uuid" }],
      audit_events: [],
    }, fingerprint),
    /legacy_oauth_user_invalid/,
  );
  await assert.rejects(
    () => importLegacyD1Snapshot(db, {
      key_fingerprint: fingerprint,
      credentials: { ...credentials, status: "disabled" },
      oauth_flows: [],
      audit_events: [],
    }, fingerprint),
    /legacy_credential_status_invalid/,
  );
  assert.equal(db.transactionCount, 0);
});

test("rejects oversized snapshots and malformed audit metadata before writes", async () => {
  const db = fakeDatabase();
  await assert.rejects(
    () => importLegacyD1Snapshot(db, {
      key_fingerprint: fingerprint,
      credentials: null,
      oauth_flows: [],
      audit_events: Array.from({ length: 10001 }, () => audit),
    }, fingerprint),
    /legacy_snapshot_size_invalid/,
  );
  await assert.rejects(
    () => importLegacyD1Snapshot(db, {
      key_fingerprint: fingerprint,
      credentials: null,
      oauth_flows: [],
      audit_events: [{ ...audit, id: -1 }],
    }, fingerprint),
    /legacy_audit_id_invalid/,
  );
  assert.equal(db.transactionCount, 0);
});

test("D1 credential and OAuth ciphertext must decrypt with the PostgreSQL Vault key before import", async () => {
  const keyBytes = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const keyHex = [...keyBytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const encoder = new TextEncoder();
  const seal = async (value, aad) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
      key,
      encoder.encode(JSON.stringify(value)),
    );
    return {
      ciphertext: Buffer.from(ciphertext).toString("base64"),
      iv: Buffer.from(iv).toString("base64"),
    };
  };
  const credentialSeal = await seal(
    { access_token: "access-token-value", refresh_token: "refresh-token-value" },
    "nexalabs:immoscout:central:v1",
  );
  const flowSeal = await seal(
    { verifier: "oauth-pkce-verifier" },
    "nexalabs:immoscout:oauth-flow:v1",
  );
  const snapshot = {
    credentials: { ciphertext: credentialSeal.ciphertext, iv: credentialSeal.iv },
    oauth_flows: [{
      verifier_ciphertext: flowSeal.ciphertext,
      verifier_iv: flowSeal.iv,
    }],
  };

  assert.deepEqual(await verifyLegacyD1SnapshotKey(snapshot, keyHex), {
    credentials_verified: true,
    oauth_flows_verified: 1,
  });
  await assert.rejects(
    () => verifyLegacyD1SnapshotKey(snapshot, "f".repeat(64)),
    /legacy_credentials_key_mismatch/,
  );
});

test("D1 ciphertext verification rejects a credential payload without both OAuth tokens", async () => {
  const keyBytes = new Uint8Array(32).fill(9);
  const keyHex = [...keyBytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode("nexalabs:immoscout:central:v1") },
    key,
    new TextEncoder().encode(JSON.stringify({ access_token: "only-access-token" })),
  );
  const snapshot = {
    credentials: {
      ciphertext: Buffer.from(ciphertext).toString("base64"),
      iv: Buffer.from(iv).toString("base64"),
    },
    oauth_flows: [],
  };
  await assert.rejects(
    () => verifyLegacyD1SnapshotKey(snapshot, keyHex),
    /legacy_credentials_payload_invalid/,
  );
});
