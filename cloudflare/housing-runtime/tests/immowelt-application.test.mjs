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

test("Immowelt cookie session that also carries an access_token is not bearer-only", async () => {
  const cookies = [{ name: "oauth.access.token", value: "v", domain: ".immowelt.de", expires: -1 }];
  const result = await sendImmoweltApplication(GUID_APP, {}, null, { credentials: { access_token: "x", cookies } });
  assert.equal(result.error, "send_not_authorized");
});

test("Immowelt bearer-only credentials report their own reason", async () => {
  const result = await sendImmoweltApplication(GUID_APP, {}, null, { credentials: { access_token: "x" } });
  assert.equal(result.error, "provider_credentials_bearer_only");
});

test("normal Immowelt application with the gate on sends the applicant's own identity", async () => {
  const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url: String(url), body: String(init.body), cookie: init.headers.cookie };
    return new Response("<r><SendContactMailResult>true</SendContactMailResult><note>session-secret</note></r>", { status: 200 });
  };
  try {
    const cookies = [{ name: "oauth.access.token", value: "session-secret", domain: ".immowelt.de", expires: -1 }];
    const result = await sendImmoweltApplication({
      ...GUID_APP,
      authorizeSend: async () => true,
      profile: { first_name: "Eva", last_name: "Test", email: "eva@example.com", phone: "+491711234567", message: "Hallo" },
    }, { AUTO_APPLY_PROVIDERS: "immowelt" }, null, { ownerId: "owner", credentials: { cookies } });
    assert.equal(result.status, "sent");
    assert.match(sent.body, /<Name>Eva Test<\/Name><EMail>eva@example\.com<\/EMail>/);
    assert.equal(result.provider_http_status, 200);
    assert.ok(result.provider_response_excerpt.length <= 300);
    assert.doesNotMatch(result.provider_response_excerpt, /session-secret/);
  } finally { globalThis.fetch = original; }
});

test("Immowelt excerpt masks applicant e-mail and phone numbers", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("<f>Fehler for eva@example.com call +49 171 1234567</f>", { status: 500 });
  try {
    const cookies = [{ name: "oauth.access.token", value: "session-secret", domain: ".immowelt.de", expires: -1 }];
    const result = await sendImmoweltApplication({ ...GUID_APP, authorizeSend: async () => true }, {}, null, { credentials: { cookies } });
    assert.equal(result.provider_http_status, 500);
    assert.doesNotMatch(result.provider_response_excerpt, /eva@example|1234567/);
  } finally { globalThis.fetch = original; }
});
