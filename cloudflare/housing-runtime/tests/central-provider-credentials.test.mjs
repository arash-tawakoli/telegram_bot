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
    access_token: "opaque-central-access",
    refresh_token: "opaque-central-refresh",
    expires_at: "2099-01-01T00:00:00Z",
    client_id: "registered-client",
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
  assert.equal(result.credentials.access_token, "opaque-central-access");
  assert.equal(result.credentials.refresh_token, "opaque-central-refresh");
  assert.match(queries[0].query, /owner.telegram_user_id/);
  assert.deepEqual(queries[0].values, [8538226539, "immowelt"]);
});

test("Immowelt central OAuth token refreshes automatically, without browser cookies", async () => {
  const originalFetch = globalThis.fetch;
  const env = { APPLICATION_CREDENTIAL_KEY: KEY, IMMOWELT_OAUTH_CLIENT_ID: "registered-client" };
  const encrypted = await encryptProviderCredentials(env, {
    access_token: "old-token", refresh_token: "old-refresh",
    client_id: "registered-client", expires_at: new Date(Date.now() - 30_000).toISOString(),
  }, OWNER_ID, "immowelt");
  const requests = [], queries = [];
  globalThis.fetch = async (url, opts) => {
    requests.push({ url: String(url), body: new URLSearchParams(opts.body) });
    return Response.json({ access_token: "new-token", refresh_token: "new-refresh", expires_in: 1200 });
  };
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    queries.push({ query, values });
    if (query.includes("SELECT pc.participant_id")) return [{
      participant_id: OWNER_ID, status: "connected", account_hint: "owner@example.com",
      ciphertext: encrypted.ciphertext, iv: encrypted.iv, key_version: encrypted.key_version,
    }];
    return [];
  };
  try {
    const result = await getCentralProviderCredentials(sql, env, "immowelt");
    assert.equal(result.credentials.access_token, "new-token");
    assert.equal(result.credentials.refresh_token, "new-refresh");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://signin.immowelt.de/oauth/token");
    assert.equal(requests[0].body.get("grant_type"), "refresh_token");
    assert.equal(requests[0].body.get("client_id"), "registered-client");
    assert.ok(queries.some(q => q.query.includes("UPDATE housing.provider_connections")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Immomio central OAuth token refresh uses Keycloak, not a remote browser", async () => {
  const originalFetch = globalThis.fetch;
  const env = { APPLICATION_CREDENTIAL_KEY: KEY };
  const encrypted = await encryptProviderCredentials(env, {
    access_token: "expired", refresh_token: "immomio-old-refresh",
    expires_at: new Date(Date.now() - 30_000).toISOString(),
  }, OWNER_ID, "immomio");
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({url:String(url), body:new URLSearchParams(options.body)});
    return Response.json({access_token:"immomio-new-access",refresh_token:"immomio-new-refresh",expires_in:900});
  };
  const sql = async (strings) => strings.join("").includes("SELECT pc.participant_id") ? [{
    participant_id:OWNER_ID,status:"connected",ciphertext:encrypted.ciphertext,
    iv:encrypted.iv,key_version:encrypted.key_version,
  }] : [];
  try {
    const result = await getCentralProviderCredentials(sql, env, "immomio");
    assert.equal(result.credentials.access_token, "immomio-new-access");
    assert.equal(calls[0].url, "https://sso.immomio.com/auth/realms/immomio/protocol/openid-connect/token");
    assert.equal(calls[0].body.get("grant_type"), "refresh_token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Immowelt cookie sessions without an access token require login", async () => {
  const env = { APPLICATION_CREDENTIAL_KEY: KEY };
  const encrypted = await encryptProviderCredentials(env, {
    cookies: [{ name: "legacy", value: "opaque", domain: ".immowelt.de" }],
  }, OWNER_ID, "immowelt");
  const sql = async () => [{
    participant_id:OWNER_ID,status:"connected",ciphertext:encrypted.ciphertext,
    iv:encrypted.iv,key_version:encrypted.key_version,
  }];
  await assert.rejects(() => getCentralProviderCredentials(sql,env,"immowelt"),
    /needs_login/);
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

test("Immomio rejects a different participant even when profile email matches the owner", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("must not contact Immomio for another participant"); };
  try {
    const outcome = await sendImmomioApplication({
      participant_id: "other-applicant-id",
      profile: { email: "owner@example.com" },
      facts: { applicationLink: "https://tenant.immomio.com/apply/12345678-1234-4234-8234-123456789012" },
    }, {}, null, {
      ownerId: OWNER_ID, credentials: { access_token: "opaque", expires_at: "2099-01-01T00:00:00Z" },
    });
    assert.deepEqual(outcome, { status: "manual_required", error: "central_identity_mismatch" });
  } finally {
    globalThis.fetch = originalFetch;
  }
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
    }, {}, null, { ownerId: "applicant-id", credentials: { access_token: "opaque", expires_at: "2099-01-01T00:00:00Z" } });
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
