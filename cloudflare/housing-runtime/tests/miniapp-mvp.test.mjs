import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { Script } from "node:vm";
import { verifyMiniAppInitData, miniAppApi } from "../src/miniapp-api.js";
import { miniAppPage, miniAppStyle, miniAppScript } from "../src/miniapp-ui.js";
import { homeKeyboard, miniAppKeyboard, MINIAPP_URL } from "../src/telegram-legacy/navigation.js";

const ORIGIN = "https://traumwohnung-housing-runtime.arash-ce5.workers.dev";
const TOKEN = "123456:local-test-bot-token";
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";
const OFFER_ID = "00000000-0000-4000-8000-000000000003";
const OTHER_OFFER_ID = "00000000-0000-4000-8000-000000000004";
const SEARCH_ID = "00000000-0000-4000-8000-000000000005";
const DELIVERY_ID = "00000000-0000-4000-8000-000000000006";

async function sign(init) {
  const encode = new TextEncoder();
  const bytes = async (key, message) => {
    const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", k, encode.encode(message)));
  };
  const parts = new URLSearchParams(init);
  const check = [...parts.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => k + "=" + v).join("\n");
  const key = await bytes(encode.encode("WebAppData"), TOKEN);
  const digest = await bytes(key, check);
  parts.set("hash", [...digest].map(b => b.toString(16).padStart(2, "0")).join(""));
  return parts.toString();
}
async function validData(id = 50010, timestamp = Math.floor(Date.now() / 1000)) {
  return sign(new URLSearchParams({ auth_date: String(timestamp), query_id: "AA_fake",
    user: JSON.stringify({ id, first_name: "Person" }) }).toString());
}
function setup() {
  const db = new DatabaseSync(":memory:");
  const folder = new URL("../schema/d1/", import.meta.url);
  for (const name of readdirSync(folder).filter(f => f.endsWith(".sql")).sort())
    db.exec(readFileSync(new URL(name, folder), "utf8"));
  const run = (q, ...args) => db.prepare(q).run(...args);
  run("INSERT OR IGNORE INTO source_registry(id,name,family,connector) VALUES(1,?,?,?)",
    "ImmobilienScout24 Hamburg","immoscout24","mcp");
  run("INSERT INTO participants(id,first_name,last_name,telegram_user_id,status) VALUES(?,?,?,?,?)",
    OWNER_ID, "Demo", "Owner", 50010, "active");
  run("INSERT INTO participants(id,first_name,last_name,telegram_user_id,status) VALUES(?,?,?,?,?)",
    OTHER_ID, "Demo", "Other", 50011, "active");
  run("INSERT INTO search_profiles(id,participant_id,profile_slot,criteria,active) VALUES(?,?,1,?,1)",
    SEARCH_ID, OWNER_ID, JSON.stringify({
      name: "Hamburg West", location_mode: "all_hamburg", property_types: ["Wohnung"],
      max_warm_rent: 1250, min_rooms: 2, min_area_sqm: 45,
    }));
  run("INSERT INTO offer_identities(id,source_id,identity_hash,canonical_url,facts) VALUES(?,?,?,?,?)",
    OFFER_ID, 1, "hash-one", "https://www.immobilienscout24.de/expose/123",
    JSON.stringify({ title: "Wohnung am Park", warm_rent: 980, city: "Hamburg", rooms: 2, area_sqm: 51 }));
  run("INSERT INTO offer_identities(id,source_id,identity_hash,canonical_url,facts) VALUES(?,?,?,?,?)",
    OTHER_OFFER_ID, 1, "hash-two", "https://www.immobilienscout24.de/expose/321",
    JSON.stringify({ title: "Fremdes Angebot", warm_rent: 840, city: "Hamburg" }));
  run("INSERT INTO deliveries(id,participant_id,offer_identity_id,idempotency_key,status,sent_at) VALUES(?,?,?,?,'sent',CURRENT_TIMESTAMP)",
    DELIVERY_ID, OWNER_ID, OFFER_ID, "sent-one");
  run("INSERT INTO deliveries(id,participant_id,offer_identity_id,idempotency_key,status,sent_at) VALUES(?,?,?,?,'sent',CURRENT_TIMESTAMP)",
    "00000000-0000-4000-8000-000000000007", OTHER_ID, OTHER_OFFER_ID, "sent-other");
  run("INSERT INTO applications(id,participant_id,offer_identity_id,provider,idempotency_key,status,last_error) VALUES(?,?,?,'immoscout24',?,'manual_required','profile_incomplete')",
    "00000000-0000-4000-8000-000000000008", OWNER_ID, OFFER_ID, "app-one");
  const sql = {
    unsafe: async (raw, params = []) => {
      const ordered = [];
      const query = raw.replaceAll("housing.", "").replace(/\$(\d+)/g, (_s, num) => {
        ordered.push(params[Number(num) - 1]); return "?";
      });
      const statement = db.prepare(query);
      if (/^\s*SELECT\b/i.test(query) || /\bRETURNING\b/i.test(query))
        return statement.all(...ordered);
      statement.run(...ordered);
      return [];
    },
  };
  return { db, sql, done: () => db.close() };
}
async function call(sql, initData, action, extra = {}) {
  const request = new Request(ORIGIN + "/miniapp/api", {
    method: "POST", headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ action, ...extra, initData }),
  });
  const response = await miniAppApi(request, { TELEGRAM_BOT_TOKEN: TOKEN }, sql);
  return { status: response.status, body: await response.json(), response };
}

