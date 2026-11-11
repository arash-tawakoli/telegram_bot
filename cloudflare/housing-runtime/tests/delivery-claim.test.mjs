import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";

test("simultaneous D1 delivery workers claim once and render stored listing details", async () => {
  let selected = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema/d1/0001_housing_core.sql", import.meta.url), "utf8"));
  sqlite.exec("INSERT INTO participants(id,first_name,last_name,telegram_chat_id) VALUES('user','A','B',12); INSERT INTO source_registry(id,name,family,connector) VALUES(1,'Test','immoscout24','test'); INSERT INTO offer_identities(id,source_id,identity_hash,canonical_url,facts) VALUES('offer',1,'offer','https://example.com/offer','{\"title\":\"Testwohnung\",\"city\":\"Hamburg\",\"warm_rent\":950}'); INSERT INTO deliveries(id,participant_id,offer_identity_id,idempotency_key,status) VALUES('delivery','user','offer','delivery','pending')");
  const db = {
    prepare(query) {
      const make = values => ({ all: async () => {
        const statement = sqlite.prepare(query);
        const returnsRows = /^\s*(SELECT|PRAGMA)/i.test(query) || /\bRETURNING\b/i.test(query);
        const result = returnsRows ? { results: statement.all(...values) } : { results: [], meta: { changes: Number(statement.run(...values).changes) } };
        if (/SELECT d\.id, d\.participant_id/.test(query)) {
          selected++;
          if (selected === 2) release();
          await barrier;
        }
        return result;
      } });
      return { bind: (...values) => make(values), ...make([]) };
    },
  };
  const originalFetch = globalThis.fetch;
  const messages = [];
  globalThis.fetch = async (_url, options) => { messages.push(JSON.parse(options.body)); return Response.json({ ok: true, result: { message_id: 9 } }); };
  try {
    const env = { HOUSING_DB: db, DELIVERY_RUN_TOKEN: "secret", TELEGRAM_BOT_TOKEN: "fake" };
    const request = () => new Request("https://runtime.example/internal/delivery/process", { method: "POST", headers: { authorization: "Bearer secret" } });
    const responses = await Promise.all([worker.fetch(request(), env), worker.fetch(request(), env)]);
    assert.deepEqual((await Promise.all(responses.map(response => response.json()))).map(result => result.status).sort(), ["idle", "sent"]);
    assert.equal(messages.length, 1);
    assert.match(messages[0].text, /Testwohnung/);
    assert.match(messages[0].text, /950 € warm/);
    assert.equal(sqlite.prepare("SELECT status FROM deliveries WHERE id='delivery'").get().status, "sent");
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});
