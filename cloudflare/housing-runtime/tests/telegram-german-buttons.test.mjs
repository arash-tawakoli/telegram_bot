import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { configureLegacyRuntime } from "../src/telegram-legacy/runtime.js";
import { home, homeKeyboard, settings, premium, referralPage } from "../src/telegram-legacy/navigation.js";
import { handleCallback, handleMessage } from "../src/telegram-legacy/handlers.js";
import { platformSessions, handleAutoApplyMessage } from "../src/telegram-legacy/platform-sessions.js";

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  const dir = new URL("../schema/d1/", import.meta.url);
  for (const file of readdirSync(dir).filter(name => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, dir), "utf8"));
  }
  sqlite.exec("INSERT INTO participants(id,first_name,last_name,telegram_user_id,telegram_chat_id,plan_override,ui_language,test_auto_apply_allowed) VALUES ('owner','A','B',777,777,'premium','en',1)");
  const storage = new Map();
  const d1 = { prepare(query) {
    const build = args => ({
      all: async () => {
        const stmt = sqlite.prepare(query);
        if (/^\s*(SELECT|WITH|PRAGMA)/i.test(query) || /\bRETURNING\b/i.test(query))
          return { results: stmt.all(...args), meta: { changes: 0 } };
        return { results: [], meta: { changes: Number(stmt.run(...args).changes) } };
      },
      first: async () => sqlite.prepare(query).get(...args) || null,
      run: async () => ({ meta: { changes: Number(sqlite.prepare(query).run(...args).changes) } }),
    });
    return { bind: (...args) => build(args), ...build([]) };
  } };
  const docs = {
    head: async key => storage.has(key) ? { key } : null,
    put: async (key, body) => { storage.set(key, body); },
    delete: async keys => { for (const key of keys) storage.delete(key); },
  };
  configureLegacyRuntime({
    TELEGRAM_BOT_TOKEN: "fake",
    STRIPE_PORTAL_URL: "https://billing.stripe.com/p/login/test",
    DOCUMENTS: docs,
    HOUSING_DB: d1,
  }, d1);
  const sent = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const address = String(url);
    if (address.startsWith("https://api.telegram.org/file/botfake/"))
      return new Response(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10]), { status: 200 });
    if (!address.startsWith("https://api.telegram.org/botfake/"))
      throw new Error("unmocked network request");
    const method = address.split("/").at(-1);
    const body = JSON.parse(options.body);
    sent.push({ method, body });
    if (method === "getFile") return Response.json({ ok: true, result: { file_path: "documents/upload.pdf" } });
    return Response.json({ ok: true, result: { message_id: sent.length } });
  };
  const user = {
    id: "owner", user_id: "owner", telegram_user_id: 777, chat_id: 777,
    is_active: true, is_premium: true, ui_language: "en", subscription: null,
    request_update_id: null, request_attempt: null,
  };
  return { sqlite, storage, sent, user,
    chat: { id: 777, type: "private" },
    done() { globalThis.fetch = before; sqlite.close(); },
  };
}
const lastMessage = x => x.sent.filter(item => ["sendMessage", "editMessageText"].includes(item.method)).at(-1)?.body;

test("home and settings buttons are German-only regardless of saved English locale", async () => {
  const x = setup();
  try {
    const root = homeKeyboard(x.user).inline_keyboard;
    assert.deepEqual(root.map(row => row[0].callback_data),
      ["profile", "platforms:profile-new", "platforms", "premium", "settings"]);
    assert.equal(root[3][0].text, "💎 Mein Premium");
    await home(x.user, 777);
    assert.match(lastMessage(x).text, /Suchprofil erstellen|Bewerberprofil erstellen/);
    assert.doesNotMatch(lastMessage(x).text, /Create search|My search|Settings/i);
    await settings(x.user, 777);
    const keys = lastMessage(x).reply_markup.inline_keyboard.map(row => row[0].callback_data);
    assert.deepEqual(keys, ["help", "referral", "home"]);
    assert.doesNotMatch(lastMessage(x).text, /Language|Sprache/i);
  } finally { x.done(); }
});

test("legacy language callbacks open German settings without modifying user preferences", async () => {
  const x = setup();
  try {
    await handleCallback({ id: "callback-1", data: "lang:en", from: { id: 777 }, message: { chat: x.chat, message_id: 15 } }, x.user);
    assert.match(lastMessage(x).text, /Einstellungen/);
    assert.equal(sqliteLanguage(x.sqlite), "en");
    await handleCallback({ id: "callback-2", data: "language", from: { id: 777 }, message: { chat: x.chat, message_id: 15 } }, x.user);
    assert.match(lastMessage(x).text, /Hilfe und Premium-Empfehlungen/);
  } finally { x.done(); }
});
function sqliteLanguage(sqlite) {
  return sqlite.prepare("SELECT ui_language FROM participants WHERE id='owner'").get()?.ui_language;
}

