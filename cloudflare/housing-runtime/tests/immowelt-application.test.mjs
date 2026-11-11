import test from "node:test";
import assert from "node:assert/strict";
import { sendImmoweltApplication } from "../src/immowelt-application.js";

test("Immowelt application fails closed when the provider identity or profile is incomplete", async () => {
  const result = await sendImmoweltApplication({
    canonical_url: "https://www.immowelt.de/expose/example",
    profile: { first_name: "Ada", last_name: "Lovelace" },
  }, {});
  assert.equal(result.status, "manual_required");
  assert.equal(result.error, "required_profile_data_missing");
});

test("Immowelt application rejects a non UUID expose identifier before network submission", async () => {
  const result = await sendImmoweltApplication({
    canonical_url: "https://www.immowelt.de/expose/example",
    profile: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" },
  }, {});
  assert.equal(result.status, "manual_required");
  assert.equal(result.error, "provider_identifier_unresolved");
});
