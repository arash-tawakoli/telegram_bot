import test from "node:test";
import assert from "node:assert/strict";
import { applicationProvider, applicationSchedule, missingApplicantFields, premiumParticipant } from "../src/application-policy.js";

test("AutoApply profile validation requires the full saved application profile", () => {
  assert.ok(missingApplicantFields({ first_name: "A", email: "not-an-email" }).includes("E-Mail-Adresse"));
  assert.ok(missingApplicantFields({}).includes("Bewerbungstext Wohnung"));
});

test("AutoApply schedule honors weekday, overnight window, and local timezone", () => {
  const now = new Date("2026-11-13T23:30:00.000Z"); // Saturday in Berlin.
  const blocked = applicationSchedule({ timezone: "Europe/Berlin", allowed_weekdays: "[1,2,3,4,5]", send_window_start: "22:00", send_window_end: "02:00" }, now);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "weekday_blocked");
  const allowed = applicationSchedule({ timezone: "Europe/Berlin", allowed_weekdays: [1,2,3,4,5,6,7], send_window_start: "22:00", send_window_end: "02:00" }, now);
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.localDate, "2026-11-14");
});

test("premium overrides expire and source family controls the provider target", () => {
  assert.equal(premiumParticipant({ plan_override: "premium", plan_override_expires_at: "2026-11-14T00:00:00Z" }, Date.parse("2026-11-13T00:00:00Z")), true);
  assert.equal(premiumParticipant({ plan_override: "free", subscription_status: "active" }), false);
  assert.equal(applicationProvider({ family: "immowelt" }, { canonical_url: "https://www.immowelt.de/expose/abc" }), "immowelt");
  assert.equal(applicationProvider({ family: "immomio" }, { canonical_url: "https://tenant.immomio.com/de/apply/12345678-1234-4234-8234-123456789012" }), "immomio");
});
