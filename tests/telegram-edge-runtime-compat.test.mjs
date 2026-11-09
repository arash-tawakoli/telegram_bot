import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const fast = readFileSync(new URL("../supabase/functions/telegram-fast/index.ts", import.meta.url), "utf8");
const gateway = readFileSync(new URL("../supabase/functions/telegram-gateway/index.ts", import.meta.url), "utf8");
const oauth = readFileSync(new URL("../supabase/functions/telegram-oauth-bridge/index.ts", import.meta.url), "utf8");
const sessions = readFileSync(new URL("../supabase/functions/telegram-ui/platform-sessions.js", import.meta.url), "utf8");
const handlers = readFileSync(new URL("../supabase/functions/telegram-ui/handlers.js", import.meta.url), "utf8");

test("active Telegram handlers do not call EdgeRuntime.waitUntil directly", () => {
  for (const source of [fast, gateway, oauth, sessions, handlers]) {
    assert.doesNotMatch(source, /EdgeRuntime\.waitUntil\s*\(/);
  }
  for (const source of [fast, gateway, oauth, sessions]) {
    assert.match(source, /function scheduleBackground\(/);
    assert.match(source, /await scheduleBackground\(/);
  }
  assert.equal((handlers.match(/await ack\(\);/g) || []).length, 5);
});

function scheduleHelperScope(source, runtime) {
  const start = source.indexOf("function scheduleBackground(");
  assert.notEqual(start, -1);
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1);
  const helper = stripTypeScriptTypes(source.slice(start, end + 2), { mode: "strip" });
  const scope = { Promise, console, EdgeRuntime: runtime };
  vm.runInNewContext(helper + "\nglobalThis.invokeSchedule = scheduleBackground;", scope);
  return scope;
}

test("background work is awaited when EdgeRuntime is unavailable", async () => {
  const scope = scheduleHelperScope(fast, undefined);
  let completed = false;
  await scope.invokeSchedule(Promise.resolve().then(() => { completed = true; }));
  assert.equal(completed, true);
});

test("background work is registered with EdgeRuntime when available", async () => {
  const tasks = [];
  const scope = scheduleHelperScope(fast, { waitUntil(task) { tasks.push(task); } });
  let resolveTask;
  const pending = new Promise(resolve => { resolveTask = resolve; });
  await scope.invokeSchedule(pending);
  assert.equal(tasks.length, 1);
  resolveTask();
  await tasks[0];
});

test("Telegram UI callback acknowledgement works without an EdgeRuntime global", async () => {
  let acknowledged = 0;
  let rendered = 0;
  const scope = {
    Number,
    String,
    Promise,
    isAdmin: () => true,
    acknowledge: async () => { acknowledged += 1; },
    adminUsers: async () => { rendered += 1; },
  };
  vm.runInNewContext(handlers.slice(handlers.indexOf("export async function handleCallback")).replace("export ", ""), scope);
  await scope.handleCallback({ id: "callback-1", data: "admin:list", message: { chat: { id: 1 }, message_id: 2 } }, {});
  assert.equal(acknowledged, 1);
  assert.equal(rendered, 1);
});
