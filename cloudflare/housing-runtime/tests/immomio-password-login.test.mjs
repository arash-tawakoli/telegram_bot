import test from "node:test";
import assert from "node:assert/strict";
import { handleProviderFacade } from "../src/provider-facade.js";
import { decryptProviderCredentials } from "../src/provider-credentials.js";

const ticket = "provider-flow-test_12345678901234567890";
const KEY = "01".repeat(32);
const credentialEnv = { APPLICATION_CREDENTIAL_KEY: KEY };
const immoweltEnv = { ...credentialEnv, IMMOWELT_OAUTH_CLIENT_ID: "immowelt-registered-client" };

function makeSql(provider = "immomio") {
  const writes = [];
  const sql = async (strings) => {
    const q = strings.join(" ");
    if (q.includes("FROM provider_auth_flows")) return [{
      id: "flow-id", participant_id: "operator-id", provider, state: ticket,
      code_verifier: "test-pkce-verifier", origin: "coach", return_target: "coach",
      context: { central_account: true }, expires_at: new Date(Date.now() + 60_000).toISOString(),
    }];
    if (q.includes("FROM participants p")) return [{ first_name: "Central", last_name: "Owner", account_hint: "owner@example.com" }];
    if (q.includes("FROM participants")) return [{
      id: "operator-id", status: "active", telegram_user_id: 8538226539,
    }];
    return [];
  };
  sql.unsafe = async (query, params = []) => {
    writes.push({ query, params }); return { count: 1 };
  };
  return { sql, writes };
}
function request(action, payload = {}) {
  return new Request("https://housing-runtime.test/edge/provider/facade", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket, action, ...payload }),
  });
}
function fetchStub() {
  const calls = [];
  const stub = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://gql-ps.immomio.com/tenant/graphql") {
      const query = JSON.parse(init.body).query;
      if (query.includes("query sso")) return Response.json({
        data: { sso: { baseUrl: "https://sso.immomio.com/auth", clientId: "immomio-oidc-web", realm: "immomio" } },
      });
      return Response.json({ data: { user: { id: "immomio-user", email: "verified@example.com" } } });
    }
    if (url === "https://sso.immomio.com/auth/realms/immomio/protocol/openid-connect/token") {
      return Response.json({ access_token: "immomio-token", refresh_token: "immomio-refresh", expires_in: 3600 });
    }
    if (url === "https://signin.immowelt.de/oauth/token") {
      return Response.json({ access_token: "immowelt-token", refresh_token: "immowelt-refresh", expires_in: 3600 });
    }
    if (url === "https://signin.immowelt.de/userinfo") {
      return Response.json({ sub: "auth0|owner", email: "verified@example.com" });
    }
    throw Error("unexpected endpoint: " + url);
  };
  return { stub, calls };
}
async function withFetch(stub, callback) {
  const original = globalThis.fetch; globalThis.fetch = stub;
  try { return await callback(); } finally { globalThis.fetch = original; }
}

test("Immomio's administrator login is provider-hosted OAuth with manual PKCE callback", async () => {
  const { stub, calls } = fetchStub();
  await withFetch(stub, async () => {
    const { sql } = makeSql("immomio");
    const resolved = await handleProviderFacade(sql, request("resolve"), credentialEnv);
    const data = await resolved.json();
    assert.equal(data.mode, "provider_web");
    assert.equal(data.centralAccount, true);
    assert.equal(data.requiresManualCallback, true);
    assert.equal(data.callbackTransport, "manual-provider-pkce");
    const link = await handleProviderFacade(sql, request("provider_web", { email: "owner@example.com" }), credentialEnv);
    assert.equal(link.status, 200);
    const address = new URL((await link.json()).url);
    assert.equal(address.hostname, "sso.immomio.com");
    assert.equal(address.searchParams.get("client_id"), "immomio-oidc-web");
    assert.equal(address.searchParams.get("redirect_uri"), "https://tenant.immomio.com/de/auth/login");
    assert.equal(address.searchParams.get("state"), ticket);
    assert.equal(address.searchParams.get("code_challenge_method"), "S256");
    assert.equal(calls.some(c => c.url.includes("openid-connect/token")), false);
  });
});

test("Immomio no longer accepts provider passwords through the backend", async () => {
  const { stub, calls } = fetchStub();
  await withFetch(stub, async () => {
    const response = await handleProviderFacade(makeSql().sql,
      request("password_login", { email: "owner@example.com", password: "not-a-real-password" }), credentialEnv);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "provider_oauth_required");
    assert.equal(calls.length, 0);
  });
});

