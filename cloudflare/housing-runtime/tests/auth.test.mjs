import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/auth.js";
import { handleAuth } from "../src/index.js";

test("password hashes verify without storing the plaintext", async () => {
  const encoded = await hashPassword("correct horse battery staple");
  assert.match(encoded, /^pbkdf2_sha256\$/);
  assert.equal(await verifyPassword("correct horse battery staple", encoded), true);
  assert.equal(await verifyPassword("wrong password", encoded), false);
});

test("password hashing enforces the portal minimum", async () => {
  await assert.rejects(() => hashPassword("short"), /password_invalid/);
});

test("migration-required marker is never accepted as a password hash", async () => {
  assert.equal(await verifyPassword("correct horse battery staple", "migration_required$00000000-0000-4000-8000-000000000000"), false);
});


function fakeAuthSql(member) {
  const calls = [];
  const sql = async (parts, ...values) => {
    const query = parts.join("?").replace(/\s+/g, " ");
    calls.push({ query, values });
    if (query.includes("SELECT id, password_hash FROM housing.portal_members")) {
      return [{ id: member.id, password_hash: member.password_hash }];
    }
    if (query.includes("UPDATE housing.portal_members SET password_hash")) {
      if (member.password_hash !== values[2]) return [];
      member.password_hash = values[0];
      return [{ id: member.id }];
    }
    if (query.includes("SELECT password_hash FROM housing.portal_members")) {
      return [{ password_hash: member.password_hash }];
    }
    return [];
  };
  return { sql, calls };
}

function loginRequest(password) {
  return new Request("https://housing-runtime.test/edge/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "login", email: "arash@nexalabs.de", password }),
  });
}

