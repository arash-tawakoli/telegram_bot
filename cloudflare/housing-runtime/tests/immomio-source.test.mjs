import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { validateImmomioPage, fetchImmomioSource, ingestImmomioSource } from "../src/immomio-source.js";

test("Immomio pagination accepts an exact final page", () => {
  const list = validateImmomioPage({ data: { propertyList: { page: { page: 0, size: 2, totalElements: 2, totalPages: 1 }, nodes: [{ objectId: "a" }, { objectId: "b" }] } } }, 0);
  assert.equal(list.nodes.length, 2);
});

test("Immomio pagination rejects truncated pages", () => {
  assert.throws(() => validateImmomioPage({ data: { propertyList: { page: { page: 0, size: 2, totalElements: 3, totalPages: 2 }, nodes: [{ objectId: "a" }] } } }, 0), /immomio_truncated_page/);
});

test("public iframe tenant is checked and shadow crawling never queues messages", async () => {
  const originalFetch = globalThis.fetch;
  const token = `header.${Buffer.from(JSON.stringify({ customerId: "tenant-a" })).toString("base64url")}.signature`;
  const tenant_hash = createHash("sha256").update("tenant-a").digest("hex");
  const url = "https://provider.example/offers";
  let graphqlCalls = 0;
  globalThis.fetch = async input => {
    if (String(input) === url) {
      const response = new Response(`<iframe src=https://homepage.immomio.com/de/properties?token=${token}></iframe>`);
      Object.defineProperty(response, "url", { value: url });
      return response;
    }
    graphqlCalls++;
    return Response.json({ data: { propertyList: { page: { page: 0, size: 250, totalElements: 1, totalPages: 1 }, nodes: [{ objectId: "offer", applicationLink: "https://tenant.immomio.com/apply/00000000-0000-0000-0000-000000000001", propertyType: "FLAT", marketingType: "RENT" }] } } });
  };
  try {
    const config = { url, tenant_hash, queue_matches: false };
    const calls = [];
    const sql = async (strings, ...values) => { calls.push(strings.join("?")); return [{ id: "offer-id" }]; };
    const result = await ingestImmomioSource(sql, { id: 32 }, config);
    assert.equal(result.valid, 1);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /INSERT INTO housing.offer_identities/);
    await assert.rejects(() => fetchImmomioSource({ id: 32 }, { ...config, tenant_hash: "0".repeat(64) }), /immomio_tenant_mismatch/);
    assert.equal(graphqlCalls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("the four staged source configurations cannot queue deliveries", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync(new URL("../schema/d1/0001_housing_core.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../schema/d1/0010_immomio_shadow_sources.sql", import.meta.url), "utf8"));
    const rows = db.prepare("SELECT id,connector_config FROM source_registry ORDER BY id").all();
    assert.deepEqual(rows.map(row => row.id), [30, 32, 36, 39]);
    for (const row of rows) {
      const config = JSON.parse(row.connector_config);
      assert.equal(config.queue_matches, false);
      assert.match(config.tenant_hash, /^[a-f0-9]{64}$/);
    }
  } finally { db.close(); }
});
