import test from "node:test";
import assert from "node:assert/strict";
import { handleCoach } from "../src/coach-api.js";

test("document upload and open links use the portal origin for its host-only session", async () => {
  const participantId = "6075e235-df06-4923-8000-a653dec275ea";
  const documentId = "7075e235-df06-4923-8000-a653dec275ea";
  const sql = async (parts) => {
    const query = parts.join("?");
    if (query.includes("FROM housing.portal_sessions s")) return [{ id: "member", role: "super_admin", active: true }];
    if (query.includes("SELECT id FROM housing.documents")) return [{ id: documentId }];
    return [];
  };
  const request = body => new Request("https://runtime.example/edge/coach", {
    method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const opened = await handleCoach(sql, request({ action: "open_document", participantId, documentId }));
  const uploaded = await handleCoach(sql, request({ action: "request_upload", participantId, filename: "test.pdf", document_type: "other", mime_type: "application/pdf" }));
  assert.equal(new URL(opened.url).origin, "https://intern.traumwohnunghamburg.de");
  assert.equal(new URL(uploaded.signedUrl).origin, "https://intern.traumwohnunghamburg.de");
  assert.ok(new URL(uploaded.signedUrl).searchParams.get("token"));
});
