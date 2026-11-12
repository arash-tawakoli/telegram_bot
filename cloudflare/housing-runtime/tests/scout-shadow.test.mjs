import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { runScoutShadow } from "../src/scout-shadow.js";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  const schema = new URL("../schema/d1/", import.meta.url);
  for (const file of readdirSync(schema).filter(x => x.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file, schema), "utf8"));
  const db = {
    prepare(query) {
      const make = values => ({
        first: async () => sqlite.prepare(query).get(...values) || null,
        run: async () => ({ meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } }),
      });
      return { bind: (...values) => make(values), ...make([]) };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return { sqlite, db };
}

test("shadow partitions store offers separately and never create deliveries", async () => {
  const { sqlite, db } = database(), originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ result: { structuredContent: { total: 21, entries: [{ exposedId: "123", exposeUrl: "https://www.immobilienscout24.de/expose/123", title: "Wohnung" }] } } });
  try {
    const result = await runScoutShadow(db);
    assert.equal(result.requests, 3);
    const state = sqlite.prepare("SELECT * FROM scout_shadow_scans WHERE source_id=1").get();
    assert.equal(JSON.parse(state.queue_json).length, 28);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM scout_shadow_offers").get().n, 1);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM offer_identities").get().n, 0);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM deliveries").get().n, 0);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM applications").get().n, 0);
    assert.equal(state.lease_token, null);
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});

test("failed scans keep their pending partition and release the lease", async () => {
  const { sqlite, db } = database(), originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  try {
    await assert.rejects(() => runScoutShadow(db), /immoscout_mcp_http_503/);
    const state = sqlite.prepare("SELECT * FROM scout_shadow_scans WHERE source_id=1").get();
    assert.equal(JSON.parse(state.queue_json).length, 7);
    assert.equal(state.requests, 0);
    assert.equal(state.lease_token, null);
    assert.equal(state.last_error, "scan_failed");
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});

test("a second worker cannot run the same scan concurrently", async () => {
  const { sqlite, db } = database(), originalFetch = globalThis.fetch;
  let started, release;
  const entered = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async () => { started(); await blocked; return Response.json({ result: { structuredContent: { total: 0, entries: [] } } }); };
  try {
    const first = runScoutShadow(db);
    await entered;
    assert.deepEqual(await runScoutShadow(db), { status: "idle" });
    release();
    assert.equal((await first).requests, 3);
    await runScoutShadow(db);
    assert.equal((await runScoutShadow(db)).status, "finished");
    assert.deepEqual(await runScoutShadow(db), { status: "idle" });
  } finally { release(); globalThis.fetch = originalFetch; sqlite.close(); }
});
