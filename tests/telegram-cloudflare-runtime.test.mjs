import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const handlers = await readFile(new URL("../cloudflare/housing-runtime/src/telegram-legacy/handlers.js", import.meta.url), "utf8");
const sessions = await readFile(new URL("../cloudflare/housing-runtime/src/telegram-legacy/platform-sessions.js", import.meta.url), "utf8");

test("Cloudflare Telegram handlers do not depend on the Supabase EdgeRuntime global", () => {
  assert.equal(handlers.includes("EdgeRuntime"), false);
  assert.equal(sessions.includes("EdgeRuntime"), false);
  assert.equal(handlers.split("await ack();").length - 1, 4);
  // Cloudflare reads selected documents from D1 on each application; no stale Supabase sync RPC remains.
  assert.equal(sessions.includes("applicationWorker('sync_documents'"), false);
  assert.match(sessions, /send_with_auto_apply:next/);
});
