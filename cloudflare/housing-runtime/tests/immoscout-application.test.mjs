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


test("Scout maps persisted applicant data into all documented mandatory contact fields", async () => {
  const previous = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith("/contact")) {
      return Response.json({ "common.messages": [{ message: { messageCode: "ERROR_VALIDATION_FAILED",
        message: "sensitive applicant details must never be persisted" } }] }, { status: 422 });
    }
    return Response.json({ "expose.expose": {
      "@contactFormType": "LONG",
      contactFormConfiguration: {
        firstnameField: "MANDATORY", lastnameField: "MANDATORY",
        phoneNumberField: "MANDATORY", emailAddressField: "MANDATORY",
        addressField: "MANDATORY", salutationField: "MANDATORY",
        petsInHouseholdField: "MANDATORY", numberOfPersonsField: "MANDATORY",
        employmentRelationshipField: "MANDATORY", incomeField: "MANDATORY",
        moveInDateField: "MANDATORY", messageField: "MANDATORY",
      },
    } });
  };
  try {
    const result = await sendImmoScoutApplication({
      external_id: "123456789", test_mode: true,
      profile: {
        first_name: "Test", last_name: "Person", email: "test@example.com",
        phone: "+49401234567", street: "Teststraße", house_number: "42",
        postcode: "20095", city: "Hamburg", salutation: "MR",
        pets: "Nein", household_size: 1, employment_status: "EMPLOYEE",
        income_range: "2000_3000", move_in_preference: "IMMEDIATE",
        message_apartment: "Interesse an dieser Wohnung",
      },
      authorizeTestSend: async () => true,
    }, {}, null, { credentials: { access_token: "test-only-token" } });
    assert.equal(requests.length, 2);
    const form = requests[1].body["expose.contactForm"];
    assert.equal(form["@contactFormType"], "LONG");
    assert.equal(form.firstname, "Test");
    assert.equal(form.lastname, "Person");
    assert.equal(form.phoneNumber, "+49401234567");
    assert.equal(form.emailAddress, "test@example.com");
    assert.equal(form.salutation, "MALE");
    assert.deepEqual(form.address, {
      "@xsi.type": "common:Address", street: "Teststraße", houseNumber: "42",
      postcode: "20095", city: "Hamburg",
    });
    assert.equal(form.petsInHousehold, "Nein");
    assert.equal(form.numberOfPersons, 1);
    assert.equal(form.employmentRelationship, "Angestellt");
    assert.equal(form.income, "2000 € - 3000 €");
    assert.equal(form.moveInDate, "Ab sofort");
    assert.equal(result.status, "manual_required");
    assert.equal(result.error, "provider_rejected");
    assert.equal(result.provider_http_status, 422);
    assert.equal(result.provider_message_code, "ERROR_VALIDATION_FAILED");
    assert.doesNotMatch(JSON.stringify(result), /sensitive applicant|test@example.com/);
  } finally { globalThis.fetch = previous; }
});

test("Scout never reserves or sends when a documented mandatory profile field is missing", async () => {
  const previous = globalThis.fetch;
  const calls = [];
  let authorized = false;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/contact")) throw new Error("POST must not happen");
    return Response.json({ "expose.expose": {
      "@contactFormType": "LONG",
      contactFormConfiguration: {
        petsInHouseholdField: "MANDATORY",
        numberOfPersonsField: "MANDATORY",
        incomeField: "MANDATORY",
      },
    } });
  };
  try {
    const result = await sendImmoScoutApplication({
      external_id: "123456789", test_mode: true,
      profile: { pets: "Nein", income_range: "2000_3000" },
      authorizeTestSend: async () => { authorized = true; return true; },
    }, {}, null, { credentials: { access_token: "test-only-token" } });
    assert.deepEqual(result, {
      status: "manual_required", error: "required_profile_data_missing:numberOfPersons",
    });
    assert.equal(authorized, false);
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = previous; }
});

test("Scout blocks exposes that do not allow contact", async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    return Response.json({ "expose.expose": { "@contactFormType": "NONE" } });
  };
  try {
    const result = await sendImmoScoutApplication({
      external_id: "123456789", profile: { first_name: "Test" },
    }, {}, null, { credentials: { access_token: "test-only-token" } });
    assert.equal(result.status, "manual_required");
    assert.equal(result.error, "provider_contact_disabled");
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = previous; }
});
