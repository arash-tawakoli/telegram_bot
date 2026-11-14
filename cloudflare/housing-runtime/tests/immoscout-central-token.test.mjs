import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { getCentralApplicationCredentials } from "../src/immoscout-central-token.js";

globalThis.crypto ||= webcrypto;

test("central ImmoScout invalid_grant is reported as a login requirement", async () => {
  const originalFetch = globalThis.fetch;
  const keyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const key = await crypto.subtle.importKey("raw", Buffer.from(keyHex, "hex"), { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ access_token: "expired", refresh_token: "revoked", expires_at: "2000-01-01T00:00:00.000Z" }));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode("nexalabs:immoscout:central:v1") }, key, plain));
  const row = {
    account_hint: "arash@nexalabs.de", ciphertext: Buffer.from(cipher).toString("base64"),
    iv: Buffer.from(iv).toString("base64"), status: "connected", enabled: 0,
  };
  const database = { prepare: () => ({ first: async () => row }) };
  globalThis.fetch = async () => Response.json({ error: "invalid_grant" }, { status: 400 });
  try {
    await assert.rejects(() => getCentralApplicationCredentials({ DB: database, TOKEN_ENCRYPTION_KEY: keyHex }), /needs_login/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
