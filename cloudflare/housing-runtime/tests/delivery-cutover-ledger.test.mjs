import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import worker from "../src/index.js";
import { listingIdentity } from "../src/delivery-cutover-ledger.js";

test("listing identities normalize only the supported provider URLs", () => {
  assert.equal(listingIdentity("https://www.immobilienscout24.de/expose/123456?utm_source=x#top"), "immoscout24:123456");
  assert.equal(listingIdentity("https://immowelt.de/expose/AbC-123?x=1"), "immowelt:AbC-123");
  assert.equal(listingIdentity("https://tenant.immomio.com/de/apply/00000000-0000-0000-0000-000000000001"), "immomio:00000000-0000-0000-0000-000000000001");
  assert.throws(() => listingIdentity("https://www.immowelt.de.evil.example/expose/abc"), /unsupported_listing_url/);
  assert.throws(() => listingIdentity("http://www.immowelt.de/expose/abc"), /invalid_listing_url/);
});

test("cutover ledger is disabled without a secret and reserves a delivery only once", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    const schema = new URL("../schema/d1/", import.meta.url);
    for (const file of readdirSync(schema).filter(x => x.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file, schema), "utf8"));
    const db = { prepare(query) {
      return { bind: (...values) => ({
        first: async () => sqlite.prepare(query).get(...values) || null,
        run: async () => ({ meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } }),
      }) };
    } };
    const participant_id = "00000000-0000-0000-0000-000000000001";
    const legacy = "legacy:00000000-0000-0000-0000-000000000002";
    const cloudflare = "cloudflare:00000000-0000-0000-0000-000000000003";
    const url = "https://www.immobilienscout24.de/expose/123456?utm_source=test";
    const req = (body, token = "secret") => new Request("https://runtime.example/internal/delivery-cutover-ledger", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const input = (action, owner = legacy, target = url) => ({ action, owner, participant_id, url: target });
    assert.equal((await worker.fetch(req(input("claim")), { HOUSING_DB: db })).status, 503);
    const env = { HOUSING_DB: db, DELIVERY_CUTOVER_SECRET: "secret" };
    assert.equal((await worker.fetch(req(input("claim"), "wrong"), env)).status, 401);
    const [a, b] = await Promise.all([worker.fetch(req(input("claim", legacy)), env), worker.fetch(req(input("claim", cloudflare)), env)]);
    const results = await Promise.all([a.json(), b.json()]);
    const states = results.map(result => result.status).sort();
    assert.deepEqual(states, ["busy", "claimed"]);
    const winner = results[0].status === "claimed" ? legacy : cloudflare;
    const loser = winner === legacy ? cloudflare : legacy;
    assert.equal((await (await worker.fetch(req(input("begin", winner)), env)).json()).status, "sending");
    assert.equal((await (await worker.fetch(req(input("sent", winner)), env)).json()).status, "sent");
    assert.equal((await (await worker.fetch(req(input("claim", loser, "https://immobilienscout24.de/expose/123456")), env)).json()).status, "already_sent");
    const second = "https://www.immowelt.de/expose/xyz";
    assert.equal((await (await worker.fetch(req(input("claim", legacy, second)), env)).json()).status, "claimed");
    assert.equal((await (await worker.fetch(req(input("begin", legacy, second)), env)).json()).status, "sending");
    assert.equal((await (await worker.fetch(req(input("unknown", legacy, second)), env)).json()).status, "unknown");
    assert.equal((await (await worker.fetch(req(input("claim", cloudflare, second)), env)).json()).status, "unknown");
    assert.equal((await (await worker.fetch(req(input("release", legacy, second)), env)).json()).status, "not_owner");
    const third = "https://www.immowelt.de/expose/def";
    assert.equal((await (await worker.fetch(req(input("claim", legacy, third)), env)).json()).status, "claimed");
    assert.equal((await (await worker.fetch(req(input("release", cloudflare, third)), env)).json()).status, "not_owner");
    assert.equal((await (await worker.fetch(req(input("release", legacy, third)), env)).json()).status, "released");
    assert.equal((await (await worker.fetch(req(input("claim", cloudflare, third)), env)).json()).status, "claimed");
    const fourth = "https://www.immowelt.de/expose/expired";
    assert.equal((await (await worker.fetch(req(input("claim", legacy, fourth)), env)).json()).status, "claimed");
    sqlite.exec("UPDATE delivery_cutover_ledger SET lease_until=datetime('now','-1 minute') WHERE status='reserved'");
    assert.equal((await (await worker.fetch(req(input("claim", cloudflare, fourth)), env)).json()).status, "claimed");
    assert.equal((await (await worker.fetch(req(input("begin", legacy, fourth)), env)).json()).status, "not_owner");
    assert.equal((await (await worker.fetch(req(input("begin", cloudflare, fourth)), env)).json()).status, "sending");
    const gallery = "https://www.immowelt.de/expose/gallery";
    assert.equal((await (await worker.fetch(req(input("claim", legacy, gallery)), env)).json()).status, "claimed");
    assert.equal((await (await worker.fetch(req(input("begin", legacy, gallery)), env)).json()).status, "sending");
    assert.equal((await (await worker.fetch(req(input("sent", legacy, gallery)), env)).json()).status, "sent");
    assert.equal((await (await worker.fetch(req(input("resume", legacy, gallery)), env)).json()).status, "sending");
    assert.equal((await (await worker.fetch(req(input("claim", cloudflare, gallery)), env)).json()).status, "already_sent");
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM deliveries").get().n, 0);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM applications").get().n, 0);
  } finally { sqlite.close(); }
});
