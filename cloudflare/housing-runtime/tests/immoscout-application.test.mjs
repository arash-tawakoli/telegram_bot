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
    // Unsupported optional form extensions must not break schema validation;
    // the signed document link stays inside the contact message.
    assert.equal(form.applicationPackageLink, undefined);
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
    assert.equal(form["@contactFormType"], undefined);
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
    assert.equal(form.employmentRelationship, "Angestellte(r)");
    assert.equal(form.income, "2.000€ - 3.000€");
    assert.equal(form.moveInDate, "Sofort");
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

test("Scout guest contact uses documented schema order even when provider configuration is reversed", async () => {
  const oldFetch = globalThis.fetch;
  const calls = [];
  const fields = {
    applicationPackageLinkField: "OPTIONAL",
    applicationPackageCompletedField: "MANDATORY",
    salutationField: "MANDATORY",
    incomeField: "MANDATORY",
    employmentRelationshipField: "MANDATORY",
    numberOfPersonsField: "MANDATORY",
    petsInHouseholdField: "MANDATORY",
    moveInDateField: "MANDATORY",
    addressField: "MANDATORY",
    emailAddressField: "MANDATORY",
    phoneNumberField: "MANDATORY",
    lastnameField: "MANDATORY",
    firstnameField: "MANDATORY",
    messageField: "OPTIONAL",
  };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null,
      authorization: init.headers?.authorization });
    if (String(url).endsWith("/contact")) {
      const form = calls.at(-1).body["expose.contactForm"];
      const keys = Object.keys(form).filter(k => k !== "@xmlns");
      const expected = [
        "firstname", "lastname", "phoneNumber", "emailAddress", "message", "address",
        "moveInDate", "petsInHousehold", "numberOfPersons", "employmentRelationship",
        "income", "salutation", "applicationPackageCompleted",
      ];
      if (JSON.stringify(keys) !== JSON.stringify(expected) || "@contactFormType" in form ||
          "applicationPackageLink" in form) {
        return Response.json({ messageCode: "ERROR_COMMON_SCHEMA_VALIDATION_FAILED" }, { status: 412 });
      }
      return Response.json({ ok: true });
    }
    return Response.json({ "expose.expose": {
      "@contactFormType": "LONG", contactFormConfiguration: fields,
    } });
  };
  try {
    const result = await sendImmoScoutApplication({
      test_mode: true, external_id: "123456789",
      authorizeTestSend: async () => true,
      profile: {
        first_name: "Gast", last_name: "Kontakt", email: "gast@example.de",
        phone: "+491701234567", street: "Testweg", house_number: "4",
        postcode: "20095", city: "Hamburg", salutation: "MR", pets: "Nein",
        household_size: 1, employment_status: "EMPLOYEE", income_range: "2000_3000",
        move_in_preference: "IMMEDIATE", message_apartment: "Ich interessiere mich",
      },
      document_package_url: "https://example.test/documents/signed",
    }, {}, null, { credentials: { access_token: "central-credential" } });
    assert.equal(result.status, "sent");
    assert.equal(result.confirmation, "official_rest_2xx");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].authorization, "Bearer central-credential");
    assert.equal(calls[1].body["expose.contactForm"].emailAddress, "gast@example.de");
    assert.match(calls[1].body["expose.contactForm"].message, /documents\/signed/);
  } finally { globalThis.fetch = oldFetch; }
});

test("Scout blocks unknown mandatory provider extensions before reserving a send", async () => {
  const before = globalThis.fetch;
  const calls = [];
  let reserved = false;
  globalThis.fetch = async url => {
    calls.push(String(url));
    if (String(url).endsWith("/contact")) throw Error("unexpected contact POST");
    return Response.json({ "expose.expose": { contactFormConfiguration: {
      firstNameField: "OPTIONAL", unsupportedExtraField: "MANDATORY",
    } } });
  };
  try {
    const result = await sendImmoScoutApplication({
      test_mode: true, external_id: "123456789",
      profile: { first_name: "Gast" },
      authorizeTestSend: async () => { reserved = true; return true; },
    }, {}, null, { credentials: { access_token: "central-credential" } });
    assert.equal(result.status, "manual_required");
    assert.match(result.error, /required_profile_data_missing:unsupportedExtra/);
    assert.equal(reserved, false);
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = before; }
});