test("native Telegram Mini App HMAC authorizes only untampered recent Telegram identities", async () => {
  const raw = await validData();
  assert.deepEqual(await verifyMiniAppInitData(raw, TOKEN), { userId: 50010 });
  assert.equal(await verifyMiniAppInitData(raw.replace("50010", "50011"), TOKEN), null);
  assert.equal(await verifyMiniAppInitData(raw, "different-token"), null);
  assert.equal(await verifyMiniAppInitData(await validData(50010, Math.floor(Date.now()/1000)-90000), TOKEN), null);
  assert.equal(await verifyMiniAppInitData(raw + "&user=duplicate", TOKEN), null);
  assert.equal(await verifyMiniAppInitData("", TOKEN), null);
  assert.equal(await verifyMiniAppInitData(await validData(-5), TOKEN), null);
});

test("Telegram's Ed25519 signature field is included in bot-token HMAC verification", async () => {
  const now = Math.floor(Date.now() / 1000);
  const signed = await sign(new URLSearchParams({
    query_id: "AA_test", auth_date: String(now),
    signature: "base64url-ed25519-signature-value",
    user: JSON.stringify({ id: 50010, first_name: "Person" }),
  }).toString());
  assert.deepEqual(await verifyMiniAppInitData(signed, TOKEN), { userId: 50010 });
  const forged = new URLSearchParams(signed);
  forged.set("signature", "changed-signature");
  assert.equal(await verifyMiniAppInitData(forged.toString(), TOKEN), null);
  forged.delete("signature");
  assert.equal(await verifyMiniAppInitData(forged.toString(), TOKEN), null);
  const x = setup();
  try {
    assert.equal((await call(x.sql, signed, "bootstrap")).status, 200);
  } finally { x.done(); }
});

test("Mini App reads only the authenticated participant's offers, profiles and applications", async () => {
  const x = setup();
  try {
    const { status, body } = await call(x.sql, await validData(), "bootstrap");
    assert.equal(status, 200);
    assert.equal(body.participant.firstName, "Demo");
    assert.equal(body.offers.length, 1);
    assert.equal(body.offers[0].title, "Wohnung am Park");
    assert.equal(body.offers[0].warmRent, 980);
    assert.equal(body.applications.length, 1);
    assert.equal(body.applications[0].reason, "Bewerberprofil vervollständigen");
    assert.equal(body.searches.length, 1);
    assert.equal(body.searches[0].rent, 1250);
    assert.equal(body.saved.length, 0);
    assert.equal(await call(x.sql, await validData(90000), "bootstrap").then(r => r.status), 403);
  } finally { x.done(); }
});

