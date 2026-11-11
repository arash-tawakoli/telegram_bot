import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createD1Supabase } from "../cloudflare/housing-runtime/src/telegram-legacy/d1-supabase.js";

function fakeD1({ rows = [], savedId = "existing-profile-slot-2" } = {}) {
  const calls = [];
  const db = {
    prepare(query) {
      return {
        query,
        bind(...params) {
          return {
            query,
            params,
            all: async () => {
              calls.push({ query, params });
              if (query.includes("SELECT id FROM search_profiles")) return { results: [{ id: savedId }], meta: { changes: 0 } };
              if (query.startsWith("SELECT")) return { results: rows, meta: { changes: 0 } };
              return { results: [], meta: { changes: 1 } };
            },
          };
        },
        all: async () => {
          calls.push({ query, params: [] });
          return { results: rows, meta: { changes: 0 } };
        },
      };
    },
    batch: async statements => {
      const batch = statements.map(statement => ({ query: statement.query, params: statement.params || [] }));
      calls.push({ batch });
      return batch.map(() => ({ results: [], meta: { changes: 1 } }));
    },
  };
  return { db, calls };
}

test("D1 search-profile reads filter and order by the physical profile_slot column", async () => {
  const { db, calls } = fakeD1({
    rows: [{
      id: "profile-2",
      participant_id: "user-1",
      profile_slot: 2,
      criteria: JSON.stringify({ profile_slot: 1, name: "Zweite Suche", property_types: ["Wohnung"] }),
      active: 1,
    }],
  });
  const adapter = createD1Supabase(db, {});
  const result = await adapter.from("search_profiles").select("*")
    .eq("user_id", "user-1").eq("profile_slot", 2).order("profile_slot").maybeSingle();

  assert.equal(result.error, null);
  assert.equal(result.data.profile_slot, 2, "the physical column must override stale JSON");
  assert.equal(result.data.name, "Zweite Suche");
  assert.match(calls[0].query, /participant_id = \? AND profile_slot = \? ORDER BY profile_slot ASC/);
  assert.deepEqual(calls[0].params, ["user-1", 2]);
});

test("D1 search-profile saves upsert by participant and slot and replace source links atomically", async () => {
  const { db, calls } = fakeD1();
  const adapter = createD1Supabase(db, {});
  for (const slot of [1, 2, 3]) {
    const result = await adapter.rpc("save_search_profile_ui", {
      p_user: "user-1",
      p_values: { profile_slot: slot, name: `Suche ${slot}`, source_ids: [1, 3, 999], property_types: ["Wohnung"] },
    });
    assert.equal(result.error, null);
    assert.equal(result.data.id, "existing-profile-slot-2");
    assert.equal(result.data.profile_slot, slot);
  }

  const batches = calls.filter(call => call.batch).map(call => call.batch);
  assert.equal(batches.length, 3);
  for (const batch of batches) {
    assert.equal(batch[0].params[1], "user-1");
    assert.match(batch[0].query, /ON CONFLICT\(participant_id,profile_slot\) DO UPDATE/);
    const criteria = JSON.parse(batch[0].params[3]);
    assert.equal(criteria.profile_slot, undefined);
    assert.match(batch[1].query, /DELETE FROM source_links/);
    assert.equal(batch.length, 6, "profile, source links and referral reward are saved together");
    assert.deepEqual(batch.slice(2, 4).map(statement => statement.params[0]), [1, 3]);
    assert.match(batch[4].query, /UPDATE participants SET referral_bonus_until/);
    assert.match(batch[5].query, /UPDATE referrals SET status='rewarded'/);
  }
  assert.deepEqual(batches.map(batch => batch[0].params[2]), [1, 2, 3]);
});

test("D1 search-profile saves reject invalid slots without touching data", async () => {
  const { db, calls } = fakeD1();
  const adapter = createD1Supabase(db, {});
  const result = await adapter.rpc("save_search_profile_ui", {
    p_user: "user-1",
    p_values: { profile_slot: 5, name: "Ungültig" },
  });
  assert.match(result.error.message, /profile_slot_invalid/);
  assert.equal(calls.length, 0);
});

test("D1 generic search-profile inserts persist profile_slot outside criteria", async () => {
  const { db, calls } = fakeD1();
  const adapter = createD1Supabase(db, {});
  await adapter.from("search_profiles").insert({ user_id: "user-1", profile_slot: 4, name: "Vierte Suche", property_types: ["WG"] });
  const insert = calls.find(call => call.query?.startsWith("INSERT INTO search_profiles"));
  assert.ok(insert);
  assert.match(insert.query, /profile_slot/);
  const columns = insert.query.match(/\(([^)]+)\) VALUES/)[1].split(",");
  assert.ok(insert.params[columns.indexOf("id")]);
  const criteria = JSON.parse(insert.params[columns.indexOf("criteria")]);
  assert.equal(criteria.profile_slot, undefined);
  assert.equal(insert.params[columns.indexOf("profile_slot")], 4);
});

test("D1 profile-slot migration backfills JSON values and never recreates or deletes search profiles", () => {
  const migration = readFileSync(new URL("../cloudflare/housing-runtime/schema/d1/0002_search_profile_slot.sql", import.meta.url), "utf8");
  assert.match(migration, /ALTER TABLE search_profiles[\s\S]*ADD COLUMN profile_slot INTEGER NOT NULL DEFAULT 1/);
  assert.match(migration, /json_extract\(criteria, '\$\.profile_slot'\)/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS search_profiles_participant_slot_unique/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM search_profiles|CREATE TABLE[^;]*search_profiles/i);
});
