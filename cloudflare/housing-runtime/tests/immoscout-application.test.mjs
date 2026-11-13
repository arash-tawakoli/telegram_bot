import test from "node:test";
import assert from "node:assert/strict";
import { sendImmoScoutApplication } from "../src/immoscout-application.js";
import { encryptProviderCredentials } from "../src/provider-credentials.js";

test("ImmoScout application fails closed when the encrypted provider session is absent", async () => {
  await assert.rejects(
    () => sendImmoScoutApplication({ participant_id: "user-1", external_id: "123456789", profile: {} }, {}, () => {}),
    /credential_key_invalid|needs_login/,
  );
});

test("ImmoScout attaches the 24-hour D1 document-package link when the provider form supports it", async () => {
  const originalFetch = globalThis.fetch;
  const env = { APPLICATION_CREDENTIAL_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" };
  const participantId = "00000000-0000-4000-8000-000000000001";
  const credentials = await encryptProviderCredentials(env, {
    access_token: "access-token", refresh_token: "refresh-token", expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  }, participantId, "immoscout24");
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith("/contact")) return new Response("{}", { status: 200 });
    return Response.json({ "expose.expose": { contactFormConfiguration: {
      messageField: { state: "MANDATORY" },
      applicationPackageCompletedField: { state: "MANDATORY" },
      applicationPackageLinkField: { state: "OPTIONAL" },
    } } }, { status: 200 });
  };
  try {
    const result = await sendImmoScoutApplication({
      participant_id: participantId,
      external_id: "123456789",
      canonical_url: "https://www.immobilienscout24.de/expose/123456789",
      profile: { first_name: "A", last_name: "B", email: "a@example.com", phone: "+49123456789", street: "Testweg", house_number: "1", postcode: "20095", city: "Hamburg", message_apartment: "Interesse an der Wohnung" },
      connection_ciphertext: credentials.ciphertext,
      connection_iv: credentials.iv,
      connection_key_version: credentials.key_version,
      document_package_url: "https://intern.traumwohnunghamburg.de/edge/documents/package?t=signed",
    }, env, async () => []);
    assert.equal(result.status, "sent");
    const sent = calls.find(call => call.url.endsWith("/contact"));
    const form = sent.body["expose.contactForm"];
    assert.equal(form.applicationPackageCompleted, true);
    assert.match(form.applicationPackageLink, /documents\/package\?t=signed/);
    assert.match(form.message, /Bewerbungsunterlagen \(geschützter Link\)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