test("saving requires a personally delivered offer; unsaving is owner scoped", async () => {
  const x = setup();
  try {
    const auth = await validData();
    assert.equal((await call(x.sql, auth, "saved:update", { offerId: OTHER_OFFER_ID, saved: true })).status, 403);
    assert.equal((await call(x.sql, auth, "saved:update", { offerId: OFFER_ID, saved: true })).status, 200);
    assert.equal((await call(x.sql, auth, "saved:update", { offerId: OFFER_ID, saved: true })).status, 200);
    assert.equal(x.db.prepare("SELECT COUNT(*) n FROM saved_offers WHERE participant_id=?").get(OWNER_ID).n, 1);
    assert.equal((await call(x.sql, auth, "bootstrap")).body.saved.length, 1);
    assert.equal((await call(x.sql, auth, "saved:update", { offerId: OFFER_ID, saved: false })).status, 200);
    assert.equal(x.db.prepare("SELECT COUNT(*) n FROM saved_offers").get().n, 0);
  } finally { x.done(); }
});

test("search edit and pause remain scoped to owned profiles and validate numeric filters", async () => {
  const x = setup();
  try {
    const auth = await validData();
    assert.equal((await call(x.sql, auth, "search:update", {
      id: SEARCH_ID, rent: 1100, rooms: 3, area: 58,
    })).status, 200);
    const c = JSON.parse(x.db.prepare("SELECT criteria FROM search_profiles WHERE id=?").get(SEARCH_ID).criteria);
    assert.deepEqual([c.max_warm_rent,c.min_rooms,c.min_area_sqm,c.location_mode],[1100,3,58,"all_hamburg"]);
    assert.equal((await call(x.sql, auth, "search:toggle", { id: SEARCH_ID, active: false })).status, 200);
    assert.equal(x.db.prepare("SELECT active FROM search_profiles WHERE id=?").get(SEARCH_ID).active, 0);
    assert.equal((await call(x.sql, auth, "search:update", {
      id: SEARCH_ID, rent: -1, rooms: 0, area: 10,
    })).status, 422);
    assert.equal((await call(x.sql, auth, "search:toggle", { id: OTHER_OFFER_ID, active: true })).status, 403);
  } finally { x.done(); }
});

test("profile save updates only whitelisted contacts and preserves other application fields", async () => {
  const x = setup();
  try {
    x.db.prepare("INSERT INTO applicant_profiles(participant_id,profile) VALUES(?,?)")
      .run(OWNER_ID, JSON.stringify({ employment_status: "EMPLOYEE", first_name: "Old" }));
    const fields = { first_name:"Lina",last_name:"Test",email:"lina@example.com",phone:"+4915123456789",
      street:"Allee",house_number:"2",postcode:"20095",city:"Hamburg" };
    const auth = await validData();
    assert.equal((await call(x.sql, auth, "profile:update", { fields })).status, 200);
    const dbProfile = JSON.parse(x.db.prepare("SELECT profile FROM applicant_profiles WHERE participant_id=?").get(OWNER_ID).profile);
    assert.equal(dbProfile.first_name, "Lina");
    assert.equal(dbProfile.employment_status, "EMPLOYEE");
    assert.equal((await call(x.sql, auth, "profile:update", {
      fields: { ...fields, postcode: "12" },
    })).status, 422);
    assert.equal((await call(x.sql, auth, "profile:update", {
      fields: { ...fields, admin: "true" },
    })).status, 422);
  } finally { x.done(); }
});

test("Mini App is mobile, script-checked, has four working tabs and uses centered hearts", async () => {
  const [page, style, script] = await Promise.all([
    miniAppPage().text(), miniAppStyle().text(), miniAppScript().text(),
  ]);
  new Script(script);
  assert.match(page, /data-tab="discover"/);
  for (const tab of ["search", "applications", "profile"]) assert.match(page, new RegExp('data-tab="'+tab+'"'));
  assert.match(page, /telegram-web-app\.js/);
  assert.match(page, /viewport-fit=cover/);
  assert.match(miniAppPage().headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(style, /left:50%;bottom:9%/);
  assert.match(style, /prefers-reduced-motion/);
  assert.match(script, /initData:tg.initData/);
  assert.doesNotMatch(script, /x-telegram-init-data/);
  assert.match(script, /heartBurst/);
  assert.equal(MINIAPP_URL, ORIGIN + "/miniapp");
  assert.equal(homeKeyboard({ is_premium: false }).inline_keyboard[0][0].web_app.url, MINIAPP_URL);
  assert.equal(miniAppKeyboard().inline_keyboard[0][0].web_app.url, MINIAPP_URL);
});
