import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { createTelegramLink, redeemTelegramLink } from "../src/telegram-link.js";
import { handleCoach } from "../src/coach-api.js";
import { sha256 } from "../src/auth.js";

function d1() {
  const sqlite = new DatabaseSync(":memory:");
  const schema = new URL("../schema/d1/", import.meta.url);
  for (const file of readdirSync(schema).filter((x) => x.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file, schema), "utf8"));
  // Created by the Coach Portal's own migrations in production.
  sqlite.exec(`CREATE TABLE coach_participants (participant_id TEXT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE, coach_member_id TEXT);
    CREATE TABLE coach_audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_member_id TEXT, participant_id TEXT REFERENCES participants(id) ON DELETE SET NULL, action TEXT NOT NULL, changes TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  const prepare = (query) => {
    const make = (values) => ({
      all: async () => {
        const statement = sqlite.prepare(query);
        if (/^\s*(SELECT|WITH)/i.test(query) || /\bRETURNING\b/i.test(query)) return { results: statement.all(...values), meta: { changes: 0 } };
        return { results: [], meta: { changes: Number(statement.run(...values).changes) } };
      },
      run: async () => ({ meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } }),
      first: async () => sqlite.prepare(query).get(...values) ?? null,
    });
    return { bind: (...values) => make(values), ...make([]) };
  };
  return { sqlite, db: { prepare, batch: async (statements) => { const out = []; for (const s of statements) out.push(await s.all()); return out; } } };
}

const person = (sqlite, id, telegramId = null, origin = "portal") =>
  sqlite.prepare("INSERT INTO participants(id,first_name,last_name,telegram_user_id,telegram_chat_id,origin) VALUES(?,?,?,?,?,?)")
    .run(id, "Test", "Person", telegramId, telegramId, origin);

const tokenOf = (url) => url.split("start=link_")[1];

test("a coach link moves a brand-new Telegram account onto the portal participant, once", async () => {
  const { sqlite, db } = d1();
  person(sqlite, "coached");
  person(sqlite, "auto", 555, "telegram");
  const { url } = await createTelegramLink(db, "coached", "m1");
  assert.match(url, /^https:\/\/t\.me\/traumwohnunghamburgbot\?start=link_[A-Za-z0-9_-]{43}$/);
  const user = { id: "auto", telegram_user_id: 555, telegram_chat_id: 555, username: "neu", __is_new_user: true };
  assert.deepEqual(await redeemTelegramLink(db, user, tokenOf(url)), { participantId: "coached" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM participants WHERE id='auto'").get().n, 0);
  const linked = sqlite.prepare("SELECT telegram_user_id, username FROM participants WHERE id='coached'").get();
  assert.equal(linked.telegram_user_id, 555);
  assert.equal(linked.username, "neu");
  person(sqlite, "auto2", 777, "telegram");
  assert.deepEqual(await redeemTelegramLink(db, { ...user, id: "auto2", telegram_user_id: 777 }, tokenOf(url)), { error: "expired" });
  await assert.rejects(createTelegramLink(db, "coached", "m1"), /invalid_participant/);
});

test("an existing Telegram account is never merged, and expired links are refused", async () => {
  const { sqlite, db } = d1();
  person(sqlite, "coached");
  person(sqlite, "existing", 556, "telegram");
  const { url } = await createTelegramLink(db, "coached", "m1");
  const existing = { id: "existing", telegram_user_id: 556, telegram_chat_id: 556, __is_new_user: false };
  assert.deepEqual(await redeemTelegramLink(db, existing, tokenOf(url)), { error: "account_in_use" });
  assert.equal(sqlite.prepare("SELECT telegram_user_id t FROM participants WHERE id='coached'").get().t, null);
  const old = await createTelegramLink(db, "coached", "m1", Date.now() - 21 * 60_000);
  assert.deepEqual(await redeemTelegramLink(db, { ...existing, __is_new_user: true }, tokenOf(old.url)), { error: "expired" });
  assert.deepEqual(await redeemTelegramLink(db, existing, "not-a-token"), { error: "invalid" });
});

async function coachRequest(sqlite, role, body) {
  sqlite.prepare("INSERT OR IGNORE INTO portal_members(id,email,display_name,role,password_hash) VALUES(?,?,?,?,?)").run(role, `${role}@example.test`, role, role, "x");
  const access = `access-${role}`;
  sqlite.prepare("INSERT OR IGNORE INTO portal_sessions(id,member_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES(?,?,?,?,?,?)")
    .run(`s-${role}`, role, await sha256(access), await sha256(`r-${role}`), new Date(Date.now() + 3_600_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
  return new Request("https://runtime.test/edge/coach", { method: "POST", headers: { authorization: `Bearer ${access}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}

test("delete_participant is admin-only, needs confirmation, and deletes the participant", async () => {
  const { sqlite, db } = d1();
  const { createD1Client } = await import("../src/d1-database.js");
  const sql = createD1Client(db);
  const env = { HOUSING_DB: db };
  person(sqlite, "gone");
  await assert.rejects(handleCoach(sql, await coachRequest(sqlite, "coach", { action: "delete_participant", participantId: "gone", confirmDelete: true }), env), /admin_required/);
  await assert.rejects(handleCoach(sql, await coachRequest(sqlite, "admin", { action: "delete_participant", participantId: "gone" }), env), /deletion_confirmation_required/);
  const result = await handleCoach(sql, await coachRequest(sqlite, "admin", { action: "delete_participant", participantId: "gone", confirmDelete: true }), env);
  assert.deepEqual(result, { ok: true, mode: "deleted_permanently" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM participants WHERE id='gone'").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM coach_audit_events WHERE action='delete_participant'").get().n, 1);
});

test("telegram_link checks the coach assignment", async () => {
  const { sqlite, db } = d1();
  const { createD1Client } = await import("../src/d1-database.js");
  const sql = createD1Client(db);
  person(sqlite, "theirs");
  await assert.rejects(handleCoach(sql, await coachRequest(sqlite, "coach", { action: "telegram_link", participantId: "theirs" }), { HOUSING_DB: db }), /participant_forbidden/);
  sqlite.exec("INSERT INTO coach_participants(participant_id,coach_member_id) VALUES('theirs','coach')");
  const { url } = await handleCoach(sql, await coachRequest(sqlite, "coach", { action: "telegram_link", participantId: "theirs" }), { HOUSING_DB: db });
  assert.match(url, /start=link_/);
});
