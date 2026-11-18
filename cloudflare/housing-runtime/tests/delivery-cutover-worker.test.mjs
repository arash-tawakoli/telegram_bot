import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { deliveryCutoverLedger, reconcileCloudflareDeliveries } from "../src/delivery-cutover-ledger.js";

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  const schema = new URL("../schema/d1/", import.meta.url);
  for (const file of ["0001_housing_core.sql", "0013_delivery_cutover_ledger.sql"]) sqlite.exec(readFileSync(new URL(file, schema), "utf8"));
  const user = "00000000-0000-0000-0000-000000000001", offer = "00000000-0000-0000-0000-000000000002", delivery = "00000000-0000-0000-0000-000000000003";
  const url = "https://www.immobilienscout24.de/expose/123456", owner = "legacy:00000000-0000-0000-0000-000000000004";
  sqlite.prepare("INSERT INTO participants(id,first_name,last_name,telegram_chat_id) VALUES(?,?,?,12)").run(user, "A", "B");
  sqlite.exec("INSERT INTO source_registry(id,name,family,connector) VALUES(1,'Test','immoscout24','test')");
  sqlite.prepare("INSERT INTO offer_identities(id,source_id,identity_hash,canonical_url,facts) VALUES(?,1,'offer',?,'{\"title\":\"Wohnung\",\"image_url\":\"https://pictures.immobilienscout24.de/listing.jpg\"}')").run(offer, url);
  sqlite.prepare("INSERT INTO deliveries(id,participant_id,offer_identity_id,idempotency_key,status) VALUES(?,?,?,'delivery','pending')").run(delivery, user, offer);
  const db = { prepare(query) {
    const make = values => ({
      first: async () => sqlite.prepare(query).get(...values) || null,
      run: async () => ({ meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } }),
      all: async () => {
        const statement = sqlite.prepare(query);
        return /^\s*(SELECT|WITH|PRAGMA)/i.test(query) || /\bRETURNING\b/i.test(query)
          ? { results: statement.all(...values) }
          : { results: [], meta: { changes: Number(statement.run(...values).changes) } };
      },
    });
    return { bind: (...values) => make(values), ...make([]) };
  } };
  const env = { HOUSING_DB: db, DELIVERY_RUN_TOKEN: "run", TELEGRAM_BOT_TOKEN: "fake", DELIVERY_CUTOVER_ENABLED: "1", DELIVERY_CUTOVER_SECRET: "bridge" };
  const ledger = action => deliveryCutoverLedger(db, { action, participant_id: user, owner, url });
  const run = () => worker.fetch(new Request("https://runtime.example/internal/delivery/process?fresh_only=1", { method: "POST", headers: { authorization: "Bearer run" } }), env);
  return { sqlite, db, env, ledger, run, user, url, owner };
}

test("a legacy-sent offer is not sent again by Cloudflare", async () => {
  const x = setup(), original = globalThis.fetch;
  let sends = 0; globalThis.fetch = async () => { sends++; return Response.json({ ok: true, result: { message_id: 1 } }); };
  try {
    assert.equal((await x.ledger("claim")).status, "claimed");
    assert.equal((await x.ledger("begin")).status, "sending");
    assert.equal((await x.ledger("sent")).status, "sent");
    const result = await (await x.run()).json();
    assert.equal(result.reason, "cutover_duplicate");
    assert.equal(sends, 0);
    assert.equal(x.sqlite.prepare("SELECT status FROM deliveries").get().status, "skipped");
  } finally { globalThis.fetch = original; x.sqlite.close(); }
});

test("busy offers remain retryable even after the normal freshness window", async () => {
  const x = setup(), original = globalThis.fetch;
  let sends = 0; globalThis.fetch = async () => { sends++; return Response.json({ ok: true, result: { message_id: 1 } }); };
  try {
    await x.ledger("claim");
    assert.equal((await (await x.run()).json()).status, "deferred");
    x.sqlite.exec("UPDATE deliveries SET created_at=datetime('now','-1 day')");
    assert.equal((await x.ledger("release")).status, "released");
    assert.equal((await (await x.run()).json()).status, "sent");
    assert.equal(sends, 1);
    assert.equal((await x.ledger("claim")).status, "already_sent");
  } finally { globalThis.fetch = original; x.sqlite.close(); }
});

test("an uncertain Telegram outcome blocks both systems from resending", async () => {
  const x = setup(), original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network lost"); };
  try {
    assert.equal((await x.run()).status, 503);
    assert.equal((await x.ledger("claim")).status, "unknown");
    const delivery = x.sqlite.prepare("SELECT status,error_message FROM deliveries").get();
    assert.equal(delivery.status, "failed", "uncertain sends must not remain processing");
    assert.equal(delivery.error_message, "telegram_outcome_unknown");
  } finally { globalThis.fetch = original; x.sqlite.close(); }
});

test("a sent message remains recorded if ledger confirmation fails", async () => {
  const x = setup(), original = globalThis.fetch, prepare = x.db.prepare.bind(x.db);
  globalThis.fetch = async () => Response.json({ ok: true, result: { message_id: 88 } });
  x.db.prepare = query => {
    const statement = prepare(query);
    if (!query.startsWith("UPDATE delivery_cutover_ledger SET status=?")) return statement;
    return { bind: (...values) => {
      const bound = statement.bind(...values);
      return values[0] === "sent" ? { ...bound, run: async () => { throw new Error("database unavailable"); } } : bound;
    } };
  };
  try {
    const result = await (await x.run()).json();
    assert.equal(result.status, "sent"); assert.equal(result.ledger_status, "pending");
    const row = x.sqlite.prepare("SELECT status,telegram_message_id FROM deliveries").get();
    assert.equal(row.status, "sent"); assert.equal(row.telegram_message_id, 88);
    assert.equal((await x.ledger("claim")).status, "busy");
    assert.equal(await reconcileCloudflareDeliveries(x.db), 1);
    assert.equal((await x.ledger("claim")).status, "already_sent");
  } finally { globalThis.fetch = original; x.sqlite.close(); }
});

test("a successful response without a message ID is treated as unknown", async () => {
  const x = setup(), original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ok: true, result: {} });
  try {
    assert.equal((await x.run()).status, 503);
    assert.equal((await x.ledger("claim")).status, "unknown");
    assert.equal(x.sqlite.prepare("SELECT error_message FROM deliveries").get().error_message, "cutover_outcome_unknown");
  } finally { globalThis.fetch = original; x.sqlite.close(); }
});
