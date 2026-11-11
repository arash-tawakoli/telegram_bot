import test from "node:test";
import assert from "node:assert/strict";
import { handleCoach } from "../src/coach-api.js";

test("removed portal views have no Cloudflare coach API actions", async () => {
  const sql = async (parts) => parts.join("?").includes("FROM housing.portal_sessions s") ? [{ id: "member", role: "super_admin", active: true }] : [];
  for (const action of ["source_health", "analytics", "resume_list", "jobseekers"]) {
    const request = new Request("https://runtime.example/edge/coach", { method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" }, body: JSON.stringify({ action }) });
    await assert.rejects(handleCoach(sql, request), /invalid_action/, action);
  }
});
