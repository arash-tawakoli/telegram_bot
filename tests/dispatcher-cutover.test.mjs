import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

class TelegramFailure extends Error {
  constructor(message, outcomeUnknown = false, _fallback = false, retryAfter = 0) { super(message); this.outcomeUnknown = outcomeUnknown; this.retryAfter = retryAfter; }
}

function fixture({ replies = {}, send = async () => ({ message_id: 7 }), progress = null } = {}) {
  const source = readFileSync(new URL("../supabase/functions/notification-dispatcher/index.ts", import.meta.url), "utf8");
  const handlerSource = stripTypeScriptTypes(source.slice(source.indexOf("Deno.serve(")));
  const profileOwner = { id: "owner", is_active: true };
  const event = { id: "event", event_type: "new_listing", preview_progress: null, search_profiles: { is_active: true, profile_slot: 1, owner: profileOwner }, recipient: { id: "recipient", chat_id: 123, is_active: true }, listings: { id: "listing", source_id: 1, canonical_url: "https://www.immobilienscout24.de/expose/123" } };
  const calls = [], finishes = [];
  const query = { select() { return this; }, in() { return this; }, eq() { return this; }, lt() { return this; }, or() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: [event], error: null }); }, maybeSingle() { return Promise.resolve({ data: { preview_progress: progress }, error: null }); } };
  const db = { from(name) { return name === "user_subscriptions" ? { select() { return this; }, async in() { return { data: [], error: null }; } } : query; }, async rpc(name) { return { data: name === "get_bot_secret" ? "bridge-secret" : true, error: null }; } };
  let handler;
  vm.runInNewContext(handlerSource, {
    Deno: { serve(fn) { handler = fn; } }, crypto: { randomUUID: () => "lease" }, Response, Date, Map, Set, Number, String, console,
    db, sec: async name => name === "internal_worker_secret" ? "internal" : "telegram",
    shouldProtectDelivery: () => true,
    callCutoverBridge: async (_secret, action) => { calls.push(action); return replies[action] || ({ claim: "claimed", begin: "sending", resume: "sending", sent: "sent", unknown: "unknown", release: "released" })[action]; },
    probeSagaRecoveryCandidate: async () => ({ checked: 0 }), hydrateSagaListing: async listing => ({ listing, meta: { isSaga: false, ref: null, application: null }, status: "not_saga", record: null }), sagaAlreadyReceived: async () => false, syncApplicationStatus: async () => ({ ok: true }),
    recoverDeliveries: async () => {}, waitForDispatchSlot: async () => true, claimDelivery: async () => ({ id: "event", attempt: 1 }), finishDelivery: async (_db, _lease, result) => finishes.push(result),
    premium: () => false, deliveryNewnessCheck: () => ({ ok: true }), knownFacts: () => ({ published_text: null }), enrich: async listing => ({ ...listing, _availability: "online" }), send, TelegramFailure,
  });
  const run = () => handler(new Request("https://test", { method: "POST", headers: { "x-internal-secret": "internal" }, body: "{}" }));
  return { run, event, calls, finishes };
}

test("legacy dispatcher skips a listing already sent by Cloudflare", async () => {
  let sends = 0; const f = fixture({ replies: { claim: "already_sent" }, send: async () => { sends++; } });
  assert.equal((await f.run()).status, 200);
  assert.equal(sends, 0); assert.deepEqual(f.calls, ["claim"]); assert.equal(f.finishes[0].status, "skipped");
});

test("legacy dispatcher reserves, begins and confirms one successful send", async () => {
  let sends = 0; const f = fixture({ send: async () => { sends++; return { message_id: 7 }; } });
  assert.equal((await f.run()).status, 200);
  assert.equal(sends, 1); assert.deepEqual(f.calls, ["claim", "begin", "sent"]); assert.equal(f.finishes[0].status, "sent");
});

test("busy and unknown deliveries are not sent", async () => {
  for (const status of ["busy", "unknown"]) {
    let sends = 0; const f = fixture({ replies: { claim: status }, send: async () => { sends++; } });
    assert.equal((await f.run()).status, 200);
    assert.equal(sends, 0); assert.equal(f.finishes[0].status, "failed");
    assert.equal(f.finishes[0].delivery_outcome_unknown, status === "unknown");
  }
});

test("uncertain sends remain blocked; a checkpointed gallery resumes under the same owner", async () => {
  const uncertain = fixture({ send: async () => { throw new TelegramFailure("timeout", true); } });
  await uncertain.run(); assert.deepEqual(uncertain.calls, ["claim", "begin", "unknown"]); assert.equal(uncertain.finishes[0].delivery_outcome_unknown, true);
  let attempts = 0; const progress = { version: 1, next: 1, in_flight: false };
  const resumed = fixture({ progress, send: async () => { if (++attempts === 1) throw new TelegramFailure("continue", false, false, 1); return { message_id: 7 }; } });
  await resumed.run(); assert.deepEqual(resumed.calls, ["claim", "begin", "sent"]); assert.equal(resumed.finishes[0].status, "failed");
  resumed.event.preview_progress = progress;
  await resumed.run(); assert.deepEqual(resumed.calls, ["claim", "begin", "sent", "resume", "sent"]); assert.equal(resumed.finishes[1].status, "sent");
});
