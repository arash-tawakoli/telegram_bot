import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { createD1Client } from "../src/d1-database.js";
import { migrateMenuButtons } from "../src/telegram-menu.js";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  const schema = new URL("../schema/d1/", import.meta.url);
  for (const file of readdirSync(schema).filter((x) => x.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file, schema), "utf8"));
  const prepare = (query) => {
    const make = (values) => ({
      all: async () => /^\s*(SELECT|WITH)/i.test(query)
        ? { results: sqlite.prepare(query).all(...values) }
        : { results: [], meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } },
      run: async () => ({ meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } }),
      first: async () => sqlite.prepare(query).get(...values) ?? null,
    });
    return { bind: (...v) => make(v), ...make([]) };
  };
  return { sqlite, sql: createD1Client({ prepare, batch: async (s) => Promise.all(s.map((x) => x.all())) }) };
}

test("menu buttons are migrated once: default plus every known chat", async () => {
  const { sqlite, sql } = database();
  sqlite.exec("INSERT INTO participants(id,first_name,last_name,telegram_user_id) VALUES('a','A','A',111),('b','B','B',222),('c','C','C',NULL)");
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); };
  const first = await migrateMenuButtons(sql, { TELEGRAM_BOT_TOKEN: "t" }, fetchImpl);
  assert.deepEqual(first, { chats: 2, updated: 2 });
  assert.deepEqual(calls[0], { menu_button: { type: "commands" } });
  assert.deepEqual(calls.slice(1).map((c) => c.chat_id).sort(), [111, 222]);
  const second = await migrateMenuButtons(sql, { TELEGRAM_BOT_TOKEN: "t" }, fetchImpl);
  assert.deepEqual(second, { skipped: "done" });
  assert.equal(calls.length, 3);
});

test("no token means nothing is called", async () => {
  const { sql } = database();
  assert.deepEqual(await migrateMenuButtons(sql, {}, async () => { throw new Error("must not call"); }), { skipped: "no_token" });
});
