import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import worker from "../cloudflare/housing-runtime/src/index.js";
import { callCutoverBridge, shouldProtectDelivery } from "../supabase/functions/notification-dispatcher/delivery-lease.ts";

class TelegramFailure extends Error { constructor(message, outcomeUnknown = false, _fallback = false, retryAfter = 0) { super(message); this.outcomeUnknown = outcomeUnknown; this.retryAfter = retryAfter; } }

function setup(legacySend) {
  const sqlite = new DatabaseSync(":memory:");
  const schema = new URL("../cloudflare/housing-runtime/schema/d1/", import.meta.url);
  for (const file of ["0001_housing_core.sql", "0013_delivery_cutover_ledger.sql"]) sqlite.exec(readFileSync(new URL(file, schema), "utf8"));
  const user = "00000000-0000-0000-0000-000000000001", offer = "00000000-0000-0000-0000-000000000002", delivery = "00000000-0000-0000-0000-000000000003", eventId = "00000000-0000-0000-0000-000000000004", url = "https://www.immobilienscout24.de/expose/123456";
  sqlite.prepare("INSERT INTO participants(id,first_name,last_name,telegram_chat_id) VALUES(?,?,?,12)").run(user, "A", "B");
  sqlite.exec("INSERT INTO source_registry(id,name,family,connector) VALUES(1,'Test','immoscout24','test')");
  sqlite.prepare("INSERT INTO offer_identities(id,source_id,identity_hash,canonical_url,facts) VALUES(?,1,'offer',?,'{\"title\":\"Wohnung\",\"image_url\":\"https://pictures.immobilienscout24.de/listing.jpg\"}')").run(offer, url);
  sqlite.prepare("INSERT INTO deliveries(id,participant_id,offer_identity_id,idempotency_key,status) VALUES(?,?,?,'delivery','pending')").run(delivery, user, offer);
  const d1 = { prepare(query) {
    const make = values => ({
      first: async () => sqlite.prepare(query).get(...values) || null,
      run: async () => ({ meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } }),
      all: async () => { const statement = sqlite.prepare(query); return /^\s*(SELECT|WITH|PRAGMA)/i.test(query) || /\bRETURNING\b/i.test(query) ? { results: statement.all(...values) } : { results: [], meta: { changes: Number(statement.run(...values).changes) } }; },
    });
    return { bind: (...values) => make(values), ...make([]) };
  } };
  const env = { HOUSING_DB: d1, DELIVERY_RUN_TOKEN: "run", TELEGRAM_BOT_TOKEN: "fake", DELIVERY_CUTOVER_ENABLED: "1", DELIVERY_CUTOVER_SECRET: "bridge" };
  const cfRun = () => worker.fetch(new Request("https://runtime.example/internal/delivery/process?fresh_only=1", { method: "POST", headers: { authorization: "Bearer run" } }), env);
  const owner = { id: user, is_active: true }, event = { id: eventId, event_type: "new_listing", preview_progress: null, search_profiles: { is_active: true, profile_slot: 1, owner }, recipient: { id: user, chat_id: 12, is_active: true }, listings: { id: "listing", source_id: 1, canonical_url: url } };
  const finishes = [], query = { select() { return this; }, in() { return this; }, eq() { return this; }, lt() { return this; }, or() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: [event], error: null }); }, maybeSingle() { return Promise.resolve({ data: { preview_progress: null }, error: null }); } };
  const db = { from(name) { return name === "user_subscriptions" ? { select() { return this; }, async in() { return { data: [], error: null }; } } : query; }, async rpc(name) { return { data: name === "get_bot_secret" ? "1" : true, error: null }; } };
  const source = readFileSync(new URL("../supabase/functions/notification-dispatcher/index.ts", import.meta.url), "utf8");
  let handler;
  vm.runInNewContext(stripTypeScriptTypes(source.slice(source.indexOf("Deno.serve("))), {
    Deno: { serve(fn) { handler = fn; } }, crypto: { randomUUID: () => "lease" }, Response, Date, Map, Set, Number, String, console, db,
    sec: async name => name === "internal_worker_secret" ? "internal" : name === "delivery_cutover_bridge_secret" ? "bridge" : "telegram",
    shouldProtectDelivery,
    callCutoverBridge: (secret, action, participant, canonical, eventId) => callCutoverBridge(secret, action, participant, canonical, eventId, (url, options) => worker.fetch(new Request(url, options), env)),
    probeSagaRecoveryCandidate: async () => ({ checked: 0 }), hydrateSagaListing: async listing => ({ listing, meta: { isSaga: false, ref: null, application: null }, status: "not_saga", record: null }), sagaAlreadyReceived: async () => false, syncApplicationStatus: async () => ({ ok: true }),
    recoverDeliveries: async () => {}, waitForDispatchSlot: async () => true, claimDelivery: async () => ({ id: eventId, attempt: 1 }), finishDelivery: async (_db, _lease, result) => finishes.push(result),
    premium: () => false, deliveryNewnessCheck: () => ({ ok: true }), knownFacts: () => ({ published_text: null }), enrich: async listing => ({ ...listing, _availability: "online" }), send: legacySend, TelegramFailure,
  });
  const legacyRun = () => handler(new Request("https://test", { method: "POST", headers: { "x-internal-secret": "internal" }, body: "{}" }));
  return { sqlite, cfRun, legacyRun, finishes };
}

test("Cloudflare defers while legacy sends and then suppresses the duplicate", async () => {
  let entered, release, legacySends = 0, cfSends = 0;
  const inFlight = new Promise(resolve => { entered = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  const x = setup(async () => { legacySends++; entered(); await blocked; return { message_id: 7 }; });
  const original = globalThis.fetch; globalThis.fetch = async () => { cfSends++; return Response.json({ ok: true, result: { message_id: 8 } }); };
  try {
    const legacy = x.legacyRun(); await inFlight;
    assert.equal((await (await x.cfRun()).json()).status, "deferred");
    release(); assert.equal((await legacy).status, 200);
    assert.equal((await (await x.cfRun()).json()).reason, "cutover_duplicate");
    assert.equal(legacySends, 1); assert.equal(cfSends, 0);
  } finally { release(); globalThis.fetch = original; x.sqlite.close(); }
});

test("legacy defers while Cloudflare sends and then suppresses the duplicate", async () => {
  let entered, release, legacySends = 0, cfSends = 0;
  const inFlight = new Promise(resolve => { entered = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  const x = setup(async () => { legacySends++; return { message_id: 7 }; });
  const original = globalThis.fetch; globalThis.fetch = async () => { cfSends++; entered(); await blocked; return Response.json({ ok: true, result: { message_id: 8 } }); };
  try {
    const cf = x.cfRun(); await inFlight;
    assert.equal((await x.legacyRun()).status, 200); assert.equal(x.finishes[0].status, "failed");
    release(); assert.equal((await cf).status, 200);
    assert.equal((await x.legacyRun()).status, 200); assert.equal(x.finishes[1].status, "skipped");
    assert.equal(legacySends, 0); assert.equal(cfSends, 1);
  } finally { release(); globalThis.fetch = original; x.sqlite.close(); }
});
