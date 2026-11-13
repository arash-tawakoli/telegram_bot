import test from "node:test";
import assert from "node:assert/strict";
import { adminGrantExpiry } from "../src/telegram-legacy/admin.js";

test("three-month Premium grants clamp to the last valid target-month day", () => {
  assert.equal(adminGrantExpiry("3m", new Date("2026-01-31T12:00:00.000Z")), "2026-04-30T12:00:00.000Z");
  assert.equal(adminGrantExpiry("3m", new Date("2026-11-30T12:00:00.000Z")), "2027-02-28T12:00:00.000Z");
  assert.equal(adminGrantExpiry("3m", new Date("2026-11-13T12:00:00.000Z")), "2027-02-13T12:00:00.000Z");
});
