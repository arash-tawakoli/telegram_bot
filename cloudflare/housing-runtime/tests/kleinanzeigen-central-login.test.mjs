import test from "node:test";
import assert from "node:assert/strict";
import { handleProviderFacade, issueProviderAuthFlow } from "../src/provider-facade.js";
import { decryptProviderCredentials } from "../src/provider-credentials.js";

const KEY = "01".repeat(32);
const ticket = "ka-central-test-123456789012345678901234";
const env = { APPLICATION_CREDENTIAL_KEY: KEY };
const makeSql = (central = true, owner = true) => {
  const writes = [];
  const sql = async (strings) => {
    const query = strings.join(" ");
    if (query.includes("FROM provider_auth_flows")) return [{
      id: "flow-id", participant_id: "owner-id", provider: "kleinanzeigen", state: ticket,
      code_verifier: "a-pkce-code-verifier", origin: "coach", return_target: "coach",
      context: { central_account: central }, expires_at: new Date(Date.now() + 60_000).toISOString(),
    }];
    if (query.includes("FROM participants p")) return [{ account_hint: null }];
    if (query.includes("FROM participants")) return [{
      id: "owner-id", status: "active", telegram_user_id: owner ? 8538226539 : 1,
    }];
    return [];
  };
  sql.unsafe = async (query, params) => { writes.push({ query, params }); return { count: 1 }; };
  return { sql, writes };
};
const req = (action, data = {}) => new Request("https://housing-runtime.test/edge/provider/facade", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ ticket, action, ...data }),
});

test("only a central owner is allowed to start Kleinanzeigen PKCE", async () => {
  const valid = await issueProviderAuthFlow(makeSql(true, true).sql, "owner-id",
    "kleinanzeigen", "coach", "coach", { central_account: true });
  assert.match(valid.state, /^[A-Za-z0-9_-]{20,}$/);
  await assert.rejects(() => issueProviderAuthFlow(makeSql(true, false).sql, "owner-id",
    "kleinanzeigen", "coach", "coach", { central_account: true }), /participant_forbidden/);
  await assert.rejects(() => issueProviderAuthFlow(makeSql(true, true).sql, "owner-id",
    "kleinanzeigen", "coach", "coach", {}), /participant_forbidden/);
});

test("central Kleinanzeigen login is PKCE and encrypted; no passwords persisted", async () => {
  const { sql, writes } = makeSql();
  const started = await handleProviderFacade(sql, req("resolve"), env);
  assert.equal((await started.json()).mode, "provider_web");
  const urlResponse = await handleProviderFacade(sql, req("provider_web"), env);
  const auth = new URL((await urlResponse.json()).url);
  assert.equal(auth.hostname, "login.kleinanzeigen.de");
  assert.equal(auth.searchParams.get("state"), ticket);
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
  const wrong = await handleProviderFacade(sql, req("complete_web", {
    callbackUrl: "https://attacker.test/android/com.ebay.kleinanzeigen/callback?code=x&state=" + ticket,
  }), env);
  assert.equal(wrong.status, 400);
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options = {}) => {
      assert.equal(String(url), "https://login.kleinanzeigen.de/oauth/token");
      const posted = JSON.parse(options.body);
      assert.equal(posted.grant_type, "authorization_code");
      assert.equal(posted.code_verifier, "a-pkce-code-verifier");
      return Response.json({ access_token: "token-abc", refresh_token: "refresh-def", expires_in: 600 });
    };
    const callbackUrl = "https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback"
      + "?code=example-authorization-code&state=" + encodeURIComponent(ticket);
    const completed = await handleProviderFacade(sql, req("complete_web", { callbackUrl }), env);
    assert.equal(completed.status, 200);
    assert.equal((await completed.json()).authenticated, true);
    const saved = writes.find(entry => entry.query.includes("UPDATE provider_connections"));
    assert.ok(saved);
    const decrypted = await decryptProviderCredentials(env, {
      ciphertext: saved.params[0], iv: saved.params[1], key_version: saved.params[2],
    }, "owner-id", "kleinanzeigen");
    assert.equal(decrypted.access_token, "token-abc");
    assert.equal(decrypted.refresh_token, "refresh-def");
    assert.equal(decrypted.oauth_redirect_uri, "https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback");
    assert.equal(Object.hasOwn(decrypted, "password"), false);
    assert.equal(writes.filter(entry => entry.query.includes("UPDATE provider_auth_flows")).length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("noncentral Kleinanzeigen tickets cannot resolve", async () => {
  const response = await handleProviderFacade(makeSql(false).sql, req("resolve"), env);
  assert.equal((await response.json()).error, "provider_unsupported");
});
