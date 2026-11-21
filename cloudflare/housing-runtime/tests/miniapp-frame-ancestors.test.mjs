import test from "node:test";
import assert from "node:assert/strict";
import { miniAppPage } from "../src/miniapp-ui.js";
import { listingMiniAppResponse } from "../src/listing-miniapp.js";

test("Mini App pages allow only Telegram Web as an external frame ancestor", async () => {
  const sql = async () => [{
    source_id: 1, source_name: "ImmoScout24",
    canonical_url: "https://www.immobilienscout24.de/expose/123456",
    facts: { title: "Testwohnung", city: "Hamburg", image_url: null },
  }];
  const listingPage = await listingMiniAppResponse(sql, "00000000-0000-0000-0000-000000000003");
  for (const [response, expected] of [
    [miniAppPage(), "'self' https://web.telegram.org"],
    [listingPage, "https://web.telegram.org"],
  ]) {
    assert.equal(response.status, 200);
    const csp = response.headers.get("content-security-policy");
    assert.equal(csp?.match(/(?:^|;\s*)frame-ancestors\s+([^;]+)/)?.[1], expected);
    assert.doesNotMatch(csp, /frame-ancestors 'none'/);
  }
});
