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

const GUID_APP = {
  canonical_url: "https://www.immowelt.de/expose/b9280be8-15b0-4d66-bc46-13a65184a747",
  profile: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" },
};

test("Immowelt bearer-only credentials report their own reason", async () => {
  const result = await sendImmoweltApplication(GUID_APP, {}, null, { credentials: { access_token: "x" } });
  assert.equal(result.error, "provider_credentials_bearer_only");
});

test("Immowelt unset transport flag reports its own reason", async () => {
  const cookies = [{ name: "oauth.access.token", value: "v", domain: ".immowelt.de", expires: -1 }];
  const result = await sendImmoweltApplication(GUID_APP, {}, null, { credentials: { cookies } });
  assert.equal(result.error, "provider_transport_unverified");
});
