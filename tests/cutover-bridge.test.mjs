import test from "node:test";
import assert from "node:assert/strict";
import { callCutoverBridge, shouldProtectDelivery } from "../supabase/functions/notification-dispatcher/delivery-lease.ts";

test("only supported new-listing URLs use the cutover bridge", () => {
  assert.equal(shouldProtectDelivery("new_listing", 1, "https://www.immobilienscout24.de/expose/12345?x=1"), true);
  assert.equal(shouldProtectDelivery("new_listing", 35, "https://tenant.immomio.com/de/apply/00000000-0000-0000-0000-000000000001"), true);
  assert.equal(shouldProtectDelivery("still_active", 1, "https://www.immobilienscout24.de/expose/12345"), false);
  assert.equal(shouldProtectDelivery("new_listing", 2, "https://www.immobilienscout24.de/expose/12345"), false);
  assert.equal(shouldProtectDelivery("new_listing", 3, "https://www.immowelt.de.evil.example/expose/x"), false);
});

test("bridge authenticates requests and fails closed on unavailable or invalid responses", async () => {
  let sent;
  const request = async (url, options) => { sent = { url, options }; return Response.json({ status: "claimed" }); };
  assert.equal(await callCutoverBridge("secret", "claim", "participant", "https://www.immowelt.de/expose/x", "event", request), "claimed");
  assert.equal(sent.options.headers.authorization, "Bearer secret");
  assert.equal(sent.options.redirect, "error");
  assert.equal(JSON.parse(sent.options.body).owner, "legacy:event");
  await assert.rejects(() => callCutoverBridge("secret", "claim", "participant", "url", "event", async () => new Response("no", { status: 503 })), /cutover_bridge_unavailable/);
  await assert.rejects(() => callCutoverBridge("secret", "claim", "participant", "url", "event", async () => Response.json({ status: "unexpected" })), /cutover_bridge_invalid_response/);
});
