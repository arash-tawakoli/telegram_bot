import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const handlers = await readFile(new URL("../cloudflare/housing-runtime/src/telegram-legacy/handlers.js", import.meta.url), "utf8");
const sessions = await readFile(new URL("../cloudflare/housing-runtime/src/telegram-legacy/platform-sessions.js", import.meta.url), "utf8");

test("Cloudflare Telegram handlers do not depend on the Supabase EdgeRuntime global", () => {
  assert.equal(handlers.includes("EdgeRuntime"), false);
  assert.equal(sessions.includes("EdgeRuntime"), false);
  assert.equal(handlers.split("await ack();").length - 1, 5);
  assert.equal(sessions.split("await applicationWorker('sync_documents'").length - 1, 2);
});
