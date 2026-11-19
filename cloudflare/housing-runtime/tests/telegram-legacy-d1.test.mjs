import test from "node:test";
import assert from "node:assert/strict";
import { createD1Supabase } from "../src/telegram-legacy/d1-supabase.js";

function fakeD1(rows) {
  return {
    prepare(query) {
      return {
        bind(...params) { return { all: async () => ({ results: rows(query, params), meta: { changes: 0 } }) }; },
        all: async () => ({ results: rows(query, []), meta: { changes: 0 } }),
      };
    },
  };
}

test("legacy Telegram adapter maps participant rows to the old bot user shape", async () => {
  const db = createD1Supabase(fakeD1(() => [{ id: "u1", telegram_chat_id: 7, telegram_user_id: 7, status: "active", telegram_state: "{}" }]), {});
  const result = await db.from("bot_users").select("*").eq("id", "u1").maybeSingle();
  assert.equal(result.error, null);
  assert.equal(result.data.chat_id, 7);
  assert.equal(result.data.is_active, true);
  assert.equal(result.data.user_id, "u1");
});

test("legacy Telegram adapter returns empty optional legacy tables without Supabase", async () => {
  const db = createD1Supabase(fakeD1(() => []), {});
  const result = await db.from("referrals").select("id").eq("user_id", "u1");
  assert.deepEqual(result.data, []);
  assert.equal(result.error, null);
});

test("legacy applicant document storage uses the bound R2 bucket and fails closed", async () => {
  const objects = new Map();
  const writes = [];
  const r2 = {
    head: async key => objects.has(key) ? { key } : null,
    put: async (key, body, options) => { objects.set(key, { body: [...body], options }); writes.push(key); },
    delete: async keys => { for (const key of keys) objects.delete(key); },
  };
  const storage = createD1Supabase(fakeD1(() => []), { DOCUMENTS: r2 }).storage.from("applicant-documents");
  const bytes = new Uint8Array([1, 2, 3]);
  const saved = await storage.upload("participant-1/document.pdf", bytes, { contentType: "application/pdf", cacheControl: "3600" });
  assert.deepEqual(saved, { data: { path: "participant-1/document.pdf" }, error: null });
  assert.deepEqual(objects.get("participant-1/document.pdf"), {
    body: [1, 2, 3], options: { httpMetadata: { contentType: "application/pdf", cacheControl: "max-age=3600" } },
  });
  assert.match((await storage.upload("participant-1/document.pdf", bytes)).error.message, /object_already_exists/);
  assert.match((await storage.remove(["../other.pdf"])).error.message, /invalid_storage_path/);
  assert.deepEqual((await storage.remove(["participant-1/document.pdf"])).data, [{ name: "participant-1/document.pdf" }]);
  assert.equal(objects.size, 0);
  assert.equal(writes.length, 1);

  const unavailable = createD1Supabase(fakeD1(() => []), {}).storage.from("applicant-documents");
  assert.match((await unavailable.upload("participant-1/document.pdf", bytes)).error.message, /document_storage_unavailable/);
  assert.match((await createD1Supabase(fakeD1(() => []), { DOCUMENTS: r2 }).storage.from("other").remove([])).error.message, /document_storage_unavailable/);
});
test("legacy Telegram admin queries can read persisted username and profile flags", async () => {
  const row = {
    id: "u-admin",
    telegram_user_id: 7,
    telegram_chat_id: 7,
    first_name: "Admin",
    last_name: "User",
    username: "admin_handle",
    status: "active",
    plan_override: "premium",
    plan_override_expires_at: "2026-12-01T00:00:00.000Z",
    referral_bonus_until: null,
    auto_apply_enabled: 1,
    test_auto_apply_allowed: 1,
    test_auto_apply_enabled: 1,
    test_auto_apply_daily_limit: 3,
    test_auto_apply_enabled_at: "2026-11-01T00:00:00.000Z",
    test_auto_apply_disabled_at: null,
    created_at: "2026-11-01T00:00:00.000Z",
  };
  const queries = [];
  const db = createD1Supabase({
    prepare(query) {
      return {
        bind(...params) {
          return { all: async () => { queries.push({ query, params }); return { results: [row], meta: { changes: 0 } }; } };
        },
        all: async () => { queries.push({ query, params: [] }); return { results: [row], meta: { changes: 0 } }; },
      };
    },
  }, {});
  const result = await db.from("bot_users")
    .select("id,telegram_user_id,first_name,last_name,username,is_active,plan_override,plan_override_expires_at,referral_bonus_until,created_at")
    .order("created_at")
    .maybeSingle();
  assert.equal(result.error, null);
  assert.equal(result.data.username, "admin_handle");
  assert.equal(result.data.is_active, true);
  assert.equal(result.data.plan_override, "premium");
  assert.equal(result.data.plan_override_expires_at, "2026-12-01T00:00:00.000Z");
  assert.equal(result.data.auto_apply_enabled, true);
  assert.equal(result.data.test_auto_apply_allowed, true);
  assert.equal(result.data.test_auto_apply_daily_limit, 3);
  assert.match(queries[0].query, /username/);
  assert.match(queries[0].query, /plan_override/);
});

