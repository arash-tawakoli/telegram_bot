import test from "node:test";
import assert from "node:assert/strict";
import { handleProviderFacade } from "../src/provider-facade.js";
import { decryptProviderCredentials, encryptProviderCredentials } from "../src/provider-credentials.js";
import { refreshImmomioSession } from "../src/immomio-application.js";

const ticket = "provider-flow-test_12345678901234567890";
const password = "not-a-real-password";
const env = { APPLICATION_CREDENTIAL_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" };

function makeSql(profileEmail = null) {
  const writes = [];
  const sql = async (strings) => {
    const query = strings.join(" ");
    if (query.includes("FROM provider_auth_flows")) return [{ id: "flow-id", participant_id: "participant-id", provider: "immomio", state: ticket, code_verifier: "test-verifier", origin: "coach", return_target: "coach", context: {}, expires_at: new Date(Date.now() + 60_000).toISOString() }];
    if (query.includes("FROM participants p")) return [{ first_name: "Test", last_name: "User", profile: profileEmail ? { email: profileEmail } : {}, account_hint: null }];
    if (query.includes("FROM participants")) return [{ id: "participant-id", status: "active" }];
    return [];
  };
  sql.unsafe = async (query, params = []) => { writes.push({ query, params }); return { count: 1 }; };
  return { sql, writes };
}

function facadeRequest(body) {
  return new Request("https://housing-runtime.internal/edge/provider/facade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket, ...body }) });
}

test("Immomio password login completes through D1 and never stores the password", async () => {
  const originalFetch = globalThis.fetch;
  let tokenMode = "success";
  const tokenRequests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "https://gql-ps.immomio.com/tenant/graphql") {
      const body = JSON.parse(init.body);
      if (body.query.includes("query sso")) return Response.json({ data: { sso: { baseUrl: "https://sso.immomio.com/auth", clientId: "immomio-oidc-web", realm: "immomio" } } });
      return Response.json({ data: { user: { id: "immomio-user", email: "verified@example.com" } } });
    }
    if (url.endsWith("/protocol/openid-connect/token")) {
      tokenRequests.push(new URLSearchParams(init.body));
      if (tokenMode === "locked") return Response.json({ error: "temporarily_disabled", error_description: "Account temporarily locked after too many login attempts" }, { status: 400 });
      if (tokenMode === "mfa") return Response.json({ error: "invalid_grant", error_description: "OTP required" }, { status: 400 });
      if (tokenMode === "invalid") return Response.json({ error: "invalid_grant", error_description: "Invalid user credentials" }, { status: 401 });
      return Response.json({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const { sql, writes } = makeSql();
    const response = await handleProviderFacade(sql, facadeRequest({ action: "password_login", email: "participant@example.com", password }), env);
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.authenticated, true);
    assert.equal(result.accountHint, "verified@example.com");
    assert.equal(tokenRequests[0].get("grant_type"), "password");
    assert.equal(tokenRequests[0].get("username"), "participant@example.com");
    assert.equal(tokenRequests[0].get("password"), password);
    const saved = writes.find((entry) => entry.query.includes("UPDATE provider_connections"));
    assert.ok(saved);
    assert.equal(saved.params.includes(password), false);
    const credentials = await decryptProviderCredentials(env, { ciphertext: saved.params[0], iv: saved.params[1], key_version: saved.params[2] }, "participant-id", "immomio");
    assert.equal(credentials.access_token, "access-token");
    assert.equal(credentials.refresh_token, "refresh-token");
    assert.equal(Object.hasOwn(credentials, "password"), false);

    const beforeResolve = tokenRequests.length;
    const missingEmail = await handleProviderFacade(makeSql().sql, facadeRequest({ action: "resolve" }), env);
    const resolveResult = await missingEmail.json();
    assert.equal(missingEmail.status, 200);
    assert.equal(resolveResult.mode, "provider_web");
    assert.equal(resolveResult.url, undefined);
    assert.equal(tokenRequests.length, beforeResolve);

    for (const [mode, expectedStatus, expectedError] of [["invalid", 401, "login_failed"], ["locked", 423, "account_temporarily_locked"], ["mfa", 409, "provider_interactive_challenge"]]) {
      tokenMode = mode;
      const failed = await handleProviderFacade(makeSql().sql, facadeRequest({ action: "password_login", email: "participant@example.com", password }), env);
      assert.equal(failed.status, expectedStatus);
      assert.equal((await failed.json()).error, expectedError);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("Immomio refresh-token revocation is reported as a login requirement", async () => {
  const originalFetch = globalThis.fetch;
  const participantId = "00000000-0000-4000-8000-000000000019";
  const credentials = await encryptProviderCredentials(env, {
    access_token: "expired-access", refresh_token: "revoked-refresh",
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  }, participantId, "immomio");
  globalThis.fetch = async () => Response.json({ error: "invalid_grant" }, { status: 400 });
  try {
    await assert.rejects(() => refreshImmomioSession(async () => { throw new Error("should not persist"); }, env, {
      participant_id: participantId, ciphertext: credentials.ciphertext, iv: credentials.iv, key_version: credentials.key_version,
    }), /needs_login/);
  } finally { globalThis.fetch = originalFetch; }
});