test("Scout resource-validation diagnostics capture only known field/rule, never submitted personal values", async () => {
  const before = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(String(url));
    if (String(url).endsWith("/contact")) {
      return Response.json({ "common.messages": [{ message: {
        messageCode: "ERROR_RESOURCE_VALIDATION",
        message: "Error while validating input for the resource. [MESSAGE: income : test-person@example.com : INVALID_VALUE]",
      } }] }, { status: 412 });
    }
    return Response.json({ "expose.expose": { contactFormConfiguration: {
      incomeField: "MANDATORY", firstnameField: "MANDATORY",
    } } });
  };
  try {
    const result = await sendImmoScoutApplication({
      external_id: "123456789", test_mode: true,
      authorizeTestSend: async () => true,
      profile: { first_name: "Gast", income_range: "2000_3000" },
    }, {}, null, { credentials: { access_token: "central-token" } });
    assert.equal(result.status, "manual_required");
    assert.equal(result.provider_http_status, 412);
    assert.equal(result.provider_message_code, "ERROR_RESOURCE_VALIDATION");
    assert.equal(result.provider_validation_field, "income");
    assert.equal(result.provider_validation_rule, "INVALID_VALUE");
    assert.equal(calls.length, 2);
    assert.doesNotMatch(JSON.stringify(result), /test-person@example.com|central-token/);
  } finally { globalThis.fetch = before; }
});

test("Scout provider diagnostics omit unknown fields and all raw values", async () => {
  const before = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/contact")) {
      return Response.json({ "common.messages": [{ message: {
        messageCode: "ERROR_RESOURCE_VALIDATION",
        message: "Error while validating input for the resource. [MESSAGE: privateField : 015112345678 : INVALID_VALUE]",
      } }] }, { status: 412 });
    }
    return Response.json({ "expose.expose": { contactFormConfiguration: {
      firstnameField: "MANDATORY",
    } } });
  };
  try {
    const result = await sendImmoScoutApplication({
      external_id: "123456789", test_mode: true,
      authorizeTestSend: async () => true,
      profile: { first_name: "Gast" },
    }, {}, null, { credentials: { access_token: "central-token" } });
    assert.equal(result.provider_message_code, "ERROR_RESOURCE_VALIDATION");
    assert.equal(result.provider_validation_field, undefined);
    assert.equal(result.provider_validation_rule, undefined);
    assert.doesNotMatch(JSON.stringify(result), /privateField|015112345678/);
  } finally { globalThis.fetch = before; }
});

test("Scout keeps exact monthly income numeric when explicitly provided", async () => {
  const before = globalThis.fetch;
  let posted = null;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith("/contact")) {
      posted = JSON.parse(init.body)["expose.contactForm"];
      return Response.json({ "common.messages": [{ message: {
        messageCode: "MESSAGE_OPERATION_SUCCESSFUL", message: "Operation successful",
      } }] });
    }
    return Response.json({ "expose.expose": { contactFormConfiguration: {
      incomeField: "MANDATORY", firstnameField: "MANDATORY",
    } } });
  };
  try {
    const result = await sendImmoScoutApplication({
      external_id: "123456789", test_mode: true,
      authorizeTestSend: async () => true,
      profile: { first_name: "Gast", income_range: "2000_3000", monthly_net_income: 2750 },
    }, {}, null, { credentials: { access_token: "central-token" } });
    assert.equal(result.status, "sent");
    assert.equal(posted.income, 2750);
  } finally { globalThis.fetch = before; }
});
