import test from "node:test";
import assert from "node:assert/strict";
import { fetchImmoweltSource } from "../src/immowelt-source.js";

test("Immowelt source accepts an explicit empty inventory", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html><body>Keine passenden Angebote</body></html>", { status: 200, headers: { "content-type": "text/html" } });
  try {
    const result = await fetchImmoweltSource({ id: 3, search_url: "https://www.immowelt.de/suche/mieten/wohnung/hamburg" });
    assert.equal(result.fetched, 0);
    assert.equal(result.verified_empty, true);
  } finally { globalThis.fetch = original; }
});

test("Immowelt source fails closed on an unrecognized page", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html><body>unexpected</body></html>", { status: 200 });
  try {
    await assert.rejects(() => fetchImmoweltSource({ id: 3, search_url: "https://www.immowelt.de/suche/mieten/wohnung/hamburg" }), /immowelt_inventory_unrecognized/);
  } finally { globalThis.fetch = original; }
});
