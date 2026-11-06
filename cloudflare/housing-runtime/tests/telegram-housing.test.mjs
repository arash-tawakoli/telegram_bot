import test from "node:test";
import assert from "node:assert/strict";
import { offerText, parseSearchText } from "../src/telegram-housing.js";

test("Telegram search input keeps only allow-listed sources and bounded numeric criteria", () => {
  const result = parseSearchText("stadt=Hamburg;max_miete=1.200;zimmer=2;quellen=1,3,999");
  assert.deepEqual(result.criteria, { city: "Hamburg", max_rent: 1200, rooms: 2 });
  assert.deepEqual(result.sourceIds, [1, 3]);
});

test("Telegram search input defaults to all verified sources", () => {
  const result = parseSearchText("stadt=Hamburg");
  assert.equal(result.sourceIds.length, 10);
  assert.equal(result.criteria.city, "Hamburg");
});

test("Telegram offer rendering escapes user supplied facts", () => {
  const html = offerText({
    facts: { title: "<Wohnung>", city: "Hamburg", warm_rent: 1200, rooms: 2 },
    canonical_url: "https://example.test/offer",
    source_name: "ImmoWelt",
  });
  assert.match(html, /&lt;Wohnung&gt;/);
  assert.match(html, /1\.200/);
  assert.doesNotMatch(html, /<Wohnung>/);
});
