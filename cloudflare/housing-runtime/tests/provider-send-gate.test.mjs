import test from "node:test";
import assert from "node:assert/strict";
import { providerSendEnabled } from "../src/application-policy.js";

test("providerSendEnabled parses the comma list", () => {
  const env = { AUTO_APPLY_PROVIDERS: " immoscout24, Immowelt ,kleinanzeigen" };
  assert.equal(providerSendEnabled(env, "immowelt"), true);
  assert.equal(providerSendEnabled(env, "kleinanzeigen"), true);
  assert.equal(providerSendEnabled(env, "immomio"), false);
});

test("providerSendEnabled rejects unknown providers and empty values", () => {
  assert.equal(providerSendEnabled({ AUTO_APPLY_PROVIDERS: "wg-gesucht" }, "wg-gesucht"), false);
  assert.equal(providerSendEnabled({ AUTO_APPLY_PROVIDERS: "" }, "immoscout24"), false);
  assert.equal(providerSendEnabled({}, "immoscout24"), false);
  assert.equal(providerSendEnabled(undefined, "immoscout24"), false);
});
