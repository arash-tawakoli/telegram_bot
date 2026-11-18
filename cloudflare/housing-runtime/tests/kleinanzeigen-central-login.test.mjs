import test from "node:test";
import assert from "node:assert/strict";
import { handleProviderFacade, issueProviderAuthFlow } from "../src/provider-facade.js";
import { getCentralProviderCredentials } from "../src/central-provider-credentials.js";

const TICKET = "ka-central-test-123456789012345678901234";

function mockSql() {
  let writes = 0;
  const sql = async (parts) => {
    const query = parts.join(" ");
    if (query.includes("FROM provider_auth_flows")) return [{
      id: "previous-flow", participant_id: "operator", provider: "kleinanzeigen",
      state: TICKET, context: { central_account: true },
      expires_at: new Date(Date.now() + 60000).toISOString(),
    }];
    if (query.includes("FROM participants")) return [{
      id: "operator", status: "active", telegram_user_id: 8538226539,
    }];
    return [];
  };
  sql.unsafe = async () => { writes++; return { count: 1 }; };
  return { sql, get writes() { return writes; } };
}

function request(action, extra = {}) {
  return new Request("https://housing-runtime.test/edge/provider/facade", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ticket: TICKET, ...extra }),
  });
}

test("Kleinanzeigen OAuth issuance fails closed, before touching the token vault", async () => {
  const store = mockSql();
  await assert.rejects(
    () => issueProviderAuthFlow(store.sql, "operator", "kleinanzeigen", "telegram", "telegram",
      { central_account: true }),
    /provider_unsupported/,
  );
  assert.equal(store.writes, 0);
});

test("old Kleinanzeigen tickets cannot resolve, start OAuth, or write tokens", async () => {
  const store = mockSql();
  for (const [action, extra] of [
    ["resolve", {}],
    ["provider_web", {}],
    ["complete_web", { callbackUrl: "https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback?code=fake&state=" + TICKET }],
  ]) {
    const response = await handleProviderFacade(store.sql, request(action, extra), {});
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "provider_unsupported");
  }
  assert.equal(store.writes, 0);
});

test("central credentials never attempt the unverified Kleinanzeigen refresh endpoint", async () => {
  const store = mockSql();
  await assert.rejects(
    () => getCentralProviderCredentials(store.sql, {}, "kleinanzeigen"),
    /provider_not_allowlisted/,
  );
  assert.equal(store.writes, 0);
});
