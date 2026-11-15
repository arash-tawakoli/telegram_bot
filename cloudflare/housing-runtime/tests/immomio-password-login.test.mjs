import test from "node:test";
import assert from "node:assert/strict";
import { handleProviderFacade } from "../src/provider-facade.js";
import { decryptProviderCredentials, encryptProviderCredentials } from "../src/provider-credentials.js";
import { refreshImmoweltSession } from "../src/immowelt-application.js";

const ticket = "provider-flow-test_12345678901234567890";
const KEY = "01".repeat(32);
const credentialEnv = { APPLICATION_CREDENTIAL_KEY: KEY };

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
    throw Error("unexpected endpoint: " + url);
  };
  return { stub, calls };
}
async function withFetch(stub, callback) {
  const original = globalThis.fetch; globalThis.fetch = stub;
  try { return await callback(); } finally { globalThis.fetch = original; }
}

test("Immomio can resolve to a central direct credentials flow while legacy PKCE remains available", async () => {
  const { stub, calls } = fetchStub();
  await withFetch(stub, async () => {
    const { sql } = makeSql("immomio");
    const resolved = await handleProviderFacade(sql, request("resolve"), credentialEnv);
    const data = await resolved.json();
    assert.equal(data.mode, "credentials");
    assert.equal(data.centralAccount, true);
    assert.equal(data.requiresManualCallback, false);
    assert.equal(data.callbackTransport, "direct-token");
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

test("Immomio direct login verifies the account, encrypts tokens and never stores password", async () => {
  const { stub, calls } = fetchStub();
  await withFetch(stub, async () => {
    const { sql, writes } = makeSql("immomio");
    const result = await handleProviderFacade(sql,
      request("password_login", { email: "owner@example.com", password: "example-only-password", totp: "123456" }),
      credentialEnv);
    assert.equal(result.status, 200);
    const status = await result.json();
    assert.equal(status.authenticated, true);
    assert.equal(status.accountHint, "verified@example.com");
    const auth = calls.find(x => x.url.endsWith("/protocol/openid-connect/token"));
    assert.ok(auth);
    const params = new URLSearchParams(auth.init.body);
    assert.equal(params.get("grant_type"), "password");
    assert.equal(params.get("client_id"), "immomio-oidc-web");
    assert.equal(params.get("username"), "owner@example.com");
    assert.equal(params.get("password"), "example-only-password");
    assert.equal(params.get("totp"), "123456");
    assert.equal(params.get("scope"), "openid profile email offline_access");
    const saved = writes.find(x => x.query.includes("UPDATE provider_connections"));
    assert.ok(saved);
    const decrypted = await decryptProviderCredentials(credentialEnv,
      { ciphertext: saved.params[0], iv: saved.params[1], key_version: saved.params[2] },
      "operator-id", "immomio");
    assert.equal(decrypted.access_token, "immomio-token");
    assert.equal(decrypted.refresh_token, "immomio-refresh");
    assert.equal(decrypted.expires_at.length > 15, true);
    assert.equal(Object.hasOwn(decrypted, "password"), false);
    assert.equal(Object.hasOwn(decrypted, "totp"), false);
    assert.equal(Object.hasOwn(decrypted, "username"), false);
  });
});

test("invalid Immomio credentials do not mutate any central token", async () => {
  const { sql, writes } = makeSql("immomio");
  const result = await withFetch(async (url) => {
    if (String(url).endsWith("/protocol/openid-connect/token"))
      return Response.json({ error: "invalid_grant", error_description: "Invalid user credentials" }, { status: 401 });
    throw Error("login should stop before profile verification");
  }, () => handleProviderFacade(sql,
    request("password_login", { email: "owner@example.com", password: "incorrect" }), credentialEnv));
  assert.equal(result.status, 401);
  assert.equal((await result.json()).error, "login_failed");
  assert.equal(writes.length, 0);
});

test("disabled password grant reports a provider limitation, not a successful login", async () => {
  const { sql, writes } = makeSql("immomio");
  const result = await withFetch(async () =>
    Response.json({ error: "unauthorized_client" }, { status: 400 }),
    () => handleProviderFacade(sql,
      request("password_login", { email: "owner@example.com", password: "incorrect" }), credentialEnv));
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error, "provider_contract_unverified");
  assert.equal(writes.length, 0);
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

test("central Immowelt logs in with the existing server form and stores only encrypted cookies", async () => {
  const { sql, writes } = makeSql("immowelt");
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const calls = [];
  const redirect = (location, cookie) => {
    const headers = new Headers({ location });
    if (cookie) headers.append("set-cookie", cookie);
    return new Response(null, { status: 302, headers });
  };
  const stub = async (input, init = {}) => {
    const url = String(input); calls.push({ url, init });
    if (url === "https://signin.immowelt.de/?target=portal&path=%2F")
      return redirect("https://signin.immowelt.de/login/transaction", "iw-flow=opaque; Domain=.immowelt.de; Path=/; HttpOnly; Secure");
    if (url === "https://signin.immowelt.de/login/transaction")
      return new Response('<form data-form-primary="true" action="/login/submit"><input type="hidden" name="csrf" value="csrf-1"><input name="username"><input name="password"></form>');
    if (url === "https://signin.immowelt.de/login/submit") {
      const params = new URLSearchParams(init.body);
      assert.equal(params.get("username"), "owner@example.com");
      assert.equal(params.get("password"), "portal-secret");
      return redirect("https://www.immowelt.de/step", "iw-session=opaque; Domain=.immowelt.de; Path=/; HttpOnly; Secure");
    }
    if (url === "https://www.immowelt.de/step") return new Response("account");
    if (url === "https://signin.immowelt.de/refresh")
      return redirect("https://www.immowelt.de/refresh-token", "oauth.access.token=immowelt-session-token; Domain=.immowelt.de; Path=/; HttpOnly; Secure; Max-Age=3600");
    if (url === "https://www.immowelt.de/refresh-token")
      return redirect("https://www.immowelt.de/refresh-finish", "oauth.access.expiration=" + expires + "; Domain=.immowelt.de; Path=/; Secure; Max-Age=3600");
    if (url === "https://www.immowelt.de/refresh-finish") return new Response("account");
    throw new Error("unexpected endpoint " + url);
  };
  await withFetch(stub, async () => {
    const response = await handleProviderFacade(sql,
      request("password_login", { email: "owner@example.com", password: "portal-secret" }), credentialEnv);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.authenticated, true);
    assert.equal(result.accountHint, "owner@example.com");
    const sent = calls.find((call) => call.url.endsWith("/login/submit"));
    assert.ok(sent);
    assert.equal(new URL(sent.url).hostname, "signin.immowelt.de");
    assert.ok(calls.some((call) => call.url === "https://signin.immowelt.de/refresh"));
    const saved = writes.find((write) => write.query.includes("UPDATE provider_connections"));
    assert.ok(saved);
    const credentials = await decryptProviderCredentials(credentialEnv,
      { ciphertext: saved.params[0], iv: saved.params[1], key_version: saved.params[2] },
      "operator-id", "immowelt");
    assert.ok(credentials.cookies.some((cookie) => cookie.name === "oauth.access.token"));
    assert.equal(credentials.expires_at, new Date(expires * 1000).toISOString());
    assert.equal(Object.hasOwn(credentials, "password"), false);
    assert.equal(Object.hasOwn(credentials, "username"), false);
  });
});

test("Immowelt refreshes the stored cookie token and saves the rotated session", async () => {
  const now = Math.floor(Date.now() / 1000);
  const old = await encryptProviderCredentials(credentialEnv, {
    userAgent: "Immowelt test agent",
    expires_at: new Date((now - 1) * 1000).toISOString(),
    cookies: [
      { name: "oauth.access.token", value: "old-token", domain: ".immowelt.de", path: "/", expires: now + 3600, secure: true },
      { name: "oauth.access.expiration", value: String(now - 1), domain: ".immowelt.de", path: "/", expires: now + 3600, secure: true },
    ],
  }, "operator-id", "immowelt");
  const connection = { ...old, participant_id: "operator-id" };
  const redirect = (location, cookie) => {
    const headers = new Headers({ location });
    if (cookie) headers.append("set-cookie", cookie);
    return new Response(null, { status: 302, headers });
  };
  const expiry = now + 3600, calls = [];
  const stub = async (input, init = {}) => {
    const url = String(input); calls.push({ url, init });
    if (url === "https://signin.immowelt.de/refresh")
      return redirect("https://www.immowelt.de/step", "oauth.access.token=new-token; Domain=.immowelt.de; Path=/; HttpOnly; Secure; Max-Age=3600");
    if (url === "https://www.immowelt.de/step")
      return redirect("https://www.immowelt.de/account", "oauth.access.expiration=" + expiry + "; Domain=.immowelt.de; Path=/; Secure; Max-Age=3600");
    if (url === "https://www.immowelt.de/account") return new Response("ok");
    throw new Error("unexpected endpoint " + url);
  };
  await withFetch(stub, async () => {
    const sql = async () => [];
    const refreshed = await refreshImmoweltSession(sql, credentialEnv, connection, true);
    assert.equal(refreshed.cookies.find((cookie) => cookie.name === "oauth.access.token").value, "new-token");
    assert.equal(refreshed.expires_at, new Date(expiry * 1000).toISOString());
    assert.equal(calls[0].url, "https://signin.immowelt.de/refresh");
    assert.match(calls[0].init.headers.get("cookie"), /oauth\.access\.token=old-token/);
  });
});
