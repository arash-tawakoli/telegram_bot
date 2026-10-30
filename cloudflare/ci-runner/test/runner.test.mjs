import test from "node:test";
import assert from "node:assert/strict";
import { planForRepository } from "../container/runner.mjs";

test("Telegram Bot plan runs tests and strict runtime registry validation", () => {
  const plan = planForRepository("arash-tawakoli/telegram_bot", "/workspace");
  assert.ok(plan.some((step) => step.command === "npm" && step.args[0] === "test"));
  assert.ok(plan.some((step) => step.args.includes("scripts/check-runtime.mjs")));
  assert.ok(plan.some((step) => step.env?.RUNTIME_HASH_STRICT === "1"));
});

test("website plan covers Coach Portal, Platform Connect, Bridge and public site", () => {
  const plan = planForRepository("arash-tawakoli/website_traumwohnung", "/workspace");
  assert.ok(plan.some((step) => step.name.includes("Coach Portal")));
  assert.ok(plan.some((step) => step.name.includes("Platform Connect")));
  assert.ok(plan.some((step) => step.name.includes("Bridge")));
  assert.ok(plan.some((step) => step.name.includes("public website")));
});

test("unknown repositories are rejected", () => {
  assert.throws(() => planForRepository("untrusted/repository", "/workspace"), /not allowlisted/);
});
