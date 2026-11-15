import test from "node:test";
import assert from "node:assert/strict";
import { encryptProviderCredentials } from "../src/provider-credentials.js";
import { centralCredentialError, getCentralProviderCredentials } from "../src/central-provider-credentials.js";
import { sendImmomioApplication } from "../src/immomio-application.js";
import { sendImmoweltApplication } from "../src/immowelt-application.js";

const KEY = "ab".repeat(32);
const OWNER_ID = "owner-participant-id";

test("central providers use the administrator credential, never the applicant connection", async () => {
  const env = { APPLICATION_CREDENTIAL_KEY: KEY };
  const encrypted = await encryptProviderCredentials(env, {
    cookies: [{ name: "central_session", value: "opaque", domain: ".immowelt.de", expires: -1 }],
  }, OWNER_ID, "immowelt");
  const queries = [];
  const sql = async (strings, ...values) => {
    queries.push({ query: strings.join("?"), values });
    return [{
      participant_id: OWNER_ID, status: "connected",
      ciphertext: encrypted.ciphertext, iv: encrypted.iv,
      key_version: encrypted.key_version, account_hint: "owner@example.com",
    }];
  };
  const result = await getCentralProviderCredentials(sql, env, "immowelt");
  assert.equal(result.ownerId, OWNER_ID);
  assert.equal(result.credentials.cookies[0].value, "opaque");
  assert.match(queries[0].query, /owner.telegram_user_id/);
  assert.deepEqual(queries[0].values, [8538226539, "immowelt"]);
});

test("Scout production requires explicit central account enablement", async () => {
  const env = {
    CENTRAL_TOKEN_ENCRYPTION_KEY: KEY,
    HOUSING_DB: {
      prepare() {
        return {
          async first() {
            return {
              status: "connected", enabled: 0,
              account_hint: "arash@nexalabs.de",
              ciphertext: "opaque", iv: "opaque",
            };
          },
        };
      },
    },
  };
  await assert.rejects(
    () => getCentralProviderCredentials(null, env, "immoscout24"),
    /test_mode_central_account_unavailable/,
  );
});

test("missing administrator connection fails closed", async () => {
  const sql = async () => [];
  await assert.rejects(
    () => getCentralProviderCredentials(sql, {}, "immomio"),
    /central_provider_unavailable/,
  );
});

test("central credential errors disclose only safe diagnostics", () => {
  assert.equal(centralCredentialError(new Error("central_provider_unavailable")), "central_provider_unavailable");
  assert.equal(centralCredentialError(new Error("sensitive details")), "provider_contract_unverified");
});

test("Immomio never creates an application under the wrong account identity", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    requests.push(payload.query);
    return new Response(JSON.stringify({ data: { user: { id: "owner", email: "owner@example.com" } } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  try {
    const outcome = await sendImmomioApplication({
      participant_id: "applicant-id",
      profile: { email: "applicant@example.com" },
      facts: { applicationLink: "https://tenant.immomio.com/apply/12345678-1234-4234-8234-123456789012" },
    }, {}, null, { ownerId: OWNER_ID, credentials: { access_token: "opaque", expires_at: "2099-01-01T00:00:00Z" } });
    assert.deepEqual(outcome, { status: "manual_required", error: "central_identity_mismatch" });
    assert.equal(requests.length, 1);
    assert.match(requests[0], /currentUser/);
    assert.equal(requests.some((q) => /createApplication/.test(q)), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Immowelt refuses to transmit until the central session transport is verified", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("unexpected outbound request"); };
  try {
    const result = await sendImmoweltApplication({
      canonical_url: "https://www.immowelt.de/expose/64f4e6cd-26d3-4bb6-9481-a0a87694bf38",
      profile: { email: "applicant@example.com", first_name: "Anna", last_name: "Beispiel" },
    }, {}, null, {
      ownerId: OWNER_ID,
      credentials: { cookies: [{ name: "session", value: "opaque", domain: ".immowelt.de", expires: -1 }] },
    });
    assert.deepEqual(result, { status: "manual_required", error: "provider_contract_unverified" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