test("prepare_telegram_update stores Telegram username and updates existing participant metadata", async () => {
  const queries = [];
  const db = createD1Supabase({
    prepare(query) {
      return {
        bind(...params) {
          return { all: async () => {
            queries.push({ query, params });
            if (query.startsWith("SELECT * FROM participants WHERE telegram_user_id")) {
              return { results: [{ id: "u-existing", telegram_user_id: 7, telegram_chat_id: 7, first_name: "Old", last_name: "Name", status: "active", telegram_state: "{}" }], meta: { changes: 0 } };
            }
            if (query.startsWith("SELECT * FROM participants WHERE id")) {
              return { results: [{ id: "u-existing", telegram_user_id: 7, telegram_chat_id: 77, username: "new_handle", first_name: "New", last_name: "Name", ui_language: "de", status: "active", telegram_state: "{}" }], meta: { changes: 0 } };
            }
            if (query.startsWith("SELECT id,participant_id AS user_id,provider,stripe_customer_id")) {
              return { results: [{ id: "sub-1", user_id: "u-existing", provider: "stripe", status: "active", current_period_end: "2099-01-01T00:00:00.000Z", cancel_at_period_end: 0 }], meta: { changes: 0 } };
            }
            return { results: [], meta: { changes: 1 } };
          } };
        },
        all: async () => ({ results: [], meta: { changes: 0 } }),
      };
    },
  }, {});
  const result = await db.rpc("prepare_telegram_update", {
    p_payload: { update_id: 10, message: { from: { id: 7, username: "new_handle", first_name: "New", last_name: "Name", language_code: "de" }, chat: { id: 77 } } },
  });
  assert.equal(result.error, null);
  const update = queries.find(call => call.query.startsWith("UPDATE participants SET telegram_chat_id"));
  assert.ok(update);
  assert.match(update.query, /username=\?/);
  assert.equal(update.params[1], "new_handle");
  assert.equal(result.data.user.username, "new_handle");
  assert.equal(result.data.user.chat_id, 77);
  assert.equal(result.data.subscription?.id, "sub-1");
  assert.equal(result.data.subscription?.status, "active");
});

test("D1 participant metadata migration is additive and preserves existing participant rows", async () => {
  const { readFileSync } = await import("node:fs");
  const migration = readFileSync(new URL("../schema/d1/0003_telegram_user_metadata.sql", import.meta.url), "utf8");
  for (const column of ["username", "origin", "plan_override", "plan_override_expires_at", "referral_bonus_until", "auto_apply_enabled", "test_auto_apply_allowed", "test_auto_apply_enabled", "test_auto_apply_daily_limit", "test_auto_apply_enabled_at", "test_auto_apply_disabled_at"]) {
    assert.match(migration, new RegExp("ADD COLUMN " + column));
  }
  assert.match(migration, /UPDATE participants SET origin='telegram'/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM participants|CREATE TABLE[^;]*participants/i);
});

test("applicant profile upsert stores JSON in the physical D1 schema", async () => {
  let captured = null;
  const db = createD1Supabase({
    prepare(query) {
      return {
        bind(...params) {
          return { all: async () => { captured = { query, params }; return { results: [], meta: { changes: 1 } }; } };
        },
        all: async () => ({ results: [], meta: { changes: 0 } }),
      };
    },
  }, {});
  const result = await db.from("applicant_profiles").upsert({
    user_id: "participant-1",
    first_name: "",
    last_name: "",
    updated_at: "2026-11-09T21:00:00.000Z",
  }, { onConflict: "user_id" });
  assert.equal(result.error, null);
  assert.equal(result.count, 1);
  assert.equal(captured.query, "INSERT INTO applicant_profiles (participant_id,profile,updated_at) VALUES (?,?,?) ON CONFLICT(participant_id) DO UPDATE SET profile=excluded.profile,updated_at=excluded.updated_at");
  assert.equal(captured.params[0], "participant-1");
  assert.deepEqual(JSON.parse(captured.params[1]), { first_name: "", last_name: "" });
  assert.equal(captured.params[2], "2026-11-09T21:00:00.000Z");
});

