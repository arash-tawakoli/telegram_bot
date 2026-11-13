import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function fakeD1() {
  const statements = [];
  return {
    statements,
    prepare(query) {
      return {
        all: async () => {
          statements.push(query);
          if (query.includes("name IN ('source_registry'")) return { results: [{ count: 22 }], meta: { changes: 0 } };
          if (query.includes("central_credentials")) return { results: [{ credentials: 1, oauth_flows: 1, audit_events: 1 }], meta: { changes: 0 } };
          if (query.includes("SELECT 1 AS imported FROM participants LIMIT 1")) return { results: [{ imported: 1 }], meta: { changes: 0 } };
          throw new Error("unexpected_readiness_query");
        },
      };
    },
  };
}

test("public readiness reports schema status without exposing live row counts", async () => {
  const db = fakeD1();
  const response = await worker.fetch(new Request("https://internal.example/edge/ready"), { HOUSING_DB: db });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.database, "reachable");
  assert.equal(body.centralVault, "available");
  assert.deepEqual(body.centralTables, { credentials: true, oauth_flows: true, audit_events: true });
  assert.deepEqual(body.housingTarget, { tables: 22, rls: "worker_authorization", dataImported: true });
  assert.equal(Object.hasOwn(body, "counts"), false);
  assert.equal(db.statements.length, 3);
  assert.equal(db.statements.some((query) => /count\(\*\)\s+FROM\s+(participants|search_profiles|applicant_profiles|provider_connections|offer_identities|deliveries|applications)/i.test(query)), false);
});
