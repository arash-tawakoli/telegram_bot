import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { handleCoach } from "../src/coach-api.js";
import { createD1Client } from "../src/d1-database.js";
import { sha256 } from "../src/auth.js";

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  const schema = new URL("../schema/d1/", import.meta.url);
  for (const file of readdirSync(schema).filter((x) => x.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file, schema), "utf8"));
  let queries = 0;
  const prepare = (query) => {
    const make = (values) => ({
      all: async () => {
        queries++;
        const st = sqlite.prepare(query);
        if (/^\s*(SELECT|WITH)/i.test(query)) return { results: st.all(...values), meta: { changes: 0 } };
        return { results: [], meta: { changes: Number(st.run(...values).changes) } };
      },
      run: async () => { queries++; return { meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } }; },
      first: async () => { queries++; return sqlite.prepare(query).get(...values) ?? null; },
    });
    return { bind: (...v) => make(v), ...make([]) };
  };
  const db = { prepare, batch: async (s) => Promise.all(s.map((x) => x.all())) };
  return { sqlite, sql: createD1Client(db), db, count: () => queries, reset: () => { queries = 0; } };
}

async function req(sqlite, role, body, tokenOverride) {
  sqlite.prepare("INSERT OR IGNORE INTO portal_members(id,email,display_name,role,password_hash) VALUES(?,?,?,?,?)").run(role, `${role}@example.test`, role, role, "x");
  const access = `access-${role}`;
  sqlite.prepare("INSERT OR IGNORE INTO portal_sessions(id,member_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES(?,?,?,?,?,?)")
    .run(`s-${role}`, role, await sha256(access), await sha256(`r-${role}`), new Date(Date.now() + 3_600_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
  return new Request("https://runtime.test/edge/coach", { method: "POST", headers: { authorization: `Bearer ${tokenOverride ?? access}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}

const PID = "11111111-1111-4111-8111-111111111111";

test("auto_apply_status: own coach reads in two waves, foreign coach and bad token are rejected", async () => {
  const { sqlite, sql, count, reset } = setup();
  sqlite.prepare("INSERT INTO participants(id,first_name,last_name,status,auto_apply_enabled) VALUES(?,?,?, 'active',1)").run(PID, "A", "B");
  sqlite.exec(`INSERT INTO application_preferences(participant_id,immowelt_enabled) VALUES('${PID}',1)`);
  sqlite.exec("INSERT INTO portal_members(id,email,display_name,role,password_hash) VALUES('owner','o@x.test','o','coach','x'),('other','p@x.test','p','coach','x')");
  sqlite.exec(`INSERT INTO participant_assignments(participant_id,member_id) VALUES('${PID}','owner')`);
  const body = { action: "auto_apply_status", participantId: PID };
  const deferred = [];
  const ctx = { waitUntil: (p) => deferred.push(p) };

  reset();
  const ok = await handleCoach(sql, await req(sqlite, "owner", body), {}, ctx);
  assert.deepEqual(ok.sources, { immoscout: false, immowelt: true, immomio: false });
  assert.equal(ok.activeCount, 1);
  // session lookup + one combined read wave (access check and data run in parallel); last_seen write is deferred.
  assert.equal(count(), 1 + 2 + 1);
  await Promise.all(deferred);

  await assert.rejects(handleCoach(sql, await req(sqlite, "other", body), {}, ctx), /participant_forbidden/);
  await assert.rejects(handleCoach(sql, await req(sqlite, "owner", body, "not-a-token"), {}, ctx), /unauthorized/);
  await assert.rejects(handleCoach(sql, await req(sqlite, "owner", body, ""), {}, ctx), /unauthorized/);
});