test("applicant profile update merges JSON fields and preserves existing data", async () => {
  const calls = [];
  const db = createD1Supabase({
    prepare(query) {
      return {
        bind(...params) {
          return { all: async () => {
            calls.push({ query, params });
            if (query.startsWith("SELECT participant_id,profile FROM applicant_profiles")) {
              return { results: [{ participant_id: "participant-1", profile: JSON.stringify({ first_name: "Alaa", last_name: "Mansour", email: "old@example.test" }) }], meta: { changes: 0 } };
            }
            return { results: [], meta: { changes: 1 } };
          } };
        },
        all: async () => ({ results: [], meta: { changes: 0 } }),
      };
    },
  }, {});
  const result = await db.from("applicant_profiles").update({ email: "new@example.test", updated_at: "2026-11-09T21:00:00.000Z" }).eq("user_id", "participant-1");
  assert.equal(result.error, null);
  assert.equal(result.count, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].query, "SELECT participant_id,profile FROM applicant_profiles WHERE participant_id = ?");
  assert.equal(calls[1].query, "UPDATE applicant_profiles SET profile=?,updated_at=? WHERE participant_id=?");
  assert.deepEqual(JSON.parse(calls[1].params[0]), { first_name: "Alaa", last_name: "Mansour", email: "new@example.test" });
  assert.equal(calls[1].params[1], "2026-11-09T21:00:00.000Z");
});

test("Kleinanzeigen sender cannot be enabled without verified transport", async () => {
  const db = createD1Supabase({prepare(){throw Error("Unexpected database write");}}, {});
  const result = await db.rpc("set_application_provider_enabled_shared", {p_user:"participant-1",p_provider:"kleinanzeigen",p_enabled:true});
  assert.match(String(result.error),/provider_transport_unverified/);
});

test("Telegram controls expose the shared Kleinanzeigen profile with verified transport gating", async () => {
  const {readFileSync}=await import("node:fs");
  const source=readFileSync(new URL("../src/telegram-legacy/platform-sessions.js",import.meta.url),"utf8");
  assert.match(source,/Kleinanzeigen · Versand noch nicht freigegeben/);
  assert.match(source,/2:\{key:'kleinanzeigen'/i);
  assert.match(source,/providerSendEnabled/);
  assert.match(source,/1:\{key:'immoscout24'/);
  assert.match(source,/3:\{key:'immomio'/);
  assert.match(source,/4:\{key:'immowelt'/);
});

test("applicant profile readiness uses the same full rules as application submission", async () => {
  const profile = {
    first_name: "Aria", last_name: "S", email: "aria@example.test", phone: "+49123456789",
    street: "Teststrasse", house_number: "1", postcode: "20095", city: "Hamburg",
  };
  const api = createD1Supabase(fakeD1(() => [{ profile: JSON.stringify(profile) }]), {});
  const result = await api.rpc("application_profile_missing_fields", { p_user: "participant-1" });
  assert.equal(result.error, null);
  for (const field of [
    "Haustiere",
    "salutation", "household_type", "employment_status", "income_range",
    "move_in_preference", "schufa_status",
  ]) assert.ok(result.data.includes(field), field);
  for(const field of ["WBS-Status","Bewerbungstext Wohnung","Bewerbungstext Haus","Bewerbungstext Auf Zeit & WG","Bewerbungstext Tauschwohnung"])
    assert.equal(result.data.includes(field),false,field);
});

test("participant active filters and writes map booleans to text status", async () => {
  const calls = [];
  const api = createD1Supabase(fakeD1((query, params) => { calls.push({ query, params }); return []; }), {});
  await api.from("bot_users").select("id").eq("is_active", true);
  await api.from("bot_users").select("id").eq("is_active", false);
  await api.from("bot_users").update({ is_active: false }).eq("id", "participant-1");
  await api.from("bot_users").update({ is_active: true }).eq("id", "participant-1");
  await api.from("bot_users").insert({ id: "participant-2", first_name: "Test", last_name: "User", is_active: 0 });

  assert.deepEqual(calls[0], { query: "SELECT id FROM participants WHERE status = ?", params: ["active"] });
  assert.deepEqual(calls[1], { query: "SELECT id FROM participants WHERE status <> ?", params: ["active"] });
  assert.deepEqual(calls[2], { query: "UPDATE participants SET status=? WHERE id = ?", params: ["archived", "participant-1"] });
  assert.deepEqual(calls[3], { query: "UPDATE participants SET status=? WHERE id = ?", params: ["active", "participant-1"] });
  const insert = calls[4];
  assert.match(insert.query, /^INSERT OR REPLACE INTO participants/);
  assert.ok(insert.params.includes("archived"));
});
