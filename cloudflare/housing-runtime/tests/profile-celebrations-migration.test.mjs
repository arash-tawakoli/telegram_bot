import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../schema/d1/0022_profile_celebrations_remove_wbs_status.sql", import.meta.url), "utf8");

test("migration removes WBS status, preserves other data and backfills previous celebrations", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE participants(id TEXT PRIMARY KEY);");
    db.exec("CREATE TABLE applicant_profiles(participant_id TEXT PRIMARY KEY REFERENCES participants(id),profile TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);");
    db.exec("CREATE TABLE search_profiles(id TEXT PRIMARY KEY,participant_id TEXT NOT NULL REFERENCES participants(id));");
    db.exec("INSERT INTO participants VALUES('old'),('new'); INSERT INTO search_profiles VALUES('existing','old');");
    db.prepare("INSERT INTO applicant_profiles(participant_id,profile) VALUES(?,?)")
      .run("old", JSON.stringify({ first_name: "Mara", last_name: "Beispiel", wbs_status: "Ja", email: "test@example.org" }));

    db.exec(migration);
    const p = JSON.parse(db.prepare("SELECT profile FROM applicant_profiles WHERE participant_id='old'").get().profile);
    assert.equal(p.first_name, "Mara");
    assert.equal(p.email, "test@example.org");
    assert.equal(Object.hasOwn(p, "wbs_status"), false);
    assert.deepEqual(db.prepare("SELECT participant_id,kind FROM profile_celebrations ORDER BY kind").all().map(r => [r.participant_id, r.kind]), [["old", "applicant"], ["old", "search"]]);
    db.exec(migration);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM profile_celebrations").get().n, 2);
    db.prepare("INSERT INTO applicant_profiles(participant_id,profile) VALUES(?,?)")
      .run("new", JSON.stringify({ first_name: "Neue", last_name: "Person" }));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM profile_celebrations WHERE participant_id='new'").get().n, 0);
  } finally { db.close(); }
});
