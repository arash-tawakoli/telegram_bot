import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

const schema = new URL("../schema/d1/", import.meta.url);
const migrationFile = "0021_cleanup_shadow_and_delivery_backlog.sql";
const migrations = readdirSync(schema).filter(file => file.endsWith(".sql")).sort();

function plan(db, query) {
  return db.prepare("EXPLAIN QUERY PLAN " + query).all().map(row => row.detail).join(" | ");
}

test("shadow retirement preserves idempotency and scheduled lookups use narrow indexes", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON");
    for (const file of migrations.filter(name => name !== migrationFile)) {
      db.exec(readFileSync(new URL(file, schema), "utf8"));
    }
    db.exec(`
      INSERT OR IGNORE INTO source_registry(id,name,family,connector,enabled) VALUES
        (1,'Scout HH','immoscout24','mcp',1),(3,'Immowelt HH','immowelt','html_discovery',1),
        (23,'HH Housing','immomio','immomio_tenant',1),(29,'VHW','immomio','immomio_tenant',1),
        (34,'Reiherstieg','immomio','immomio_tenant',1),(35,'Walddorfer','immomio','immomio_tenant',1),
        (66,'GEWOBA','immomio','immomio_tenant',1),(69,'Scout SH','immoscout24','mcp',1);
      INSERT OR IGNORE INTO source_registry(id,name,family,connector,connector_config,enabled) VALUES
        (71,'Immowelt SH shadow','immowelt','html_discovery','{"queue_matches":false}',1);
      INSERT INTO participants(id,first_name,last_name,telegram_chat_id) VALUES('audit-user','A','B',7);
      INSERT INTO offer_identities(id,source_id,identity_hash,canonical_url,facts,expires_at) VALUES
        ('live-offer',1,'live-hash','https://example.test/live','{}',datetime('now','+1 day')),
        ('shadow-offer',71,'shadow-hash','https://example.test/shadow','{}',datetime('now','+1 day'));
      INSERT INTO deliveries(id,participant_id,offer_identity_id,idempotency_key,status,error_message,created_at) VALUES
        ('old-live','audit-user','live-offer','audit-user:live-hash','pending',NULL,'2026-11-01 00:00:00'),
        ('cutover-live','audit-user','live-offer','audit-user:cutover-hash','pending','cutover_waiting','2026-11-01 00:00:00'),
        ('shadow-pending','audit-user','shadow-offer','audit-user:shadow-pending','pending',NULL,'2026-11-01 00:00:00'),
        ('shadow-sent','audit-user','shadow-offer','audit-user:shadow-sent','sent',NULL,'2026-11-01 00:00:00');
      INSERT INTO scout_shadow_scans(source_id,cycle_id,queue_json,status) VALUES(1,'cycle','[]','finished');
      INSERT INTO scout_shadow_offers(source_id,external_id,cycle_id,canonical_url,facts) VALUES(1,'public-offer','cycle','https://example.test/public','{}');
    `);
    db.prepare("INSERT INTO application_dedupe_keys(key_hash,created_at) VALUES(?,?)").run("a".repeat(64), "2026-11-01 00:00:00");
    db.exec(readFileSync(new URL(migrationFile, schema), "utf8"));

    const delivery = id => db.prepare("SELECT status,error_message,offer_identity_id,idempotency_key FROM deliveries WHERE id=?").get(id);
    assert.equal(delivery("old-live").status, "skipped");
    assert.equal(delivery("old-live").error_message, "stale_delivery_backlog");
    assert.equal(delivery("old-live").idempotency_key, "audit-user:live-hash");
    assert.equal(delivery("cutover-live").status, "pending");
    assert.equal(delivery("shadow-pending").status, "skipped");
    assert.equal(delivery("shadow-pending").error_message, "shadow_source_retired");
    assert.equal(delivery("shadow-pending").offer_identity_id, null);
    assert.equal(delivery("shadow-sent").status, "sent");
    assert.equal(delivery("shadow-sent").offer_identity_id, null);
    assert.equal(db.prepare("SELECT count(*) AS count FROM offer_identities WHERE source_id=71").get().count, 0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM source_registry WHERE id IN (30,32,36,39,71) AND enabled=1").get().count, 0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM source_registry WHERE enabled=1").get().count, 10);
    assert.equal(db.prepare("SELECT count(*) AS count FROM application_dedupe_keys WHERE key_hash=?").get("a".repeat(64)).count, 1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('scout_shadow_scans','scout_shadow_offers')").get().count, 0);

    db.prepare("INSERT INTO deliveries(id,participant_id,offer_identity_id,idempotency_key,status,error_message,created_at) VALUES(?,?,?,?,?,?,datetime('now'))").run("fresh-live","audit-user","live-offer","audit-user:fresh-live","pending",null);
    const fresh = plan(db, "SELECT id FROM deliveries WHERE status='pending' AND error_message IS NOT 'cutover_waiting' AND created_at >= datetime('now','-15 minutes') ORDER BY created_at,id LIMIT 1");
    const cutover = plan(db, "SELECT id FROM deliveries WHERE status='pending' AND error_message='cutover_waiting' ORDER BY created_at,id LIMIT 1");
    const combined = plan(db, "WITH fresh AS (SELECT id,created_at,0 AS priority FROM deliveries WHERE status='pending' AND error_message IS NOT 'cutover_waiting' AND created_at>=datetime('now','-15 minutes') ORDER BY created_at,id LIMIT 1), cutover AS (SELECT id,created_at,1 AS priority FROM deliveries WHERE status='pending' AND error_message='cutover_waiting' ORDER BY created_at,id LIMIT 1), candidates AS (SELECT id,created_at,priority FROM fresh UNION ALL SELECT id,created_at,priority FROM cutover) SELECT d.id FROM candidates c JOIN deliveries d ON d.id=c.id ORDER BY c.priority,c.created_at,c.id LIMIT 1");
    assert.equal(db.prepare("WITH fresh AS (SELECT id,created_at,0 AS priority FROM deliveries WHERE status='pending' AND error_message IS NOT 'cutover_waiting' AND created_at>=datetime('now','-15 minutes') ORDER BY created_at,id LIMIT 1), cutover AS (SELECT id,created_at,1 AS priority FROM deliveries WHERE status='pending' AND error_message='cutover_waiting' ORDER BY created_at,id LIMIT 1), candidates AS (SELECT id,created_at,priority FROM fresh UNION ALL SELECT id,created_at,priority FROM cutover) SELECT id FROM candidates ORDER BY priority,created_at,id LIMIT 1").get().id, "fresh-live");
    const offers = plan(db, "SELECT id FROM offer_identities WHERE expires_at IS NOT NULL AND expires_at <= datetime('now') ORDER BY expires_at,id LIMIT 5000");
    assert.match(fresh, /deliveries_pending_fresh_idx/);
    assert.match(combined, /deliveries_pending_fresh_idx/);
    assert.match(combined, /deliveries_pending_cutover_idx/);
    assert.match(cutover, /deliveries_pending_cutover_idx/);
    assert.match(offers, /offer_identities_expiry_idx/);
    const normalized = "julianday(CASE WHEN substr(created_at,-3)='+00' THEN substr(created_at,1,length(created_at)-3)||'Z' ELSE created_at END)";
    const applications = plan(db, "SELECT id FROM applications WHERE status <> 'processing' AND " + normalized + " IS NOT NULL AND " + normalized + " <= julianday('now','-24 hours') ORDER BY " + normalized + ",id LIMIT 5000");
    const events = plan(db, "SELECT id FROM application_events WHERE " + normalized + " IS NOT NULL AND " + normalized + " <= julianday('now','-24 hours') ORDER BY " + normalized + ",id LIMIT 5000");
    assert.match(applications, /applications_retention_idx/);
    assert.match(events, /application_events_retention_idx/);
  } finally {
    db.close();
  }
});
