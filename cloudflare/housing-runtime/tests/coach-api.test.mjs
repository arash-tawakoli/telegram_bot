import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createD1Client } from "../src/d1-database.js";
import { sha256 } from "../src/auth.js";
import { handleCoach } from "../src/coach-api.js";

function sqliteD1(db) {
  function statement(query, params) {
    return {
      async all() {
        const prepared = db.prepare(query);
        if (prepared.columns().length) {
          const results = prepared.all(...params);
          return { results, meta: { changes: results.length } };
        }
        const result = prepared.run(...params);
        return { results: [], meta: { changes: Number(result.changes) } };
      },
    };
  }
  return {
    prepare(query) {
      return {
        bind: (...params) => statement(query, params),
        all: () => statement(query, []).all(),
      };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.all());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

async function coachDatabase(role = "admin") {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(`
    CREATE TABLE portal_members (id TEXT PRIMARY KEY,email TEXT,display_name TEXT,role TEXT,active INTEGER,created_at TEXT);
    CREATE TABLE portal_sessions (id TEXT PRIMARY KEY,member_id TEXT,access_token_hash TEXT UNIQUE,refresh_token_hash TEXT UNIQUE,access_expires_at TEXT,refresh_expires_at TEXT,revoked_at TEXT,last_seen_at TEXT);
    CREATE TABLE participants (id TEXT PRIMARY KEY,email TEXT,first_name TEXT,last_name TEXT,status TEXT DEFAULT 'active',telegram_chat_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE participant_assignments (participant_id TEXT PRIMARY KEY REFERENCES participants(id),member_id TEXT REFERENCES portal_members(id));
    CREATE TABLE applicant_profiles (participant_id TEXT PRIMARY KEY REFERENCES participants(id),profile TEXT NOT NULL DEFAULT '{}',updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE search_profiles (id TEXT PRIMARY KEY,participant_id TEXT REFERENCES participants(id),criteria TEXT,active INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE source_links (search_profile_id TEXT,source_id INTEGER,PRIMARY KEY(search_profile_id,source_id));
    CREATE TABLE source_registry (id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE offer_identities (id TEXT PRIMARY KEY,source_id INTEGER,canonical_url TEXT,facts TEXT);
    CREATE TABLE applications (id TEXT PRIMARY KEY,participant_id TEXT,offer_identity_id TEXT,provider TEXT,status TEXT,last_error TEXT,wait_reason TEXT,created_at TEXT,updated_at TEXT,sent_at TEXT);
    CREATE TABLE application_events (id TEXT PRIMARY KEY,application_id TEXT,provider TEXT,event_type TEXT,status TEXT,reason TEXT,document_result TEXT,metadata TEXT,created_at TEXT);
    CREATE TABLE upload_tokens (id TEXT PRIMARY KEY,participant_id TEXT,object_key TEXT,original_filename TEXT,document_type TEXT,content_type TEXT,size_bytes INTEGER,expires_at TEXT,uploaded_at TEXT,consumed_at TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY,participant_id TEXT,object_key TEXT UNIQUE,original_filename TEXT,document_type TEXT,content_type TEXT,size_bytes INTEGER,send_with_auto_apply INTEGER);
  `);
  const memberId = "00000000-0000-4000-8000-000000000001";
  const access = "coach-access-token";
  db.prepare("INSERT INTO portal_members VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)").run(memberId, "coach@example.test", "Coach", role, 1);
  db.prepare("INSERT INTO portal_sessions VALUES (?,?,?,? ,?,? ,NULL,CURRENT_TIMESTAMP)").run("s1", memberId, await sha256(access), await sha256("refresh-token"), new Date(Date.now() + 3600000).toISOString(), new Date(Date.now() + 86400000).toISOString());
  return { db, sql: createD1Client(sqliteD1(db)), access };
}

function request(access, body) {
  return new Request("https://housing-runtime.test/edge/coach", {
    method: "POST",
    headers: { authorization: "Bearer " + access, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("coach application history uses D1-compatible SQL and returns listing details", async () => {
  const { db, sql, access } = await coachDatabase();
  const participantId = "00000000-0000-4000-8000-000000000101";
  const offerId = "00000000-0000-4000-8000-000000000201";
  const applicationId = "00000000-0000-4000-8000-000000000301";
  const created = new Date(Date.now() - 60000).toISOString();
  db.prepare("INSERT INTO participants(id,first_name,last_name,status) VALUES(?,?,?,'active')").run(participantId, "A", "B");
  db.prepare("INSERT INTO offer_identities(id,source_id,canonical_url,facts) VALUES(?,?,?,?)").run(offerId, 1, "https://www.immobilienscout24.de/expose/123456789", JSON.stringify({ title: "Wohnung in Hamburg", city: "Hamburg", district: "Altona", postal_code: "22765" }));
  db.prepare("INSERT INTO source_registry(id,name) VALUES(1,'ImmoScout24')");
  db.prepare("INSERT INTO applications(id,participant_id,offer_identity_id,provider,status,wait_reason,created_at,sent_at) VALUES(?,?,?,?,?,?,?,?)").run(applicationId, participantId, offerId, "immoscout24", "sent", "none", created, created);
  db.prepare("INSERT INTO application_events(id,application_id,provider,event_type,status,reason,metadata,created_at) VALUES(?,?,?,?,?,?,?,?)").run("event-1", applicationId, "immoscout24", "submission", "sent", null, "{}", created);

  const result = await handleCoach(sql, request(access, { action: "applications", days: 30 }));
  assert.equal(result.total, 1);
  assert.equal(result.applications.length, 1, JSON.stringify(result));
  assert.equal(result.applications[0].listings.title, "Wohnung in Hamburg");
  assert.equal(result.applications[0].listings.district, "Altona");
  assert.equal(result.applications[0].wait_reason, "none");
  assert.equal(result.applications[0].sent_at, created);
  assert.equal(result.applications[0].latestEvent.status, "sent");
  db.close();
});

test("coach cannot overwrite a search profile owned by another participant", async () => {
  const { db, sql, access } = await coachDatabase("coach");
  const own = "00000000-0000-4000-8000-000000000101";
  const other = "00000000-0000-4000-8000-000000000102";
  const profileId = "00000000-0000-4000-8000-000000000202";
  db.prepare("INSERT INTO participants(id,status) VALUES(?,'active'),(?,'active')").run(own, other);
  db.prepare("INSERT INTO participant_assignments(participant_id,member_id) VALUES(?,?)").run(own, "00000000-0000-4000-8000-000000000001");
  db.prepare("INSERT INTO search_profiles(id,participant_id,criteria,active) VALUES(?,?,?,1)").run(profileId, other, '{"name":"private"}');
  db.prepare("INSERT INTO source_registry(id,name) VALUES(1,'ImmoScout24')");
  db.prepare("INSERT INTO source_links(search_profile_id,source_id) VALUES(?,1)").run(profileId);

  await assert.rejects(
    handleCoach(sql, request(access, { action: "save_search", participantId: own, profileId, profile: { source_ids: [1], name: "tampered" } })),
    /participant_forbidden/,
  );
  assert.equal(db.prepare("SELECT criteria FROM search_profiles WHERE id=?").get(profileId).criteria, '{"name":"private"}');
  assert.equal(db.prepare("SELECT count(*) AS count FROM source_links WHERE search_profile_id=?").get(profileId).count, 1);
  db.close();
});

test("participant creation rolls back if assignment insertion fails", async () => {
  const { db, sql, access } = await coachDatabase("admin");
  await assert.rejects(
    handleCoach(sql, request(access, {
      action: "create_participant", first_name: "New", last_name: "Participant",
      coachMemberId: "00000000-0000-4000-8000-000000000002",
    })),
    /FOREIGN KEY constraint failed/,
  );
  assert.equal(db.prepare("SELECT count(*) AS count FROM participants").get().count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM applicant_profiles").get().count, 0);
  db.close();
});

test("upload registration atomically consumes its single-use token", async () => {
  const { db, sql, access } = await coachDatabase("coach");
  const participantId = "00000000-0000-4000-8000-000000000101";
  db.prepare("INSERT INTO participants(id,status) VALUES(?,'active')").run(participantId);
  db.prepare("INSERT INTO participant_assignments(participant_id,member_id) VALUES(?,?)").run(participantId, "00000000-0000-4000-8000-000000000001");
  db.prepare("INSERT INTO upload_tokens(id,participant_id,object_key,original_filename,document_type,content_type,size_bytes,expires_at,uploaded_at) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
    .run("u1", participantId, "participants/p1/doc.pdf", "doc.pdf", "other", "application/pdf", 10, new Date(Date.now() + 60000).toISOString());

  const body = { action: "register_upload", participantId, path: "participants/p1/doc.pdf", send_with_auto_apply: true };
  const result = await handleCoach(sql, request(access, body));
  assert.equal(result.ok, true);
  assert.equal(db.prepare("SELECT send_with_auto_apply FROM documents WHERE participant_id=?").get(participantId).send_with_auto_apply, 1);
  assert.ok(db.prepare("SELECT consumed_at FROM upload_tokens WHERE id='u1'").get().consumed_at);
  await assert.rejects(handleCoach(sql, request(access, body)), /upload_not_found/);
  db.close();
});
