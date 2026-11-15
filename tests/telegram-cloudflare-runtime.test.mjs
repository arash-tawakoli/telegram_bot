import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const handlers = await readFile(new URL("../cloudflare/housing-runtime/src/telegram-legacy/handlers.js", import.meta.url), "utf8");
const sessions = await readFile(new URL("../cloudflare/housing-runtime/src/telegram-legacy/platform-sessions.js", import.meta.url), "utf8");

test("Cloudflare Telegram handlers do not depend on the Supabase EdgeRuntime global", () => {
  assert.equal(handlers.includes("EdgeRuntime"), false);
  assert.equal(sessions.includes("EdgeRuntime"), false);
  assert.ok(handlers.split("await ack();").length - 1 >= 6); // Additional acknowledged callback paths must not break the baseline.
  assert.match(handlers, /data\.startsWith\("save:"\)/);
  assert.match(handlers, /data\.startsWith\("saved:list:"\)/);
  assert.equal(sessions.includes("applicationWorker('sync_documents'"), false);
  assert.equal(sessions.includes("renderApplicantDocuments("),false);
  assert.equal(sessions.includes("message_temporary_wg"),false);
  assert.equal(sessions.includes("message_swap"),false);
  assert.match(sessions,/platforms:profile-preview/);
});
