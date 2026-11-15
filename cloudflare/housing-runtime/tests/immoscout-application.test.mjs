import test from "node:test";
import assert from "node:assert/strict";
import { sendImmoScoutApplication } from "../src/immoscout-application.js";

test("ImmoScout application fails closed when the central credential is unavailable", async () => {
  await assert.rejects(
    () => sendImmoScoutApplication({ participant_id: "user-1", external_id: "123456789", profile: {} }, {}, () => {}),
    /test_mode_central_account_unavailable/,
  );
});

test("ImmoScout attaches the 24-hour D1 document-package link when the provider form supports it", async () => {
  const originalFetch = globalThis.fetch;
  const env = {};
  const participantId = "00000000-0000-4000-8000-000000000001";
  const central = { credentials: {
    access_token: "central-access-token", refresh_token: "central-refresh-token",
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  } };
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
      document_package_url: "https://intern.traumwohnunghamburg.de/edge/documents/package?t=signed",
    }, env, async () => [], central);
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
