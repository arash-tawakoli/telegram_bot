import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createD1Client } from "../src/d1-database.js";
import { applicationDocumentFileResponse, applicationDocumentPackageResponse, createApplicationDocumentPackage } from "../src/application-documents.js";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE applications (id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE documents (id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, object_key TEXT NOT NULL, original_filename TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, send_with_auto_apply INTEGER NOT NULL, created_at TEXT NOT NULL);
  `);
  const binding = {
    prepare(query) {
      const statement = sqlite.prepare(query);
      let values = [];
      return {
        bind(...bound) { values = bound; return this; },
        async all() {
          if (statement.columns().length) return { results: statement.all(...values), meta: { changes: 0 } };
          const result = statement.run(...values);
          return { results: [], meta: { changes: result.changes } };
        },
      };
    },
  };
  return { sqlite, sql: createD1Client(binding) };
}

test("document package links are signed, R2-backed, and expire with the 24-hour application record", async () => {
  const { sqlite, sql } = database();
  const now = new Date("2026-11-13T10:00:00.000Z");
  const applicationId = "00000000-0000-4000-8000-000000000001";
  const participantId = "00000000-0000-4000-8000-000000000002";
  sqlite.prepare("INSERT INTO applications VALUES (?,?,?,?)").run(applicationId, participantId, now.toISOString(), "processing");
  sqlite.prepare("INSERT INTO documents VALUES (?,?,?,?,?,?,?,?)").run("00000000-0000-4000-8000-000000000003", participantId, "documents/cv.pdf", "Lebenslauf.pdf", "application/pdf", 1024, 1, now.toISOString());
  sqlite.prepare("INSERT INTO documents VALUES (?,?,?,?,?,?,?,?)").run("00000000-0000-4000-8000-000000000004", participantId, "documents/private.pdf", "Privat.pdf", "application/pdf", 2048, 0, now.toISOString());
  const env = { APPLICATION_CREDENTIAL_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", DOCUMENTS: {} };
  const created = await createApplicationDocumentPackage(sql, env, { id: applicationId, participant_id: participantId, created_at: now.toISOString() }, now);
  assert.equal(created.count, 1);
  const page = await applicationDocumentPackageResponse(sql, env, new Request(created.url), now);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Lebenslauf\.pdf/);
  assert.doesNotMatch(html, /Privat\.pdf/);
  const filePath = html.match(/href="([^"]+package-file[^"]+)"/)?.[1];
  assert.ok(filePath);
  const fileUrl = new URL(filePath, "https://intern.traumwohnunghamburg.de");
  const file = await applicationDocumentFileResponse(sql, { ...env, DOCUMENTS: { get: async key => key === "documents/cv.pdf" ? { body: new Response("test pdf bytes").body } : null } }, new Request(fileUrl), now);
  assert.equal(file.status, 200);
  assert.equal(await file.text(), "test pdf bytes");
  const expired = await applicationDocumentPackageResponse(sql, env, new Request(created.url), new Date(now.getTime() + 24 * 60 * 60_000 + 1));
  assert.equal(expired.status, 410);
  sqlite.close();
});

test("document package does not create links for applicants without opted-in files", async () => {
  const { sqlite, sql } = database();
  const now = new Date("2026-11-13T10:00:00.000Z");
  const applicationId = "00000000-0000-4000-8000-000000000001";
  const participantId = "00000000-0000-4000-8000-000000000002";
  sqlite.prepare("INSERT INTO applications VALUES (?,?,?,?)").run(applicationId, participantId, now.toISOString(), "processing");
  sqlite.prepare("INSERT INTO documents VALUES (?,?,?,?,?,?,?,?)").run("00000000-0000-4000-8000-000000000003", participantId, "documents/private.pdf", "Privat.pdf", "application/pdf", 2048, 0, now.toISOString());
  const result = await createApplicationDocumentPackage(sql, { APPLICATION_CREDENTIAL_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" }, { id: applicationId, participant_id: participantId, created_at: now.toISOString() }, now);
  assert.deepEqual(result, { url: null, count: 0 });
  sqlite.close();
});
