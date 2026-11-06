import test from "node:test";
import assert from "node:assert/strict";
import { processHousingApplication } from "../src/application-runtime.js";

function sqlFor(row) {
  const writes = [];
  const query = (strings, ...values) => {
    const text = strings.join("?");
    writes.push({ text, values });
    if (/SELECT a\.id/i.test(text)) return Promise.resolve(row ? [row] : []);
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

test("application processor fails closed while a provider transport is pending", async () => {
  const db = sqlFor({
    id: "app-1", participant_id: "user-1", offer_identity_id: "offer-1", provider: "immowelt",
    canonical_url: "https://www.immowelt.de/expose/example", preferences_enabled: true,
    provider_enabled: true, connection_status: "connected",
  });
  const result = await processHousingApplication(db.query, { APPLICATION_RUN_TOKEN: "secret" }, new Request("https://runtime.test/internal/application/process", { method: "POST", headers: { authorization: "Bearer secret" } }));
  assert.equal(result.body.status, "manual_required");
  assert.equal(result.body.reason, "provider_transport_pending");
  assert.ok(db.writes.some(({ text }) => /housing\.application_events/.test(text)));
});
