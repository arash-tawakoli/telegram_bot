import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { createD1Supabase } from "../src/telegram-legacy/d1-supabase.js";
import { configureLegacyRuntime, secretCache } from "../src/telegram-legacy/runtime.js";
import { saved } from "../src/telegram-legacy/navigation.js";

test("saved listings are displayed and repeated Telegram updates do not toggle them twice", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const originalFetch = globalThis.fetch;
  try {
    const schema = new URL("../schema/d1/", import.meta.url);
    for (const file of readdirSync(schema).filter(x => x.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(file, schema), "utf8"));
    const db = {
      prepare(query) {
        const make = params => ({ all: async () => {
          const statement = sqlite.prepare(query);
          if (/^\s*(SELECT|PRAGMA)/i.test(query)) return { results: statement.all(...params), meta: { changes: 0 } };
          return { results: [], meta: { changes: Number(statement.run(...params).changes) } };
        } });
        return { bind: (...params) => make(params), ...make([]) };
      },
      async batch(statements) {
        sqlite.exec("BEGIN");
        try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec("COMMIT"); return results; }
        catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      },
    };
    sqlite.exec("INSERT INTO participants(id,first_name,last_name) VALUES ('user','A','B'); INSERT INTO source_registry(id,name,family,connector) VALUES(1,'Test','immoscout24','test'); INSERT INTO offer_identities(id,source_id,identity_hash,canonical_url,facts) VALUES('offer',1,'offer','https://example.com/offer','{\"title\":\"Testwohnung\"}'); INSERT INTO saved_listings(id,participant_id,offer_identity_id) VALUES('expired','user',NULL)");
    const api = createD1Supabase(db, {});
    const toggle = update => api.rpc("toggle_saved_once", { p_update_id: update, p_user_id: "user", p_listing_id: "offer" });
    assert.equal((await toggle(1)).data, true);
    assert.equal((await toggle(1)).data, true);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM saved_listings WHERE offer_identity_id='offer'").get().n, 1);
    let sent;
    globalThis.fetch = async (_url, options) => { sent = JSON.parse(options.body); return Response.json({ ok: true, result: {} }); };
    secretCache.clear();
    configureLegacyRuntime({ TELEGRAM_BOT_TOKEN: "test" }, db);
    await saved({ id: "user", is_premium: true }, 123, null);
    const buttons = sent.reply_markup.inline_keyboard.flat();
    assert.ok(buttons.some(button => button.url === "https://example.com/offer" && button.text.includes("Testwohnung")));
    assert.ok(buttons.some(button => button.text.includes("nicht mehr verfügbar")));
    assert.equal((await toggle(2)).data, false);
    assert.equal((await toggle(1)).data, true);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM saved_listings WHERE offer_identity_id='offer'").get().n, 0);
    assert.match((await api.rpc("toggle_saved_once", { p_update_id: 3, p_user_id: "user", p_listing_id: "missing" })).error.message, /listing_unavailable/);
  } finally { globalThis.fetch = originalFetch; secretCache.clear(); sqlite.close(); }
});
