import assert from "node:assert/strict";
import test from "node:test";
import { scheduledTasksForMinute, sourcesForMinute } from "../src/source-schedule.js";

test("Scout regions and Kleinanzeigen poll every 5 minutes while other sources retain their cadence", () => {
  const runs = new Map();
  const idle = [];
  for (let minute = 0; minute < 40; minute++) {
    const sources = sourcesForMinute(minute);
    if (!sources.length) {
      idle.push(minute);
      continue;
    }
    assert.equal(sources.length, minute % 5 === 2 ? 2 : 1);
    for (const source of sources) runs.set(source, [...(runs.get(source) || []), minute]);
  }
  assert.deepEqual([...runs.keys()].sort((a, b) => a - b), [1, 2, 3, 23, 29, 35, 66, 69, 72]);
  assert.deepEqual(idle, []);
  const expected = new Map([[1, 5], [2, 5], [3, 10], [23, 10], [29, 10], [35, 20], [66, 20], [69, 5], [72, 5]]);
  for (const [source, interval] of expected) {
    const minutes = runs.get(source);
    const gaps = minutes.slice(1).map((value, index) => value - minutes[index]);
    gaps.push(minutes[0] + 40 - minutes.at(-1));
    assert.ok(gaps.every(value => value === interval), "source " + source + ": " + gaps);
  }
});

test("background maintenance uses lower frequency than the core dispatch minute", () => {
  const scheduled = { verifyTelegramWebhook: [], engagement: [], telegramRecovery: [], platformSessionReminders: [], premiumOverrideExpiry: [] };
  for (let minute = 0; minute < 60; minute++) {
    const tasks = scheduledTasksForMinute(minute);
    for (const key of Object.keys(scheduled)) if (tasks[key]) scheduled[key].push(minute);
  }
  assert.deepEqual(scheduled.verifyTelegramWebhook, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  assert.deepEqual(scheduled.engagement, [15]);
  assert.deepEqual(scheduled.telegramRecovery, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  assert.deepEqual(scheduled.platformSessionReminders, [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(scheduled.premiumOverrideExpiry, [0]);
});