test("legacy Supabase password migrates once into the Cloudflare D1 password hash", async () => {
  const originalFetch = globalThis.fetch;
  const member = {
    id: "member-super-admin",
    password_hash: "migration_required$9faed0f4-9e88-4d4b-8a7d-000000000000",
  };
  const { sql, calls } = fakeAuthSql(member);
  const password = "correct horse battery staple";
  let requestCount = 0;
  try {
    globalThis.fetch = async (url, init) => {
      requestCount += 1;
      assert.equal(String(url), "https://dpmohkrwdlicexwcrqfy.supabase.co/auth/v1/token?grant_type=password");
      assert.equal(init.method, "POST");
      assert.equal(init.headers.apikey, "sb_publishable_test-key");
      assert.deepEqual(JSON.parse(init.body), { email: "arash@nexalabs.de", password });
      return new Response(JSON.stringify({ access_token: "discarded", refresh_token: "discarded" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const response = await handleAuth(sql, loginRequest(password), {
      SUPABASE_URL: "https://dpmohkrwdlicexwcrqfy.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-key",
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(typeof data.access_token, "string");
    assert.equal(typeof data.refresh_token, "string");
    assert.equal(requestCount, 1);
    assert.match(member.password_hash, /^pbkdf2_sha256\$/);
    assert.equal(await verifyPassword(password, member.password_hash), true);
    assert.ok(calls.some(call => call.query.includes("UPDATE housing.portal_members SET password_hash")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy password migration rejects invalid Supabase credentials without changing D1", async () => {
  const originalFetch = globalThis.fetch;
  const marker = "migration_required$9faed0f4-9e88-4d4b-8a7d-000000000000";
  const member = { id: "member-super-admin", password_hash: marker };
  const { sql, calls } = fakeAuthSql(member);
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "invalid_credentials" }), { status: 400 });
    const response = await handleAuth(sql, loginRequest("incorrect password"), {
      SUPABASE_URL: "https://dpmohkrwdlicexwcrqfy.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-key",
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "invalid_credentials" });
    assert.equal(member.password_hash, marker);
    assert.equal(calls.some(call => call.query.includes("UPDATE housing.portal_members SET password_hash")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("migrated D1 passwords no longer call Supabase Auth", async () => {
  const originalFetch = globalThis.fetch;
  const password = "correct horse battery staple";
  const member = { id: "member-super-admin", password_hash: await hashPassword(password) };
  const { sql } = fakeAuthSql(member);
  try {
    globalThis.fetch = async () => { throw new Error("Supabase must not be called after migration"); };
    const response = await handleAuth(sql, loginRequest(password), {});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy password migration preserves the marker when Supabase is rate limited", async () => {
  const originalFetch = globalThis.fetch;
  const marker = "migration_required$9faed0f4-9e88-4d4b-8a7d-000000000000";
  const member = { id: "member-super-admin", password_hash: marker };
  const { sql } = fakeAuthSql(member);
  try {
    globalThis.fetch = async () => new Response("{}", { status: 429 });
    const response = await handleAuth(sql, loginRequest("correct horse battery staple"), {
      SUPABASE_URL: "https://dpmohkrwdlicexwcrqfy.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-key",
    });
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: "rate_limited" });
    assert.equal(member.password_hash, marker);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy passwords shorter than the D1 minimum require recovery instead of a failed hash migration", async () => {
  const originalFetch = globalThis.fetch;
  const marker = "migration_required$9faed0f4-9e88-4d4b-8a7d-000000000000";
  const member = { id: "member-super-admin", password_hash: marker };
  const { sql } = fakeAuthSql(member);
  try {
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    const response = await handleAuth(sql, loginRequest("short-pass"), {
      SUPABASE_URL: "https://dpmohkrwdlicexwcrqfy.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-key",
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "password_migration_required" });
    assert.equal(member.password_hash, marker);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("recovery access token updates the Cloudflare portal password hash and revokes existing sessions", async () => {
  const originalFetch = globalThis.fetch;
  const member = {
    id: "member-super-admin",
    password_hash: "migration_required$legacy-marker",
  };
  const calls = [];
  let sessionsRevoked = false;
  const sql = async (parts, ...values) => {
    const query = parts.join("?").replace(/\\s+/g, " ");
    calls.push({ query, values });
    if (query.includes("SELECT id FROM housing.portal_members WHERE lower(email)")) {
      return [{ id: member.id }];
    }
    if (query.includes("UPDATE housing.portal_members SET password_hash")) {
      member.password_hash = values[0];
      return [{ id: member.id }];
    }
    if (query.includes("UPDATE housing.portal_sessions SET revoked_at")) {
      sessionsRevoked = true;
      return [];
    }
    return [];
  };
  const password = "new temporary password 123";
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://dpmohkrwdlicexwcrqfy.supabase.co/auth/v1/user");
      assert.equal(init.method, "GET");
      assert.equal(init.headers.apikey, "sb_publishable_test-key");
      assert.equal(init.headers.Authorization, "Bearer recovery-access-token");
      return new Response(JSON.stringify({ id: "auth-user", email: "arash@nexalabs.de" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const response = await handleAuth(sql, new Request("https://housing-runtime.test/edge/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "password_reset_complete", access_token: "recovery-access-token", password }),
    }), {
      SUPABASE_URL: "https://dpmohkrwdlicexwcrqfy.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-key",
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.match(member.password_hash, /^pbkdf2_sha256\\$/);
    assert.equal(await verifyPassword(password, member.password_hash), true);
    assert.equal(sessionsRevoked, true);
    assert.ok(calls.some(call => call.query.includes("UPDATE housing.portal_members SET password_hash")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("expired recovery access tokens cannot change the portal password", async () => {
  const originalFetch = globalThis.fetch;
  const member = { id: "member-super-admin", password_hash: "migration_required$legacy-marker" };
  const calls = [];
  const sql = async (parts, ...values) => {
    calls.push({ query: parts.join("?").replace(/\\s+/g, " "), values });
    return [];
  };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ msg: "invalid JWT" }), { status: 401 });
    const response = await handleAuth(sql, new Request("https://housing-runtime.test/edge/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "password_reset_complete", access_token: "expired-token", password: "new temporary password 123" }),
    }), {
      SUPABASE_URL: "https://dpmohkrwdlicexwcrqfy.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-key",
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "recovery_expired" });
    assert.equal(member.password_hash, "migration_required$legacy-marker");
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
