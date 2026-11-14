import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { webcrypto } from "node:crypto";
import worker from "../src/index.js";

globalThis.crypto ||= webcrypto;

function emptyD1() {
  const statements = [];
  return {
    statements,
    prepare(query) {
      return {
        bind() { return this; },
        async all() {
          statements.push(query);
          return { results: [], meta: { changes: 0 } };
        },
      };
    },
  };
}

function deliveryD1(participantStatus = "active") {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE deliveries (id TEXT PRIMARY KEY,participant_id TEXT,offer_identity_id TEXT,status TEXT,attempts INTEGER DEFAULT 0,error_message TEXT,telegram_message_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,sent_at TEXT);
    CREATE TABLE participants (id TEXT PRIMARY KEY,status TEXT,telegram_chat_id INTEGER);
    CREATE TABLE offer_identities (id TEXT PRIMARY KEY,facts TEXT,canonical_url TEXT);
    INSERT INTO participants VALUES ('p1',${JSON.stringify(participantStatus)},123);
    INSERT INTO offer_identities VALUES ('o1','{"title":"Wohnung","city":"Hamburg"}','https://www.immobilienscout24.de/expose/123456789');
    INSERT INTO deliveries(id,participant_id,offer_identity_id,status,created_at) VALUES ('d1','p1','o1','pending',CURRENT_TIMESTAMP);
  `);
  return {
    sqlite,
    prepare(query) {
      const prepared = sqlite.prepare(query);
      return {
        bind(...params) { return { all: async () => {
          if (prepared.columns().length) return { results: prepared.all(...params), meta: { changes: 0 } };
          const result = prepared.run(...params);
          return { results: [], meta: { changes: Number(result.changes) } };
        } }; },
        all: async () => {
          if (prepared.columns().length) return { results: prepared.all(), meta: { changes: 0 } };
          const result = prepared.run();
          return { results: [], meta: { changes: Number(result.changes) } };
        },
      };
    },
  };
}

test("delivery processing leaves pending rows untouched when Telegram credentials are missing", async () => {
  const db = emptyD1();
  const response = await worker.fetch(new Request("https://runtime.test/internal/delivery/process", {
    method: "POST",
    headers: { authorization: "Bearer delivery-secret" },
  }), { HOUSING_DB: db, DELIVERY_RUN_TOKEN: "delivery-secret" });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "telegram_token_missing" });
  assert.equal(db.statements.length, 0);
});

test("blocked participants do not receive queued delivery messages", async () => {
  const db = deliveryD1("archived");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("must not send"); };
  try {
    const response = await worker.fetch(new Request("https://runtime.test/internal/delivery/process", {
      method: "POST",
      headers: { authorization: "Bearer delivery-secret" },
    }), { HOUSING_DB: db, DELIVERY_RUN_TOKEN: "delivery-secret", TELEGRAM_BOT_TOKEN: "telegram-secret" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "idle");
    assert.equal(db.sqlite.prepare("SELECT status FROM deliveries WHERE id='d1'").get().status, "pending");
  } finally {
    globalThis.fetch = originalFetch;
    db.sqlite.close();
  }
});

test("a Telegram send with an unknown outcome is marked failed rather than left processing", async () => {
  const db = deliveryD1("active");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("network failure"); };
  try {
    const response = await worker.fetch(new Request("https://runtime.test/internal/delivery/process", {
      method: "POST",
      headers: { authorization: "Bearer delivery-secret" },
    }), { HOUSING_DB: db, DELIVERY_RUN_TOKEN: "delivery-secret", TELEGRAM_BOT_TOKEN: "telegram-secret" });
    assert.equal(response.status, 503);
    const delivery = db.sqlite.prepare("SELECT status,error_message FROM deliveries WHERE id='d1'").get();
    assert.equal(delivery.status, "failed");
    assert.equal(delivery.error_message, "telegram_outcome_unknown");
  } finally {
    globalThis.fetch = originalFetch;
    db.sqlite.close();
  }
});

test("malformed access cookies fail as unauthorized instead of a server error", async () => {
  const response = await worker.fetch(new Request("https://runtime.test/edge/documents/open?participant_id=00000000-0000-4000-8000-000000000001&document_id=00000000-0000-4000-8000-000000000002", {
    headers: { cookie: "__Host-tw_cp_access=%" },
  }), { HOUSING_DB: emptyD1(), DOCUMENTS: { get: async () => null } });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
});
