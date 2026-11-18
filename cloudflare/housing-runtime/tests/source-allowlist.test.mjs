import test from "node:test";
import assert from "node:assert/strict";
import {
  HOUSING_SOURCES,
  applicationIdempotencyKey,
  deliveryIdempotencyKey,
  offerIdentity,
  sourceForId,
} from "../src/source-allowlist.js";

test("allowlist contains only the verified housing source families", () => {
  assert.equal(HOUSING_SOURCES.length, 9);
  assert.equal(sourceForId(72)?.name, "ImmobilienScout24 Berlin");
  assert.deepEqual(
    [...new Set(HOUSING_SOURCES.map((source) => source.family))].sort(),
    ["immomio", "immoscout24", "immowelt", "kleinanzeigen"],
  );
  assert.equal(sourceForId(2)?.name, "Kleinanzeigen Hamburg");
  for (const id of [30, 32, 34, 36, 39, 71]) assert.equal(sourceForId(id), null);
  assert.deepEqual(HOUSING_SOURCES.filter(s => s.family === 'immomio').map(s => s.id), [23, 29, 35, 66]);
});

test("URL identity ignores tracking parameters and preserves source scope", async () => {
  const first = await offerIdentity({
    sourceId: 23,
    canonicalUrl: "https://tenant.example/offer/7?utm_source=feed&b=2&a=1#details",
  });
  const second = await offerIdentity({
    sourceId: 23,
    canonicalUrl: "https://tenant.example/offer/7?a=1&b=2",
  });
  const otherSource = await offerIdentity({
    sourceId: 29,
    canonicalUrl: "https://tenant.example/offer/7?a=1&b=2",
  });

  assert.equal(first.hash, second.hash);
  assert.notEqual(first.hash, otherSource.hash);
});

test("external IDs take precedence over mutable URLs", async () => {
  const first = await offerIdentity({ sourceId: 1, externalId: "abc", canonicalUrl: "https://example/a" });
  const second = await offerIdentity({ sourceId: 1, externalId: "abc", canonicalUrl: "https://example/b" });
  assert.equal(first.hash, second.hash);
});

test("delivery and application keys make duplicate work unique", () => {
  assert.equal(deliveryIdempotencyKey("user-1", "hash-1"), "user-1:hash-1");
  assert.equal(applicationIdempotencyKey("user-1", "ImmoWelt", "hash-1"), "user-1:immowelt:hash-1");
  assert.throws(() => applicationIdempotencyKey("user-1", "kleinanzeigen", "hash-1"), /provider_not_allowlisted/);
});