test("Immomio PKCE code exchange verifies the profile and stores only encrypted tokens", async () => {
  const { stub, calls } = fetchStub();
  await withFetch(stub, async () => {
    const { sql, writes } = makeSql("immomio");
    const cb = "https://tenant.immomio.com/de/auth/login?code=test-immomio-code&state=" + ticket;
    const result = await handleProviderFacade(sql, request("complete_web", { callbackUrl: cb }), credentialEnv);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).authenticated, true);
    const tokenReq = calls.find(x => x.url.endsWith("/protocol/openid-connect/token"));
    assert.ok(tokenReq);
    const params = new URLSearchParams(tokenReq.init.body);
    assert.equal(params.get("grant_type"), "authorization_code");
    assert.equal(params.get("code_verifier"), "test-pkce-verifier");
    assert.equal(params.get("redirect_uri"), "https://tenant.immomio.com/de/auth/login");
    const saved = writes.find(x => x.query.includes("UPDATE provider_connections"));
    assert.ok(saved);
    const decrypted = await decryptProviderCredentials(credentialEnv,
      { ciphertext: saved.params[0], iv: saved.params[1], key_version: saved.params[2] },
      "operator-id", "immomio");
    assert.equal(decrypted.access_token, "immomio-token");
    assert.equal(decrypted.refresh_token, "immomio-refresh");
    assert.equal(Object.hasOwn(decrypted, "password"), false);
  });
});

test("Immomio rejects wrong callback state before token exchange", async () => {
  const { stub, calls } = fetchStub();
  await withFetch(stub, async () => {
    const result = await handleProviderFacade(makeSql().sql,
      request("complete_web", { callbackUrl: "https://tenant.immomio.com/de/auth/login?code=fake&state=other" }),
      credentialEnv);
    assert.equal(result.status, 400);
    assert.equal((await result.json()).error, "invalid_callback_url");
    assert.equal(calls.length, 0);
  });
});

test("Immowelt OAuth cannot start without a configured registered client", async () => {
  const { sql, writes } = makeSql("immowelt");
  const result = await handleProviderFacade(sql, request("provider_web"), credentialEnv);
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error, "provider_oauth_not_configured");
  assert.equal(writes.length, 0);
});

test("Immowelt creates an Auth0 S256 code URL with exact first-party callback", async () => {
  const { sql } = makeSql("immowelt");
  const resolve = await handleProviderFacade(sql, request("resolve"), immoweltEnv);
  assert.equal((await resolve.json()).oauthConfigured, true);
  const result = await handleProviderFacade(sql, request("provider_web"), immoweltEnv);
  assert.equal(result.status, 200);
  const u = new URL((await result.json()).url);
  assert.equal(u.origin, "https://signin.immowelt.de");
  assert.equal(u.pathname, "/authorize");
  assert.equal(u.searchParams.get("client_id"), "immowelt-registered-client");
  assert.equal(u.searchParams.get("redirect_uri"), "https://login.traumwohnunghamburg.de/oauth/immowelt/callback");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("state"), ticket);
});

test("Immowelt authorization callback requires a verified user and encrypts tokens", async () => {
  const { stub, calls } = fetchStub();
  await withFetch(stub, async () => {
    const { sql, writes } = makeSql("immowelt");
    const callbackUrl = "https://login.traumwohnunghamburg.de/oauth/immowelt/callback?state=" + ticket + "&code=opaque-code";
    const result = await handleProviderFacade(sql, request("complete_web", { callbackUrl }), immoweltEnv);
    assert.equal(result.status, 200);
    const returned = await result.json();
    assert.equal(returned.authenticated, true);
    assert.equal(returned.accountHint, "verified@example.com");
    const tokenReq = calls.find(x => x.url === "https://signin.immowelt.de/oauth/token");
    assert.ok(tokenReq);
    const params = new URLSearchParams(tokenReq.init.body);
    assert.equal(params.get("grant_type"), "authorization_code");
    assert.equal(params.get("code_verifier"), "test-pkce-verifier");
    const userInfo = calls.find(x => x.url === "https://signin.immowelt.de/userinfo");
    assert.equal(userInfo.init.headers.authorization, "Bearer immowelt-token");
    const saved = writes.find(x => x.query.includes("UPDATE provider_connections"));
    assert.ok(saved);
    const credentials = await decryptProviderCredentials(immoweltEnv,
      { ciphertext: saved.params[0], iv: saved.params[1], key_version: saved.params[2] },
      "operator-id", "immowelt");
    assert.equal(credentials.access_token, "immowelt-token");
    assert.equal(credentials.refresh_token, "immowelt-refresh");
    assert.equal(Object.hasOwn(credentials, "password"), false);
  });
});

test("Immowelt refuses an OAuth token without a refresh grant", async () => {
  const { stub } = fetchStub();
  const modified = async (url, opts) => {
    if (String(url) === "https://signin.immowelt.de/oauth/token")
      return Response.json({ access_token: "short-lived", expires_in: 3600 });
    return stub(url, opts);
  };
  await withFetch(modified, async () => {
    const { sql, writes } = makeSql("immowelt");
    const cb = "https://login.traumwohnunghamburg.de/oauth/immowelt/callback?state=" + ticket + "&code=opaque";
    const response = await handleProviderFacade(sql, request("complete_web", { callbackUrl: cb }), immoweltEnv);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "token_exchange_failed");
    assert.equal(writes.length, 0);
  });
});