test("the help callback returns to settings and German commands are registered", async () => {
  const x = setup();
  try {
    await handleCallback({ id: "callback-help", data: "help", from: { id: 777 }, message: { chat: x.chat, message_id: 16 } }, x.user);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard[0][0].callback_data, "settings");
    await handleMessage({ chat: x.chat, text: "/start" }, x.user);
    assert.match(lastMessage(x).text, /Jetzt loslegen/);
    const commands = x.sent.find(item => item.method === "setMyCommands")?.body?.commands || [];
    assert.ok(commands.some(c => c.command === "suchprofile"));
    assert.ok(commands.some(c => c.command === "fortsetzen"));
    assert.equal(commands.some(c => c.command === "resume"), false);
  } finally { x.done(); }
});

test("Premium only shows a real Stripe management button for paid subscriptions", async () => {
  const x = setup();
  try {
    await premium(x.user, 777);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard.some(row => /Abo verwalten/.test(row[0].text)), false);
    await premium({ ...x.user, subscription: { stripe_customer_id: "cus_test" } }, 777);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard[0][0].url,
      "https://billing.stripe.com/p/login/test");
    await premium({ ...x.user, is_premium: false }, 777);
    assert.match(lastMessage(x).reply_markup.inline_keyboard[0][0].text, /Premium abonnieren/);
  } finally { x.done(); }
});

test("referral page edits in place, shares a stable link, and never overwrites a code", async () => {
  const x = setup();
  try {
    await referralPage(x.user, 777, 20);
    assert.equal(x.sent.filter(y => y.method === "sendMessage").length, 0);
    const first = lastMessage(x);
    assert.match(first.text, /30 Tage Premium kostenlos/);
    assert.deepEqual(first.reply_markup.inline_keyboard.map(row => row[0].text),
      ["📤 Link teilen", "← Einstellungen"]);
    const code = x.sqlite.prepare("SELECT code FROM referral_codes WHERE participant_id='owner'").get().code;
    await referralPage(x.user, 777, 20);
    assert.equal(x.sqlite.prepare("SELECT count(*) AS n FROM referral_codes WHERE participant_id='owner'").get().n, 1);
    assert.equal(x.sqlite.prepare("SELECT code FROM referral_codes WHERE participant_id='owner'").get().code, code);
    assert.match(lastMessage(x).text, new RegExp(code));
  } finally { x.done(); }
});

test("personal Scout test-access button is read-only and displays actual state", async () => {
  const x = setup();
  try {
    x.sqlite.exec("UPDATE participants SET test_auto_apply_enabled=1,test_auto_apply_daily_limit=1 WHERE id='owner'");
    await platformSessions(x.user, x.chat, 22, "platforms:test-status");
    assert.match(lastMessage(x).text, /Persönlicher Testzugang/);
    assert.match(lastMessage(x).text, /Testmodus: <b>Aktiv/);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard.at(-1)[0].callback_data, "platforms");
    assert.equal(x.sqlite.prepare("SELECT test_auto_apply_enabled FROM participants WHERE id='owner'").get().test_auto_apply_enabled, 1);
  } finally { x.done(); }
});

test("document selection updates physical D1 columns and keeps a real document ID", async () => {
  const x = setup();
  try {
    x.sqlite.exec("INSERT INTO applicant_profiles(participant_id,profile) VALUES('owner','{\"first_name\":\"A\",\"last_name\":\"B\"}')");
    const message = {
      chat: x.chat, message_id: 30, document: { file_id: "file-123", file_name: "nachweis.pdf", file_size: 9 },
      reply_to_message: { text: "📎 Bewerberdokument · WBS", message_id: 29 },
    };
    await handleAutoApplyMessage(x.user, message);
    const row = x.sqlite.prepare("SELECT id,document_type,send_with_auto_apply FROM documents WHERE participant_id='owner'").get();
    assert.ok(/^[0-9a-f-]{36}$/i.test(row.id), "missing document ID");
    assert.equal(row.document_type, "wbs");
    assert.equal(row.send_with_auto_apply, 0);
    await platformSessions(x.user, x.chat, 31, "platforms:doc-toggle:" + row.id);
    assert.equal(x.sqlite.prepare("SELECT send_with_auto_apply FROM documents WHERE id=?").get(row.id).send_with_auto_apply, 1);
    assert.match(lastMessage(x).text, /1 für Auto-Bewerbungen ausgewählt/);
  } finally { x.done(); }
});
