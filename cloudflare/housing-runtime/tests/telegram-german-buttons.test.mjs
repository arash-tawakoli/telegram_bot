import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { configureLegacyRuntime } from "../src/telegram-legacy/runtime.js";
import { home, homeKeyboard, settings, premium, referralPage, QUICK_ACTIONS, quickActionsKeyboard } from "../src/telegram-legacy/navigation.js";
import { handleCallback, handleMessage } from "../src/telegram-legacy/handlers.js";
import { platformSessions, handleAutoApplyMessage } from "../src/telegram-legacy/platform-sessions.js";
import { homePreview, HOME_LANGUAGES } from "../src/telegram-legacy/home-language.js";
import { createD1Supabase } from "../src/telegram-legacy/d1-supabase.js";
import { withPlan } from "../src/telegram-legacy/runtime.js";

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  const dir = new URL("../schema/d1/", import.meta.url);
  for (const file of readdirSync(dir).filter(name => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, dir), "utf8"));
  }
  sqlite.exec("INSERT INTO participants(id,first_name,last_name,telegram_user_id,telegram_chat_id,plan_override,ui_language,language_selected_at,test_auto_apply_allowed) VALUES ('owner','A','B',777,777,'premium','en',CURRENT_TIMESTAMP,1)");
  sqlite.exec("CREATE TABLE IF NOT EXISTS coach_geo_snapshot(id TEXT PRIMARY KEY,payload TEXT NOT NULL)");
  sqlite.prepare("INSERT INTO coach_geo_snapshot(id,payload) VALUES('de-hh-sh',?)").run(JSON.stringify({
    boroughs:[{id:1,name:"Hamburg-Mitte"}],
    neighborhoods:[{id:1,name:"Altstadt",borough_id:1}],
    schleswigHolsteinAreas:[{code:"01002",name:"Kiel"}],
  }));
  // The real search-profile save links every enabled source. Seed the same valid IDs.
  for (const id of [1, 3, 23, 29, 35, 66, 69, 71]) {
    sqlite.prepare("INSERT OR IGNORE INTO source_registry(id,name,family,connector) VALUES(?,?,?,?)")
      .run(id, "Testquelle " + id, "immoscout24", "test");
  }
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
  }, async batch(statements){
    sqlite.exec("BEGIN");
    try{
      const results=[];
      for(const statement of statements)results.push(await statement.all());
      sqlite.exec("COMMIT");
      return results;
    }catch(error){
      sqlite.exec("ROLLBACK");
      throw error;
    }
  } };
  const docs = {
    head: async key => storage.has(key) ? { key } : null,
    put: async (key, body) => { storage.set(key, body); },
    delete: async keys => { for (const key of keys) storage.delete(key); },
  };
  configureLegacyRuntime({
    TELEGRAM_BOT_TOKEN: "fake",
    STRIPE_PORTAL_URL: "https://billing.stripe.com/p/login/test",
    CENTRAL_API_SECRET: "test-central-secret",
    CENTRAL_TOKEN_ENCRYPTION_KEY: "1".repeat(64),
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
    is_active: true, is_premium: true, ui_language: "en", language_selected_at: "2026-11-14T00:00:00Z", subscription: null,
    request_update_id: null, request_attempt: null,
  };
  return { sqlite, d1, storage, sent, user,
    chat: { id: 777, type: "private" },
    done() { globalThis.fetch = before; sqlite.close(); },
  };
}
const lastMessage = x => x.sent.filter(item => ["sendMessage", "editMessageText"].includes(item.method)).at(-1)?.body;

test("only the home preview translates while all buttons and settings remain German", async () => {
  const x = setup();
  try {
    const root = homeKeyboard(x.user).inline_keyboard;
    assert.deepEqual(root.map(row => row[0].callback_data),
      ["profile", "platforms:profile-new", "platforms"]);
    assert.equal(root.some(row => /premium|settings/.test(row[0].callback_data)), false);
    await home(x.user, 777);
    assert.match(lastMessage(x).text, /What is it\?/);
    assert.match(lastMessage(x).text, /Create a search profile/);
    assert.doesNotMatch(lastMessage(x).text, /Was ist das\?/);
    await settings(x.user, 777);
    const keys = lastMessage(x).reply_markup.inline_keyboard.map(row => row[0].callback_data);
    assert.deepEqual(keys, ["language", "help", "reset:page", "referral", "home"]);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard[1][0].text, "❓ Hilfe & Support");
    assert.equal(lastMessage(x).reply_markup.inline_keyboard[2][0].text, "♻️ Reset");
    assert.match(lastMessage(x).text, /Einstellungen/);
  } finally { x.done(); }
});

test("legacy language callbacks remain safe and the language button opens nine choices", async () => {
  const x = setup();
  try {
    await handleCallback({ id: "callback-1", data: "lang:en", from: { id: 777 }, message: { chat: x.chat, message_id: 15 } }, x.user);
    assert.match(lastMessage(x).text, /Einstellungen/);
    assert.equal(sqliteLanguage(x.sqlite), "en");
    await handleCallback({ id: "callback-2", data: "language", from: { id: 777 }, message: { chat: x.chat, message_id: 15 } }, x.user);
    assert.match(lastMessage(x).text, /Sprache auswählen/);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard.filter(row=>row[0].callback_data.startsWith("language:set:")).length,9);
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
    assert.match(lastMessage(x).text, /Get started/);
    const commands = x.sent.find(item => item.method === "setMyCommands")?.body?.commands || [];
    assert.ok(commands.some(c => c.command === "suchprofile"));
    assert.ok(commands.some(c => c.command === "fortsetzen"));
    assert.equal(commands.some(c => c.command === "resume"), false);
    assert.deepEqual(commands.map(c=>c.command),[
      "start","suche","suchprofile","premium","gespeichert","sprache","hilfe",
      "teilen","einstellungen","pause","fortsetzen","status"
    ]);
    for(const [command,description] of [["premium","Premium"],["gespeichert","Gespeicherte Inserate"],["einstellungen","Einstellungen"],["hilfe","Hilfe & Support"],["sprache","Sprache"],["teilen","30 Tage Premium kostenlos"]]){
      assert.ok(commands.some(c=>c.command===command&&c.description===description),command);
    }
    assert.equal(commands.some(c=>c.command==="portalsetup"),false);
    await handleMessage({chat:x.chat,text:"/sprache"},x.user);
    assert.match(lastMessage(x).text,/Sprache auswählen/);
  } finally { x.done(); }
});

test("/teilen opens the referral reward and /portalsetup is no longer registered or active",async()=>{
 const x=setup();
 try{
  await handleMessage({chat:x.chat,text:"/teilen"},x.user);
  assert.match(lastMessage(x).text,/30 Tage Premium kostenlos/);
  const before=x.sent.length;
  const admin={...x.user,telegram_user_id:8538226539,chat_id:8538226539};
  const chat={id:8538226539,type:"private"};
  await handleMessage({chat,text:"/start"},admin);
  const adminCommands=x.sent.filter(item=>item.method==="setMyCommands"
    &&item.body.scope?.type==="chat" && item.body.scope.chat_id===8538226539);
  assert.ok(adminCommands.length>0);
  assert.ok(adminCommands.every(item=>item.body.commands.every(cmd=>cmd.command!=="portalsetup")));
  await handleMessage({chat,text:"/hilfe"},admin);
  assert.doesNotMatch(lastMessage(x).text,/portalsetup/);
  await handleMessage({chat,text:"/portalsetup"},admin);
  assert.match(lastMessage(x).text,/Bitte verwende die Befehle oder Buttons/);
  assert.ok(x.sent.length>before);
 }finally{x.done();}
});

test("Premium displays Go, Pro and Max side by side as non-purchasable previews", async () => {
  const x = setup();
  try {
    await premium(x.user, 777);
    let view = lastMessage(x);
    assert.deepEqual(view.reply_markup.inline_keyboard[0].map(b => b.text), ["Go", "Pro", "Max"]);
    assert.deepEqual(view.reply_markup.inline_keyboard[0].map(b => b.callback_data),
      ["premium:tier:go", "premium:tier:pro", "premium:tier:max"]);
    for (const text of ["1 Suchprofil", "Bis zu 4 Suchprofile", "Auto-Bewerbung", "Weitere Funktionen in Planung"]) {
      assert.match(view.text, new RegExp(text));
    }
    assert.match(view.text, /Dein Premium-Zugang ist aktiv/);
    assert.match(view.text, /Platzhalter und nicht buchbar/);
    assert.equal(view.reply_markup.inline_keyboard.some(row => /Abo verwalten/.test(row[0].text)), false);

    await premium({ ...x.user, subscription: { stripe_customer_id: "cus_test" } }, 777);
    view = lastMessage(x);
    assert.equal(view.reply_markup.inline_keyboard[1][0].url, "https://billing.stripe.com/p/login/test");

    await premium({ ...x.user, is_premium: false }, 777);
    view = lastMessage(x);
    assert.deepEqual(view.reply_markup.inline_keyboard[0].map(b => b.text), ["Go", "Pro", "Max"]);
    assert.equal(view.reply_markup.inline_keyboard.some(row => row.some(b => b.url)), false);

    const firstCount = x.sqlite.prepare("SELECT COUNT(*) AS n FROM user_subscriptions").get().n;
    for (const tier of ["go", "pro", "max"]) {
      await handleCallback({ id:"tier-"+tier, data:"premium:tier:"+tier, from:{id:777},
        message:{chat:x.chat,message_id:67} },x.user);
      const details = lastMessage(x);
      assert.match(details.text, new RegExp(tier, "i"));
      assert.match(details.text, /nicht buchbar/);
      assert.deepEqual(details.reply_markup.inline_keyboard[0].map(b => b.callback_data), ["premium"]);
    }
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM user_subscriptions").get().n, firstCount);
    await handleCallback({ id:"tier-back",data:"premium",from:{id:777},
      message:{chat:x.chat,message_id:67}}, x.user);
    assert.deepEqual(lastMessage(x).reply_markup.inline_keyboard[0].map(b => b.text), ["Go", "Pro", "Max"]);
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
      ["📤 Link teilen", "📋 Link kopieren", "← Einstellungen"]);
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

test("document management is retired without deleting existing records", async () => {
 const x=setup();
 try {
   x.sqlite.exec("INSERT INTO applicant_profiles(participant_id,profile) VALUES('owner','{\"first_name\":\"A\",\"last_name\":\"B\"}')");
   await platformSessions(x.user,x.chat,31,"platforms:docs");
   assert.match(lastMessage(x).text,/Bewerberprofil/);
   assert.equal(lastMessage(x).reply_markup.inline_keyboard.flat().some(b=>/docs|doc-upload|doc-delete/.test(b.callback_data||"")),false);
   assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM documents").get().n,0);
 }finally{x.done();}
});

test("search-profile menu and new-profile flow expose working callbacks in German", async () => {
  const x = setup();
  try {
    const callback = data => {
      const current = x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get();
      const onboarding_state = JSON.parse(current?.telegram_state || "{}");
      return handleCallback({
        id: "cb-" + data, data, from: { id: 777 },
        message: { chat: x.chat, message_id: 21 },
      }, { ...x.user, onboarding_state, onboarding_step: onboarding_state._step || null });
    };
    await callback("profile");
    assert.match(lastMessage(x).text, /Meine Suchprofile/);
    assert.ok(lastMessage(x).reply_markup.inline_keyboard.some(row => row[0].callback_data === "new"));
    await callback("new");
    assert.match(lastMessage(x).text, /Was möchtest du mieten/);
    const types = lastMessage(x).reply_markup.inline_keyboard.flat().map(b => b.callback_data);
    assert.ok(types.includes("type:Wohnung") && types.includes("type:Haus"));
    await callback("type:Wohnung");
    assert.match(lastMessage(x).text, /Wo möchtest du suchen/);
    assert.ok(lastMessage(x).reply_markup.inline_keyboard.flat().some(b => b.callback_data === "loc:all"));
    assert.equal(x.sqlite.prepare("SELECT json_extract(telegram_state,'$._step') AS step FROM participants WHERE id='owner'").get().step, "location");
    await callback("loc:all");
    await callback("rent:800");
    await callback("rooms:2");
    await callback("area:40");
    const previewButtons=lastMessage(x).reply_markup.inline_keyboard.flat().map(b=>b.callback_data);
    assert.deepEqual(previewButtons,["profile:save","review:edit"]);
    await callback("review:edit");
    const editButtons=lastMessage(x).reply_markup.inline_keyboard.flat().map(b=>b.callback_data);
    for(const key of ["types","location","rent","rooms","area"])
      assert.ok(editButtons.includes("edit:"+key),key);
    assert.ok(editButtons.includes("review"));
    await callback("review");
    assert.deepEqual(lastMessage(x).reply_markup.inline_keyboard.flat().map(b=>b.callback_data),["profile:save","review:edit"]);
    await callback("profile:save");
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM search_profiles WHERE participant_id='owner'").get().n,1);
    const linkedSources=x.sqlite.prepare("SELECT source_id FROM source_links ORDER BY source_id").all().map(row=>row.source_id);
    assert.deepEqual(linkedSources,[1,3,23,29,35,66,69,71],"new profiles must not include retired cooperative 34");
    const confetti=x.sent.filter(y=>y.method==='sendMessage'&&y.body.message_effect_id);
    assert.equal(confetti.length,1);
    assert.equal(confetti[0].body.message_effect_id,"5104841245755180586");
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM profile_celebrations WHERE participant_id='owner' AND kind='search'").get().n,0,"celebrations are not limited by a saved one-time claim");
  } finally { x.done(); }
});

test("applicant profile, field transition, text choices and separate preview work", async () => {
  const x = setup();
  try {
    const callback = data => handleCallback({
      id: "cb-" + data, data, from: { id: 777 },
      message: { chat: x.chat, message_id: 21 },
    }, x.user);
    await callback("platforms:profile-new");
    assert.match(lastMessage(x).text, /Bewerberprofil/);
    const keys = lastMessage(x).reply_markup.inline_keyboard.flat().map(b => b.callback_data);
    for (const name of ["salutation","first_name","last_name","email","phone","street","house_number","postcode","city","household_type","employment_status","income_range","pets","move_in_preference","schufa_status"]) {
      assert.ok(keys.includes("platforms:profile-field:" + name), "missing field " + name);
    }
    assert.ok(keys.includes("platforms:profile-texts"));
    assert.ok(keys.includes("platforms:profile-preview"));
    assert.ok(!keys.includes("platforms:docs"));
    assert.ok(!keys.includes("platforms:profile-field:wbs_status"));
    assert.match(lastMessage(x).text,/Hinterlege deine Angaben für Vermieter/);
    assert.doesNotMatch(lastMessage(x).text,/WBS|Wohnberechtigungsschein/);
    assert.doesNotMatch(lastMessage(x).text, /Profilstatus|Dokumente:/);
    await callback("platforms:profile-field:salutation");
    assert.match(lastMessage(x).text, /Anrede/);
    await callback("platforms:profile-set:salutation:MR");
    const raw = x.sqlite.prepare("SELECT profile FROM applicant_profiles WHERE participant_id='owner'").get()?.profile;
    assert.equal(JSON.parse(raw).salutation, "MR");
    await callback("platforms:profile-texts");
    assert.match(lastMessage(x).text, /Bewerbungstext/);
    assert.match(lastMessage(x).text, /Schreibe oder passe deinen Bewerbungstext für den Vermieter an/);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard[0][0].callback_data, "platforms:profile-text:message_apartment");
    await callback("platforms:profile-text:message_apartment");
    assert.match(lastMessage(x).text, /Wohnung/);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard.at(-1)[0].callback_data, "platforms:profile-texts");
    await callback("platforms:profile-preview");
    assert.match(lastMessage(x).text, /Profilvorschau/);
    assert.match(lastMessage(x).text, /Anrede:/);
    assert.doesNotMatch(lastMessage(x).text,/WBS-Status/);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard.at(-1)[0].callback_data, "platforms:profile-return");
  } finally { x.done(); }
});

test("free-text profile fields replace the current Telegram card and accept the next message",async()=>{
 const x=setup();
 try{
   await handleCallback({
     id:"callback-firstname",data:"platforms:profile-field:first_name",
     from:{id:777},message:{chat:x.chat,message_id:21}
   },x.user);
   const prompt=lastMessage(x);
   assert.match(prompt.text,/Vorname/);
   assert.equal(prompt.message_id,21);
   assert.equal(prompt.reply_markup.inline_keyboard[0][0].callback_data,"platforms:profile-return");
   const row=x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get();
   const onboarding_state=JSON.parse(row?.telegram_state||"{}");
   assert.equal(onboarding_state._applicant_field,"first_name");
   const beforeSends=x.sent.filter(a=>a.method==="sendMessage").length;
   await handleAutoApplyMessage({...x.user,onboarding_state,onboarding_step:onboarding_state._step||null},{
     chat:x.chat,message_id:22,text:"Ariana"
   });
   const profile=x.sqlite.prepare("SELECT profile FROM applicant_profiles WHERE participant_id='owner'").get();
   assert.equal(JSON.parse(profile.profile).first_name,"Ariana");
   const latest=lastMessage(x);
   assert.match(latest.text,/Bewerberprofil/);
   assert.equal(latest.message_id,21);
   assert.equal(x.sent.filter(a=>a.method==="sendMessage").length,beforeSends);
 }finally{x.done();}
});

test("auto-apply menu exposes only supported provider actions and non-mutating status", async () => {
  const x = setup();
  try {
    x.sqlite.exec("UPDATE participants SET test_auto_apply_enabled=1,test_auto_apply_daily_limit=1 WHERE id='owner'");
    await platformSessions(x.user, x.chat, 21, "platforms");
    const view = lastMessage(x);
    const controls = view.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
    assert.match(view.text, /0 von 3 Plattformen aktiv/);
    for (const id of [1,4,3]) assert.ok(controls.includes("platforms:resume:"+id));
    assert.ok(!controls.some(value => String(value || "").startsWith("platforms:provider:")),
      "platform names should be status text, not redundant info buttons");
    assert.equal(controls.includes("platforms:test-status"), false, "personal test button remains hidden");
    assert.ok(!controls.some(value => String(value || "").startsWith("platforms:login:")), "personal provider login must remain hidden");
    assert.equal(controls.some(value=>String(value||"").startsWith("platforms:test:")), false);
    assert.ok(controls.includes("home"), "back to start missing");
    assert.ok(controls.includes("platforms:on"), "start all missing");
    assert.ok(!controls.includes("platforms:off"), "only one global action must be shown");
    assert.match(view.text, /ImmoScout24 · Pausiert/);
    assert.equal(view.reply_markup.inline_keyboard[0][0].text, "🔴 ImmoScout24 starten");
    assert.ok(!controls.includes("noop"), "a visible provider control must not be a no-op");
  } finally { x.done(); }
});

test("search profile pause, resume, detail and back actions persist correctly in D1", async () => {
  const x = setup();
  try {
    x.sqlite.exec("INSERT INTO search_profiles(id,participant_id,profile_slot,criteria,active) VALUES('search-1','owner',1,'{\"name\":\"Meine Suche\",\"property_types\":[\"Wohnung\"],\"location_mode\":\"all_hamburg\",\"max_warm_rent\":1000,\"min_rooms\":2,\"min_area_sqm\":50}',1)");
    const callback = data => handleCallback({
      id: "cb-" + data, data, from: { id: 777 },
      message: { chat: x.chat, message_id: 22 },
    }, x.user);
    await callback("profile:view:1");
    assert.match(lastMessage(x).text, /Meine Suche/);
    assert.ok(lastMessage(x).reply_markup.inline_keyboard.flat().some(b => b.callback_data === "profile:pause:1"));
    await callback("profile:pause:1");
    assert.equal(x.sqlite.prepare("SELECT active FROM search_profiles WHERE id='search-1'").get().active, 0);
    await callback("profile:resume:1");
    assert.equal(x.sqlite.prepare("SELECT active FROM search_profiles WHERE id='search-1'").get().active, 1);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard.at(-1)[0].callback_data, "profile");
  } finally { x.done(); }
});

test("all three central sources expose status without creating participant login links", async () => {
  const x = setup();
  try {
    await platformSessions(x.user, x.chat, 23, "platforms");
    const controls = lastMessage(x).reply_markup.inline_keyboard.flat();
    for (const [source, provider] of [[1, "immoscout24"], [4, "immowelt"], [3, "immomio"]]) {
      assert.ok(controls.some(button => button.callback_data === "platforms:resume:" + source));
      assert.ok(!controls.some(button => button.callback_data === "platforms:provider:" + source));
      await platformSessions(x.user, x.chat, 23, "platforms:provider:" + source);
      const page = lastMessage(x);
      assert.match(page.text, /zentral/i);
      assert.doesNotMatch(page.text, /Konto nicht verbunden/);
      assert.ok(!page.reply_markup.inline_keyboard.flat().some(button => button.url),
        "central connection details must not expose participant login links");
      assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM provider_connections WHERE participant_id='owner' AND provider=?").get(provider).n, 0);
      assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM provider_auth_flows WHERE participant_id='owner' AND provider=?").get(provider).n, 0);
    }
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM applications").get().n, 0);
  } finally { x.done(); }
});

test("legacy personal provider login callbacks are safely ignored", async () => {
  const x = setup();
  try {
    for (const source of [1, 3, 4]) {
      await platformSessions(x.user, x.chat, 24, "platforms:login:" + source);
      assert.match(lastMessage(x).text, /zentral verwaltet/);
    }
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM provider_auth_flows").get().n, 0);
  } finally { x.done(); }
});

test("Bewerbungstext bearbeiten uses Telegram ForceReply, saves changes, and shows the first name immediately", async () => {
  const x = setup();
  try {
    x.sqlite.exec("INSERT INTO applicant_profiles(participant_id,profile) VALUES('owner','{\"first_name\":\"Mara\",\"last_name\":\"Beispiel\"}')");
    await platformSessions(x.user, x.chat, 21, "platforms:profile-text:message_apartment");
    assert.match(lastMessage(x).text, /Mara/);
    assert.doesNotMatch(lastMessage(x).text, /\[\[Vorname\]\]/);

    await platformSessions(x.user, x.chat, 21, "platforms:profile-field:message_apartment");
    const forced = x.sent.map((v, i) => ({ ...v, telegramMessageId: i + 1 }))
      .findLast(v => v.method === "sendMessage" && v.body.reply_markup?.force_reply === true);
    assert.ok(forced, "editing must open native Telegram reply input");
    assert.match(forced.body.text, /Bewerbungstext Wohnung bearbeiten/);
    assert.match(forced.body.text, /\[\[Vorname\]\]/);
    const state = JSON.parse(x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get().telegram_state);
    assert.equal(state._applicant_field, "message_apartment");
    assert.equal(state._applicant_prompt_message_id, forced.telegramMessageId);

    await handleMessage({
      chat: x.chat, message_id: 90, text: "Guten Tag, mein Name ist [[Vorname]]. Ich freue mich über eine Besichtigung.",
      reply_to_message: { message_id: forced.telegramMessageId, text: forced.body.text },
    }, { ...x.user, onboarding_state: state, onboarding_step: state._step || null });

    const saved = JSON.parse(x.sqlite.prepare("SELECT profile FROM applicant_profiles WHERE participant_id='owner'").get().profile);
    assert.match(saved.message_apartment, /\[\[Vorname\]\]/, "the saved template must keep the placeholder");
    const rendered = x.sent.filter(v => v.method === "editMessageText").at(-1).body;
    assert.equal(rendered.message_id, 21);
    assert.match(rendered.text, /mein Name ist Mara/);
    assert.doesNotMatch(rendered.text, /\[\[Vorname\]\]/);
    assert.ok(x.sent.some(v => v.method === "deleteMessage" && v.body.message_id === forced.telegramMessageId));
    const finalState = JSON.parse(x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get().telegram_state);
    assert.equal(finalState._applicant_field, undefined);
  } finally { x.done(); }
});

test("an incomplete applicant identity never celebrates before the required fields are complete", async () => {
  const x = setup();
  try {
    await platformSessions(x.user, x.chat, 21, "platforms:profile-new");
    const field = async (name, value) => {
      const initial = JSON.parse(x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get().telegram_state);
      await platformSessions({ ...x.user, onboarding_state: initial }, x.chat, 21, "platforms:profile-field:" + name);
      const state = JSON.parse(x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get().telegram_state);
      await handleAutoApplyMessage({ ...x.user, onboarding_state: state, onboarding_step: state._step || null },
        { chat: x.chat, text: value, message_id: x.sent.length + 60 });
    };
    const effects = () => x.sent.filter(v => v.method === "sendMessage" && v.body.message_effect_id === "5104841245755180586");
    assert.equal(effects().length, 0, "opening an empty profile must not celebrate");
    await field("first_name", "Mara");
    assert.equal(effects().length, 0, "one name field is not a completed identity");
    await field("last_name", "Beispiel");
    assert.equal(effects().length, 0, "first and last name do not complete the full profile");
    await field("first_name", "Maria");
    assert.equal(effects().length, 0);
  } finally { x.done(); }
});

const completeApplicant = {
  first_name:"Mara",last_name:"Beispiel",email:"mara@example.org",phone:"+49123456789",
  street:"Testweg",house_number:"1",postcode:"20095",city:"Hamburg",
  salutation:"MS",household_type:"SINGLE",employment_status:"EMPLOYEE",
  income_range:"NOT_SPECIFIED",pets:"NO",move_in_preference:"NOT_SPECIFIED",schufa_status:"NOT_SPECIFIED"
};

test("all nine home preview translations preserve German menu controls", async () => {
  const x=setup();
  try{
    assert.deepEqual(Object.keys(HOME_LANGUAGES),["de","en","ar","prs","ckb","kmr","ru","uk","tr"]);
    for (const code of Object.keys(HOME_LANGUAGES)){
      const preview=homePreview(code);
      assert.match(preview,/Traumwohnung Hamburg/);
      assert.match(preview,/1[.] /);
      assert.match(preview,/2[.] /);
      assert.match(preview,/3[.] /);
      assert.ok(preview.length<900);
      await home({...x.user,ui_language:code},777);
      assert.equal(lastMessage(x).reply_markup.inline_keyboard[0][0].text,"🔎 Suchprofil");
    }
    assert.match(homePreview("unknown"),/Was ist das/);
  }finally{x.done();}
});

test("first /start asks for language, choosing Sorani persists and opens the localized home",async()=>{
  const x=setup();
  try{
    x.sqlite.exec("UPDATE participants SET language_selected_at=NULL WHERE id='owner'");
    const fresh={...x.user,language_selected_at:null};
    await handleMessage({chat:x.chat,text:"/start"},fresh);
    assert.match(lastMessage(x).text,/Sprache auswählen/);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard.filter(row=>row[0].callback_data.startsWith("language:set:")).length,9);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard.some(row=>row[0].callback_data==="profile"),false);
    await handleCallback({id:"choice-sorani",data:"language:set:ckb",from:{id:777},message:{chat:x.chat,message_id:73}},fresh);
    assert.equal(sqliteLanguage(x.sqlite),"ckb");
    assert.ok(x.sqlite.prepare("SELECT language_selected_at FROM participants WHERE id='owner'").get().language_selected_at);
    assert.match(lastMessage(x).text,/ئەمە چییە/);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard[0][0].text,"🔎 Suchprofil");
    const adapter=createD1Supabase(x.d1,{});
    await adapter.rpc("prepare_telegram_update",{p_payload:{message:{chat:x.chat,from:{id:777,first_name:"Mara",language_code:"de"}}}});
    assert.equal(sqliteLanguage(x.sqlite),"ckb","Telegram updates must not reset the chosen language");
  }finally{x.done();}
});

test("new Telegram participants immediately receive a one-time 30-day Premium welcome grant",async()=>{
  const x=setup();
  try{
    const adapter=createD1Supabase(x.d1,{});
    const message={chat:{id:888,type:"private"},from:{id:888,first_name:"Neu",last_name:"Nutzer",language_code:"ru"},text:"/start"};
    const first=await adapter.rpc("prepare_telegram_update",{p_payload:{message}});
    assert.equal(first.error,null);
    assert.equal(first.data.is_new_user,true);
    assert.equal(first.data.user.language_selected_at,null);
    const user=first.data.user;
    assert.ok(Date.parse(user.referral_bonus_until)>Date.now()+29*24*3600000);
    assert.equal((await withPlan(user,null)).is_premium,true);
    assert.ok(x.sqlite.prepare("SELECT welcome_premium_granted_at FROM participants WHERE id=?").get(user.id)?.welcome_premium_granted_at);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM usage_reset_credits WHERE participant_id=? AND grant_key='starter:7d' AND redeemed_at IS NULL").get(user.id).n,1,
      "a new Premium trial user receives a banked reset for use after Premium expires");
    const prefs=x.sqlite.prepare("SELECT enabled,immoscout_enabled,immowelt_enabled,immomio_enabled FROM application_preferences WHERE participant_id=?").get(user.id);
    assert.deepEqual([prefs.enabled,prefs.immoscout_enabled,prefs.immowelt_enabled,prefs.immomio_enabled],[0,0,0,0]);
    const next=await adapter.rpc("prepare_telegram_update",{p_payload:{message}});
    assert.equal(next.data.is_new_user,false);
    assert.equal(next.data.user.referral_bonus_until,user.referral_bonus_until,"repeated updates do not extend the welcome trial");
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM usage_reset_credits WHERE participant_id=?").get(user.id).n,1,
      "repeated Telegram updates cannot grant duplicate starter resets");
  }finally{x.done();}
});

test("completion celebration repeats on later profile changes, and every successful Yes gets its own confetti",async()=>{
 const x=setup();
 try{
  x.sqlite.prepare("INSERT INTO search_profiles(id,participant_id,criteria,active) VALUES('completion-search','owner',?,1)")
    .run(JSON.stringify({property_types:["Wohnung"],location_mode:"all_hamburg"}));
  const incomplete={...completeApplicant};delete incomplete.schufa_status;
  x.sqlite.exec("INSERT INTO applicant_completion_prompts(participant_id) VALUES('owner')");
  x.sqlite.prepare("INSERT INTO applicant_profiles(participant_id,profile) VALUES('owner',?)").run(JSON.stringify(incomplete));
  await platformSessions(x.user,x.chat,31,"platforms:profile-set:schufa_status:NOT_SPECIFIED");
  const celebration=x.sent.filter(req=>req.method==="sendMessage"&&req.body.message_effect_id==="5104841245755180586");
  assert.equal(celebration.length,1);
  assert.match(celebration[0].body.text,/Jetzt die automatische Bewerbung aktivieren/);
  assert.deepEqual(celebration[0].body.reply_markup.inline_keyboard.map(row=>row[0].callback_data),
    ["platforms:completion:yes","platforms:completion:no"]);
  await platformSessions(x.user,x.chat,31,"platforms:profile-set:schufa_status:AVAILABLE");
  assert.equal(x.sent.filter(req=>req.method==="sendMessage"&&req.body.message_effect_id==="5104841245755180586").length,2,"a second complete profile change celebrates again");
  await platformSessions(x.user,x.chat,31,"platforms:profile-set:schufa_status:AVAILABLE");
  assert.equal(x.sent.filter(req=>req.method==="sendMessage"&&req.body.message_effect_id==="5104841245755180586").length,2,"saving an unchanged field is not a new completion");
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM applicant_completion_prompts WHERE participant_id='owner'").get().n,1,"the historical claim is ignored");

  const callback=async data=>handleCallback({id:"choice-"+data,data,from:{id:777},message:{chat:x.chat,message_id:31}},x.user);
  await callback("platforms:completion:yes");
  const effects=()=>x.sent.filter(req=>req.method==="sendMessage"&&req.body.message_effect_id==="5104841245755180586");
  assert.equal(effects().length,3,"successful Yes adds a third confetti effect");
  assert.match(effects().at(-1).body.text,/Automatische Bewerbung aktiviert/);
  await callback("platforms:completion:yes");
  assert.equal(effects().length,4,"another successful Yes also celebrates");
  const read=()=>x.sqlite.prepare("SELECT enabled,immoscout_enabled,immowelt_enabled,immomio_enabled FROM application_preferences WHERE participant_id='owner'").get();
  assert.deepEqual([read().enabled,read().immoscout_enabled,read().immowelt_enabled,read().immomio_enabled],[1,1,1,1]);
  assert.equal(x.sqlite.prepare("SELECT auto_apply_enabled FROM participants WHERE id='owner'").get().auto_apply_enabled,1);
  const controls=x.sent.filter(req=>req.method==="editMessageText").at(-1).body.reply_markup.inline_keyboard.flat().map(b=>b.callback_data);
  for (const id of [1,4,3])assert.ok(controls.includes("platforms:pause:"+id));

  await callback("platforms:completion:no");
  assert.equal(effects().length,4,"No never celebrates");
  assert.deepEqual([read().enabled,read().immoscout_enabled,read().immowelt_enabled,read().immomio_enabled],[0,0,0,0]);
  const paused=lastMessage(x).reply_markup.inline_keyboard.flat().map(b=>b.callback_data);
  for (const id of [1,4,3])assert.ok(paused.includes("platforms:resume:"+id));
 }finally{x.done();}
});

test("each provider Start/Pause independently controls stored preferences",async()=>{
 const x=setup();
 try{
  x.sqlite.prepare("INSERT INTO search_profiles(id,participant_id,criteria,active) VALUES('independent-search','owner',?,1)")
    .run(JSON.stringify({property_types:["Wohnung"],location_mode:"all_hamburg"}));
  x.sqlite.prepare("INSERT INTO applicant_profiles(participant_id,profile) VALUES('owner',?)").run(JSON.stringify(completeApplicant));
  await platformSessions(x.user,x.chat,44,"platforms");
  let controls=lastMessage(x).reply_markup.inline_keyboard.flat().map(b=>b.callback_data);
  for (const id of [1,4,3])assert.ok(controls.includes("platforms:resume:"+id));
  await platformSessions(x.user,x.chat,44,"platforms:resume:1");
  assert.match(lastMessage(x).text,/1 von 3 Plattformen aktiv/);
  assert.match(lastMessage(x).text,/ImmoScout24 · Aktiv/);
  assert.match(lastMessage(x).text,/Immowelt · Pausiert/);
  assert.equal(lastMessage(x).reply_markup.inline_keyboard.at(-2)[0].callback_data,"platforms:on",
    "partially active configuration offers to start all");
  assert.equal(lastMessage(x).reply_markup.inline_keyboard[0][0].text,"🟢 ImmoScout24 pausieren");
  const read=()=>x.sqlite.prepare("SELECT enabled,immoscout_enabled,immowelt_enabled,immomio_enabled FROM application_preferences WHERE participant_id='owner'").get();
  assert.deepEqual([read().enabled,read().immoscout_enabled,read().immowelt_enabled,read().immomio_enabled],[1,1,0,0]);
  await platformSessions(x.user,x.chat,44,"platforms:resume:4");
  assert.match(lastMessage(x).text,/2 von 3 Plattformen aktiv/);
  assert.equal(lastMessage(x).reply_markup.inline_keyboard.at(-2)[0].callback_data,"platforms:on");
  assert.deepEqual([read().enabled,read().immoscout_enabled,read().immowelt_enabled,read().immomio_enabled],[1,1,1,0]);
  await platformSessions(x.user,x.chat,44,"platforms:pause:1");
  assert.deepEqual([read().enabled,read().immoscout_enabled,read().immowelt_enabled,read().immomio_enabled],[1,0,1,0]);
  await platformSessions(x.user,x.chat,44,"platforms:pause:4");
  assert.match(lastMessage(x).text,/0 von 3 Plattformen aktiv/);
  assert.equal(lastMessage(x).reply_markup.inline_keyboard[0][0].text,"🔴 ImmoScout24 starten");
  assert.deepEqual([read().enabled,read().immoscout_enabled,read().immowelt_enabled,read().immomio_enabled],[0,0,0,0]);
  controls=lastMessage(x).reply_markup.inline_keyboard.flat().map(b=>b.callback_data);
  for (const id of [1,4,3])assert.ok(controls.includes("platforms:resume:"+id));
 }finally{x.done();}
});

test("incomplete applicant profile never enables any auto-apply source",async()=>{
 const x=setup();
 try{
  await platformSessions(x.user,x.chat,44,"platforms:resume:1");
  assert.match(lastMessage(x).text,/vervollständige zuerst dein Bewerberprofil/);
  assert.equal(x.sqlite.prepare("SELECT auto_apply_enabled FROM participants WHERE id='owner'").get().auto_apply_enabled,0);
  await platformSessions(x.user,x.chat,44,"platforms:completion:yes");
  assert.equal(x.sqlite.prepare("SELECT auto_apply_enabled FROM participants WHERE id='owner'").get().auto_apply_enabled,0);
 }finally{x.done();}
});

test("all three sources stay available without Premium, but an incomplete applicant cannot start",async()=>{
 const x=setup();
 try{
  await handleCallback({id:"free-menu",data:"platforms",from:{id:777},message:{chat:x.chat,message_id:59}},
   {...x.user,is_premium:false});
  const controls=lastMessage(x).reply_markup.inline_keyboard.flat().map(b=>b.callback_data);
  for(const id of [1,4,3])assert.ok(controls.includes("platforms:resume:"+id));
  assert.doesNotMatch(lastMessage(x).text,/Premium erforderlich/);
  await platformSessions({...x.user,is_premium:false},x.chat,59,"platforms:resume:1");
  assert.match(lastMessage(x).text,/Bewerberprofil unvollständig/);
  assert.equal(lastMessage(x).reply_markup.inline_keyboard[0][0].callback_data,"platforms:profile");
  assert.equal(x.sqlite.prepare("SELECT auto_apply_enabled FROM participants WHERE id='owner'").get().auto_apply_enabled,0);
 }finally{x.done();}
});

test("every newly created search-profile slot celebrates, even for a user with a historical celebration claim",async()=>{
 const x=setup();
 try{
  x.sqlite.exec("INSERT INTO profile_celebrations(participant_id,kind) VALUES('owner','search')");
  const callback=data=>{
   const current=x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get();
   const onboarding_state=JSON.parse(current?.telegram_state||"{}");
   return handleCallback({
     id:"repeated-profile-"+data,data,from:{id:777},
     message:{chat:x.chat,message_id:63}
   },{...x.user,onboarding_state,onboarding_step:onboarding_state._step||null});
  };
  const create=async()=>{
   await callback("new");
   for(const key of ["type:Wohnung","loc:all","rent:800","rooms:2","area:40","profile:save"])await callback(key);
  };
  await create();
  await create();
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM search_profiles WHERE participant_id='owner'").get().n,2);
  const effects=x.sent.filter(m=>m.method==="sendMessage"&&m.body.message_effect_id==="5104841245755180586");
  assert.equal(effects.length,2);
  assert.ok(effects.every(m=>/Suchprofil ist aktiv/.test(m.body.text)));
 }finally{x.done();}
});

test("all nine languages show representative flags without translating the German menus",async()=>{
 const x=setup();
 try{
  for(const [code,label] of Object.entries(HOME_LANGUAGES)){
   assert.match(label,/^[🇦-🇿]{2} /u,code);
  }
  await handleCallback({id:"language-flags",data:"language",from:{id:777},message:{chat:x.chat,message_id:91}},x.user);
  const rows=lastMessage(x).reply_markup.inline_keyboard;
  const options=rows.filter(row=>row[0].callback_data?.startsWith("language:set:"));
  assert.equal(options.length,9);
  assert.ok(options.every(row=>/🇩🇪|🇬🇧|🇸🇦|🇦🇫|🇮🇶|🇹🇷|🇷🇺|🇺🇦/u.test(row[0].text)));
  assert.equal(rows.at(-1)[0].callback_data,"settings");
 }finally{x.done();}
});

test("preview Bewerbungstext ändern navigates through its own text editor and back without opening search profiles",async()=>{
 const x=setup();
 try{
  const call=data=>handleCallback({id:"preview-"+data,data,from:{id:777},message:{chat:x.chat,message_id:91}},x.user);
  await call("platforms:profile-new");
  await call("platforms:profile-preview");
  let rows=lastMessage(x).reply_markup.inline_keyboard;
  assert.deepEqual(rows.map(row=>row[0].callback_data),["platforms:preview-texts","platforms:profile-clear","platforms:profile-return"]);
  assert.match(rows[0][0].text,/Bewerbungstext ändern/);
  assert.match(rows[1][0].text,/Angaben löschen/);
  await call("platforms:preview-texts");
  assert.match(lastMessage(x).text,/Schreibe oder passe deinen Bewerbungstext/);
  rows=lastMessage(x).reply_markup.inline_keyboard;
  assert.equal(rows[0][0].callback_data,"platforms:preview-text:message_apartment");
  assert.equal(rows[0][1].callback_data,"platforms:preview-text:message_house");
  assert.equal(rows.at(-1)[0].callback_data,"platforms:profile-preview");
  await call("platforms:preview-text:message_apartment");
  assert.equal(lastMessage(x).reply_markup.inline_keyboard[0][0].callback_data,"platforms:preview-edit:message_apartment");
  assert.equal(lastMessage(x).reply_markup.inline_keyboard.at(-1)[0].callback_data,"platforms:preview-texts");
  await call("platforms:preview-edit:message_apartment");
  const fieldScreen=x.sent.filter(req=>req.method==="editMessageText").at(-1).body;
  assert.equal(fieldScreen.reply_markup.inline_keyboard[0][0].callback_data,"platforms:preview-texts");
  const state=JSON.parse(x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get().telegram_state);
  assert.equal(state._applicant_text_origin,"preview");
  await handleAutoApplyMessage({...x.user,onboarding_state:state},{
   chat:x.chat,message_id:90,text:"Guten Tag [[Vorname]], ich interessiere mich für die Wohnung."
  });
  const edited=x.sent.filter(req=>req.method==="editMessageText").at(-1).body;
  assert.equal(edited.reply_markup.inline_keyboard.at(-1)[0].callback_data,"platforms:preview-texts");
  await call("platforms:preview-texts");
  await call("platforms:profile-preview");
  assert.match(lastMessage(x).text,/Profilvorschau/);
  await call("platforms:profile-return");
  assert.match(lastMessage(x).text,/Bewerberprofil/);
  assert.equal(lastMessage(x).reply_markup.inline_keyboard.at(-1)[0].callback_data,"home");
  await call("home");
  assert.match(lastMessage(x).text,/Traumwohnung Hamburg/);
 }finally{x.done();}
});

test("confirmed applicant reset removes every personal field, keeps application texts, and pauses all application sources",async()=>{
 const x=setup();
 try{
  const profile={...completeApplicant,move_in_date:"2026-12-01",household_size:2,monthly_net_income:2200,
    message_apartment:"Hallo [[Vorname]]! Wohnung",message_house:"Hallo [[Vorname]]! Haus"};
  x.sqlite.prepare("INSERT INTO applicant_profiles(participant_id,profile) VALUES('owner',?)").run(JSON.stringify(profile));
  x.sqlite.exec("INSERT INTO application_preferences(participant_id,enabled,immoscout_enabled,immowelt_enabled,immomio_enabled) VALUES('owner',1,1,1,1)");
  x.sqlite.exec("UPDATE participants SET auto_apply_enabled=1,test_auto_apply_enabled=1 WHERE id='owner'");
  const call=data=>handleCallback({id:"clear-"+data,data,from:{id:777},message:{chat:x.chat,message_id:32}},x.user);
  await call("platforms:profile-preview");
  await call("platforms:profile-clear");
  let buttons=lastMessage(x).reply_markup.inline_keyboard.map(row=>row[0]);
  const confirm=buttons[0].callback_data;
  assert.match(confirm,/^platforms:profile-clear-confirm:[a-f0-9]{12}$/);
  assert.equal(buttons[1].callback_data,"platforms:profile-preview");
  assert.match(lastMessage(x).text,/Bewerbungstexte bleiben erhalten/);
  await call(confirm);
  const saved=JSON.parse(x.sqlite.prepare("SELECT profile FROM applicant_profiles WHERE participant_id='owner'").get().profile);
  assert.deepEqual(saved,{message_apartment:profile.message_apartment,message_house:profile.message_house});
  const prefs=x.sqlite.prepare("SELECT enabled,immoscout_enabled,immowelt_enabled,immomio_enabled FROM application_preferences WHERE participant_id='owner'").get();
  assert.deepEqual(Object.values(prefs),[0,0,0,0]);
  const state=x.sqlite.prepare("SELECT auto_apply_enabled,test_auto_apply_enabled,telegram_state FROM participants WHERE id='owner'").get();
  assert.equal(state.auto_apply_enabled,0);
  assert.equal(state.test_auto_apply_enabled,0);
  assert.equal(JSON.parse(state.telegram_state)._applicant_clear_token,undefined);
  assert.match(lastMessage(x).text,/Angaben gelöscht/);
  assert.match(lastMessage(x).text,/Bewerberprofil/);
  x.sqlite.exec("UPDATE applicant_profiles SET profile=json_set(profile,'$.first_name','Neu') WHERE participant_id='owner'");
  await call(confirm);
  assert.match(lastMessage(x).text,/Löschbestätigung ist ungültig oder abgelaufen/);
  assert.equal(JSON.parse(x.sqlite.prepare("SELECT profile FROM applicant_profiles WHERE participant_id='owner'").get().profile).first_name,"Neu");
 }finally{x.done();}
});

test("canceling the applicant reset invalidates the confirmation and preserves the profile",async()=>{
 const x=setup();
 try{
  x.sqlite.prepare("INSERT INTO applicant_profiles(participant_id,profile) VALUES('owner',?)").run(JSON.stringify(completeApplicant));
  const call=data=>handleCallback({id:"cancel-"+data,data,from:{id:777},message:{chat:x.chat,message_id:44}},x.user);
  await call("platforms:profile-clear");
  const stale=lastMessage(x).reply_markup.inline_keyboard[0][0].callback_data;
  const pending=JSON.parse(x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get().telegram_state);
  await handleCallback({id:"cancel-preview",data:"platforms:profile-preview",from:{id:777},message:{chat:x.chat,message_id:44}},
   {...x.user,onboarding_state:pending});
  assert.match(lastMessage(x).text,/Profilvorschau/);
  await call(stale);
  assert.match(lastMessage(x).text,/Löschbestätigung ist ungültig oder abgelaufen/);
  assert.equal(JSON.parse(x.sqlite.prepare("SELECT profile FROM applicant_profiles WHERE participant_id='owner'").get().profile).first_name,completeApplicant.first_name);
 }finally{x.done();}
});

test("starting an incomplete provider shows Bewerberprofil vervollständigen and its button reaches the applicant editor",async()=>{
 const x=setup();
 try{
  const user={...x.user,is_premium:false};
  const call=data=>handleCallback({id:"missing-"+data,data,from:{id:777},message:{chat:x.chat,message_id:85}},user);
  await call("platforms:resume:1");
  assert.match(lastMessage(x).text,/Bewerberprofil unvollständig/);
  const buttons=lastMessage(x).reply_markup.inline_keyboard.flat();
  assert.equal(buttons[0].callback_data,"platforms:profile");
  assert.match(buttons[0].text,/Bewerberprofil vervollständigen/);
  assert.equal(buttons[1].callback_data,"platforms");
  await call("platforms:profile");
  assert.match(lastMessage(x).text,/Hinterlege deine Angaben/);
  assert.ok(lastMessage(x).reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="platforms:profile-field:first_name"));
  assert.equal(x.sqlite.prepare("SELECT auto_apply_enabled FROM participants WHERE id='owner'").get().auto_apply_enabled,0);
 }finally{x.done();}
});

test("/token shares the portal's three provider connections and securely reuses login flows",async()=>{
 const x=setup();
 try{
  const adminId=8538226539;
  const ownerUuid="33333333-3333-4333-8333-333333333333";
  x.sqlite.prepare("INSERT INTO participants(id,first_name,last_name,telegram_user_id,telegram_chat_id,language_selected_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)")
   .run(ownerUuid,"A","B",adminId,adminId);
  x.sqlite.prepare("INSERT INTO provider_connections(id,participant_id,provider,status,account_hint) VALUES(?,?,?,?,?),(?,?,?,?,?)")
   .run("c-immo",ownerUuid,"immowelt","connected","web@example.test",
        "c-mio",ownerUuid,"immomio","needs_login","immomio@example.test");
  const user={...x.user,id:ownerUuid,user_id:ownerUuid,telegram_user_id:adminId,chat_id:adminId};
  const chat={id:adminId,type:"private"};
  await handleMessage({chat,text:"/token"},user);
  let buttons=lastMessage(x).reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.slice(0,3).map(b=>b.callback_data),[
   "token:source:immoscout24","token:source:immowelt","token:source:immomio"
  ]);
  assert.match(buttons[1].text,/Verbunden/);
  assert.match(buttons[2].text,/Erneut anmelden/);
  assert.doesNotMatch(lastMessage(x).text,/refresh_token|access_token|ciphertext/i);
  const action=data=>handleCallback({
   id:"admin-"+data,data,from:{id:adminId},message:{chat,message_id:90}
  },user);
  await action("token:source:immowelt");
  assert.match(lastMessage(x).text,/web@example.test/);
  buttons=lastMessage(x).reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some(b=>b.callback_data==="token:login:immowelt"));
  assert.ok(buttons.some(b=>b.callback_data==="token:refresh:immowelt"));
  await action("token:login:immowelt");
  buttons=lastMessage(x).reply_markup.inline_keyboard.flat();
  assert.ok(buttons[0].url?.startsWith("https://login.traumwohnunghamburg.de/connect?ticket="));
  const flow=x.sqlite.prepare("SELECT provider,origin,return_target,context FROM provider_auth_flows WHERE participant_id=? AND provider='immowelt'").get(ownerUuid);
  assert.equal(flow.provider,"immowelt");
  assert.equal(flow.origin,"telegram");
  assert.equal(flow.return_target,"telegram");
  assert.equal(JSON.parse(flow.context).channel,"telegram");
  await action("token:refresh:immowelt");
  assert.ok(lastMessage(x).reply_markup.inline_keyboard[0][0].url?.startsWith("https://login.traumwohnunghamburg.de/connect?ticket="));
  await action("token");
  await action("token:source:immomio");
  assert.match(lastMessage(x).text,/immomio@example.test/);
  await action("token:refresh:immomio");
  assert.match(lastMessage(x).text,/erneut bei der Quelle an/i);
  await action("token:source:immoscout24");
  assert.match(lastMessage(x).text,/ImmoScout24/);
  await action("token:login:immoscout24");
  assert.ok(lastMessage(x).reply_markup.inline_keyboard[0][0].url?.startsWith("https://login.traumwohnunghamburg.de/connect?ticket="));
  const central=x.sqlite.prepare("SELECT count(*) AS n FROM central_oauth_flows").get();
  assert.equal(central.n,1,"existing central flow created without storing credentials in Telegram");
 }finally{x.done();}
});

test("/token and token callbacks are restricted to the existing super admin",async()=>{
 const x=setup();
 try{
  await handleMessage({chat:x.chat,text:"/token"},x.user);
  assert.equal(x.sent.filter(req=>req.method==="sendMessage").length,0);
  await handleCallback({
   id:"token-no-access",data:"token:source:immowelt",from:{id:777},
   message:{chat:x.chat,message_id:90}
  },x.user);
  assert.equal(x.sent.filter(req=>req.method==="editMessageText").length,0);
 }finally{x.done();}
});

test("unchanged Telegram callbacks avoid participant identity writes and redundant reads",async()=>{
 const x=setup();
 try{
  const queries=[];
  const original=x.d1.prepare;
  x.d1.prepare=query=>{queries.push(query);return original(query);};
  const adapter=createD1Supabase(x.d1,{});
  const payload={callback_query:{from:{id:777,first_name:"A",last_name:"B"},message:{chat:{id:777,type:"private"},message_id:44},data:"home"}};
  const result=await adapter.rpc("prepare_telegram_update",{p_payload:payload});
  assert.equal(result.error,null);
  assert.equal(result.data.user.first_name,"A");
  assert.equal(queries.filter(q=>q.includes("UPDATE participants SET telegram_chat_id")).length,0);
  assert.equal(queries.filter(q=>q.includes("SELECT * FROM participants")).length,1);
  queries.length=0;
  const modified=await adapter.rpc("prepare_telegram_update",{p_payload:{callback_query:{
   ...payload.callback_query,from:{...payload.callback_query.from,first_name:"Neuer Name"}
  }}});
  assert.equal(modified.error,null);
  assert.equal(modified.data.user.first_name,"Neuer Name");
  assert.equal(queries.filter(q=>q.includes("UPDATE participants SET telegram_chat_id")).length,1);
  assert.equal(queries.filter(q=>q.includes("SELECT * FROM participants")).length,1);
 }finally{x.done();}
});

test("persistent quick-access keyboard has Startmenü, Premium, Einstellungen and Gespeichert in a 2x2 grid",()=>{
 const keys=quickActionsKeyboard();
 assert.deepEqual(keys.keyboard.map(row=>row.map(b=>b.text)),[
  ["🏠 Startmenü","💎 Premium"],
  ["⚙️ Einstellungen","⭐ Gespeichert"],
 ]);
 assert.equal(keys.is_persistent,true);
 assert.equal(keys.resize_keyboard,true);
 assert.equal(keys.one_time_keyboard,false);
 assert.deepEqual(keys.keyboard.flat().map(b=>b.text),Object.values(QUICK_ACTIONS));
 assert.equal(keys.keyboard.flat().some(b=>/Auto-Bewerbung|Mein Profil/.test(b.text)),false);
});

test("/start upgrades shortcut order from version 4 exactly once; /commands always reinstalls",async()=>{
 const x=setup();
 try{
  x.sqlite.prepare("UPDATE participants SET reply_keyboard_version=4 WHERE id='owner'").run();
  await handleMessage({chat:x.chat,text:"/start"},x.user);
  const messages=x.sent.filter(item=>item.method==="sendMessage");
  assert.equal(messages.length,2,"quick keyboard and existing home preview are distinct Telegram messages");
  assert.equal(messages[0].body.reply_markup.is_persistent,true);
  assert.deepEqual(messages[0].body.reply_markup.keyboard.map(row=>row.map(b=>b.text)),[
   ["🏠 Startmenü","💎 Premium"],
   ["⚙️ Einstellungen","⭐ Gespeichert"],
  ]);
  assert.match(messages[0].body.text,/Schnellfunktionen sind wieder verfügbar/);
  assert.match(messages[1].body.text,/Traumwohnung Hamburg/);
  assert.deepEqual(messages[1].body.reply_markup.inline_keyboard.map(row=>row[0].callback_data),
   ["profile","platforms:profile-new","platforms"]);
  await handleMessage({chat:x.chat,text:"/start"},x.user);
  assert.equal(x.sent.filter(item=>item.method==="sendMessage"&&item.body.reply_markup?.keyboard).length,1,
   "the persistent reply keyboard must not produce another setup message on later /start");
  assert.equal(x.sqlite.prepare("SELECT reply_keyboard_version AS version FROM participants WHERE id='owner'").get().version,5);
  await handleMessage({chat:x.chat,text:"/commands"},x.user);
  const reinstalls=x.sent.filter(item=>item.method==="sendMessage"&&item.body.reply_markup?.keyboard);
  assert.equal(reinstalls.length,2,"/commands reinstalls the keyboard explicitly if the client has hidden it");
  assert.deepEqual(reinstalls[1].body.reply_markup.keyboard.map(row=>row.map(b=>b.text)),[
   ["🏠 Startmenü","💎 Premium"],
   ["⚙️ Einstellungen","⭐ Gespeichert"],
  ]);
 }finally{x.done();}
});

test("first language selection unlocks new bottom shortcuts only after onboarding",async()=>{
 const x=setup();
 try{
  const fresh={...x.user,language_selected_at:null};
  x.sqlite.exec("UPDATE participants SET language_selected_at=NULL WHERE id='owner'");
  await handleMessage({chat:x.chat,text:"/start"},fresh);
  assert.equal(x.sent.filter(item=>item.method==="sendMessage"&&item.body.reply_markup?.keyboard).length,0);
  assert.match(lastMessage(x).text,/Sprache auswählen/);
  await handleCallback({
   id:"first-language",data:"language:set:en",from:{id:777},
   message:{chat:x.chat,message_id:71}
  },fresh);
  const keys=x.sent.filter(item=>item.method==="sendMessage"&&item.body.reply_markup?.keyboard);
  assert.equal(keys.length,1);
  assert.equal(keys[0].body.reply_markup.keyboard[0][0].text,"🏠 Startmenü");
  assert.match(lastMessage(x).text,/What is it/);
  await handleCallback({
   id:"change-language",data:"language:set:de",from:{id:777},
   message:{chat:x.chat,message_id:71}
  },{...x.user,language_selected_at:new Date().toISOString()});
  assert.equal(x.sent.filter(item=>item.method==="sendMessage"&&item.body.reply_markup?.keyboard).length,1,
   "changing languages later does not send another keyboard message");
 }finally{x.done();}
});

test("all four bottom shortcuts open their existing screens and preserve subscriptions",async()=>{
 const x=setup();
 try{
  const check=async(label,content)=>{
   await handleMessage({chat:x.chat,text:label},x.user);
   assert.match(lastMessage(x).text,content,label);
   assert.equal(lastMessage(x).reply_markup?.keyboard,undefined,
    "views keep their existing inline buttons, without a duplicate reply keyboard");
  };
  await check(QUICK_ACTIONS.premium,/Traumwohnung Premium/);
  await check(QUICK_ACTIONS.home,/Traumwohnung Hamburg/);
  await check(QUICK_ACTIONS.settings,/Einstellungen/);
  await check(QUICK_ACTIONS.saved,/Gespeicherte Inserate/);
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM referral_codes WHERE participant_id='owner'").get().n,0);
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM user_subscriptions WHERE participant_id='owner'").get().n,0,
   "premium shortcut must not create or modify a subscription");
 }finally{x.done();}
});

test("quick access from a pending applicant ForceReply clears draft instead of saving button text",async()=>{
 const x=setup();
 try{
  x.sqlite.prepare("INSERT INTO applicant_profiles(participant_id,profile) VALUES('owner',?)")
   .run(JSON.stringify({first_name:"Mara"}));
  const state={_applicant_field:"first_name",_applicant_message_id:61,_applicant_prompt_message_id:62};
  x.sqlite.prepare("UPDATE participants SET telegram_state=? WHERE id='owner'").run(JSON.stringify(state));
  await handleMessage({
   chat:x.chat,text:QUICK_ACTIONS.premium,
   reply_to_message:{message_id:62,text:"__APPLICANT_FIELD__first_name"}
  },{...x.user,onboarding_state:state});
  assert.match(lastMessage(x).text,/Traumwohnung Premium/);
  assert.equal(JSON.parse(x.sqlite.prepare("SELECT profile FROM applicant_profiles WHERE participant_id='owner'").get().profile).first_name,"Mara");
  const saved=JSON.parse(x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get().telegram_state);
  assert.equal(saved._applicant_field,undefined);
  assert.ok(x.sent.some(item=>item.method==="deleteMessage"&&item.body.message_id===62));
 }finally{x.done();}
});

test("quick navigation cancels an incomplete custom-rent step before opening another menu",async()=>{
 const x=setup();
 try{
  const wizard={_step:"rent_custom",max_warm_rent:null,profile_slot:1};
  x.sqlite.prepare("UPDATE participants SET telegram_state=? WHERE id='owner'").run(JSON.stringify(wizard));
  await handleMessage({chat:x.chat,text:QUICK_ACTIONS.settings},
   {...x.user,onboarding_step:"rent_custom",onboarding_state:wizard});
  assert.match(lastMessage(x).text,/Einstellungen/);
  const saved=JSON.parse(x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get().telegram_state);
  assert.equal(saved._step,null);
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM search_profiles WHERE participant_id='owner'").get().n,0);
 }finally{x.done();}
});


test("delivered offer is saved once, displayed for the owner, and removable",async()=>{
 const x=setup();
 try{
  const delivery="00000000-0000-0000-0000-000000000111";
  const link="https://www.immobilienscout24.de/expose/123456";
  const facts={title:"Balkonwohnung in Hamburg",warm_rent:650,city:"Hamburg"};
  x.sqlite.prepare("INSERT INTO offer_identities(id,source_id,identity_hash,canonical_url,facts) VALUES(?,?,?,?,?)")
   .run("offer-111",1,"hash-111",link,JSON.stringify(facts));
  x.sqlite.prepare("INSERT INTO deliveries(id,participant_id,offer_identity_id,idempotency_key,status) VALUES(?,?,?,?,?)")
   .run(delivery,"owner","offer-111","delivery-111","sent");
  const markup={inline_keyboard:[
   [{text:"Zu ImmoScout24",url:link}],
   [{text:"⭐ Speichern",callback_data:"save:"+delivery}],
  ]};
  const tap=()=>handleCallback({id:"save-test",data:"save:"+delivery,from:{id:777},
   message:{chat:x.chat,message_id:82,photo:[{file_id:"fixture"}],reply_markup:markup}},x.user);
  await tap();
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM saved_offers WHERE participant_id='owner'").get().n,1);
  const saved=x.sqlite.prepare("SELECT canonical_url,title,warm_rent FROM saved_offers WHERE participant_id='owner'").get();
  assert.equal(saved.canonical_url,link);
  assert.match(saved.title,/Balkonwohnung/);
  assert.equal(saved.warm_rent,650);
  const editMarkup=x.sent.filter(x=>x.method==="editMessageReplyMarkup").at(-1)?.body?.reply_markup;
  assert.equal(editMarkup.inline_keyboard[1][0].text,"⭐ Gespeichert");
  await tap();
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM saved_offers WHERE participant_id='owner'").get().n,0,
   "second tap must remove the saved offer");
  assert.equal(x.sent.filter(y=>y.method==="editMessageReplyMarkup").at(-1)?.body?.reply_markup.inline_keyboard[1][0].text,"⭐ Speichern");
  await tap();
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM saved_offers WHERE participant_id='owner'").get().n,1,
   "third tap must save again without duplicates");
  assert.equal(x.sent.filter(y=>y.method==="editMessageReplyMarkup").at(-1)?.body?.reply_markup.inline_keyboard[1][0].text,"⭐ Gespeichert");
  await handleMessage({chat:x.chat,text:"/gespeichert"},x.user);
  assert.match(lastMessage(x).text,/Balkonwohnung/);
  assert.match(lastMessage(x).text,/650 €/);
  assert.ok(lastMessage(x).reply_markup.inline_keyboard.flat().some(b=>b.url===link));
  const remove=lastMessage(x).reply_markup.inline_keyboard.flat().find(b=>b.callback_data?.startsWith("saved:delete:"));
  assert.ok(remove);
  await handleCallback({id:"remove-test",data:remove.callback_data,from:{id:777},
   message:{chat:x.chat,message_id:85}},x.user);
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM saved_offers WHERE participant_id='owner'").get().n,0);
  assert.match(lastMessage(x).text,/noch keine Angebote/);
 }finally{x.done();}
});

test("save callbacks reject a delivery belonging to another participant",async()=>{
 const x=setup();
 try{
  const delivery="00000000-0000-0000-0000-000000000222";
  const link="https://www.immobilienscout24.de/expose/222";
  x.sqlite.exec("INSERT INTO participants(id,first_name,last_name,telegram_user_id) VALUES('other','C','D',888)");
  x.sqlite.prepare("INSERT INTO offer_identities(id,source_id,identity_hash,canonical_url,facts) VALUES(?,?,?,?,?)")
   .run("offer-222",1,"hash-222",link,JSON.stringify({title:"Private Wohnung"}));
  x.sqlite.prepare("INSERT INTO deliveries(id,participant_id,offer_identity_id,idempotency_key,status) VALUES(?,?,?,?,?)")
   .run(delivery,"other","offer-222","delivery-222-key","sent");
  await handleCallback({id:"cross-user",data:"save:"+delivery,from:{id:777},
   message:{chat:x.chat,message_id:93,photo:[{file_id:"fixture"}]}},x.user);
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM saved_offers").get().n,0);
 }finally{x.done();}
});

test("admin user directory is paginated and can filter Free users without flooding Telegram buttons", async()=>{
  const x=setup();
  try{
    const add=x.sqlite.prepare("INSERT INTO participants(id,first_name,last_name,telegram_user_id,telegram_chat_id,status) VALUES(?,?,?,?,?,?)");
    for(let i=0;i<22;i++)add.run("dir-"+i,"Nutzer",""+i,1000+i,1000+i,i<2?"archived":"active");
    const admin={...x.user,telegram_user_id:8538226539,chat_id:8538226539};
    const chat={id:8538226539,type:"private"};
    await handleMessage({chat,text:"/admin"},admin);
    const initial=lastMessage(x).reply_markup.inline_keyboard.flat();
    assert.ok(initial.length<=14, "admin user list must remain compact");
    assert.ok(initial.some(b=>b.callback_data==="admin:list:free:0"));
    assert.ok(initial.some(b=>b.callback_data==="admin:reset:preview"));
    assert.ok(initial.some(b=>b.callback_data==="admin:list:all:1"));
    await handleCallback({id:"filter-admin",data:"admin:list:free:1",from:{id:8538226539},message:{chat,message_id:101}},admin);
    const page=lastMessage(x);
    assert.match(page.text,/Seite 2 von/);
    assert.ok(page.reply_markup.inline_keyboard.flat().every(b=>b.callback_data!=="admin:user:dir-0"));
  }finally{x.done()}
});

test("confirmed Premium reset grants seven days only to active Free users and sends one notification",async()=>{
  const x=setup();
  try{
    const add=x.sqlite.prepare("INSERT INTO participants(id,first_name,last_name,telegram_user_id,telegram_chat_id,status,plan_override,plan_override_expires_at,referral_bonus_until) VALUES(?,?,?,?,?,?,?,?,?)");
    const future=new Date(Date.now()+10*86400000).toISOString(),past=new Date(Date.now()-86400000).toISOString();
    add.run("free-a","Free","A",1001,1001,"active",null,null,null);
    add.run("free-b","Free","B",1002,1002,"active",null,null,null);
    add.run("paid","Paid","C",1003,1003,"active",null,null,null);
    add.run("referral","Referral","D",1004,1004,"active",null,null,future);
    add.run("existing","Existing","E",1005,1005,"active","premium",future,null);
    add.run("expired","Expired","F",1006,1006,"active","premium",past,null);
    add.run("blocked","Blocked","G",1007,1007,"archived",null,null,null);
    x.sqlite.exec("INSERT INTO user_subscriptions(id,participant_id,provider,status) VALUES ('stripe-paid','paid','stripe','active')");
    const admin={...x.user,telegram_user_id:8538226539,chat_id:8538226539};
    const chat={id:8538226539,type:"private"};
    const callback=async(action)=>handleCallback({id:"reset-"+action,data:action,from:{id:8538226539},message:{chat,message_id:99}},admin);
    await callback("admin:reset:preview");
    assert.match(lastMessage(x).text,/Berechtigte aktive Free-Nutzer: <b>3<\/b>/);
    assert.ok(lastMessage(x).reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="admin:reset:confirm"));
    await callback("admin:reset:confirm");
    assert.match(lastMessage(x).text,/Neu aktiviert: 3/);
    for(const id of ["free-a","free-b","expired"]){
      const row=x.sqlite.prepare("SELECT plan_override,plan_override_expires_at FROM participants WHERE id=?").get(id);
      assert.equal(row.plan_override,"premium",id);
      const days=(Date.parse(row.plan_override_expires_at)-Date.now())/86400000;
      assert.ok(days>6.95&&days<7.01,id);
    }
    assert.equal(x.sqlite.prepare("SELECT plan_override FROM participants WHERE id='paid'").get().plan_override,null);
    assert.equal(x.sqlite.prepare("SELECT plan_override FROM participants WHERE id='referral'").get().plan_override,null);
    assert.equal(x.sqlite.prepare("SELECT plan_override_expires_at FROM participants WHERE id='existing'").get().plan_override_expires_at,future);
    assert.equal(x.sqlite.prepare("SELECT plan_override FROM participants WHERE id='blocked'").get().plan_override,null);
    const notify=x.sent.filter(item=>item.method==="sendMessage"&&[1001,1002,1006].includes(item.body.chat_id));
    assert.equal(notify.length,3);
    assert.ok(notify.every(x=>/7 Tage Premium/.test(x.body.text)));
    await callback("admin:reset:confirm");
    assert.match(lastMessage(x).text,/Neu aktiviert: 0/);
    assert.equal(x.sent.filter(item=>item.method==="sendMessage"&&[1001,1002,1006].includes(item.body.chat_id)).length,3,
      "a repeated confirmation must never resend or extend grants");
  }finally{x.done()}
});

test("AutoApply refuses Start without an active search even when applicant data is complete", async () => {
 const x=setup();
 try{
   x.sqlite.prepare("INSERT INTO applicant_profiles(participant_id,profile) VALUES('owner',?)")
     .run(JSON.stringify({
       first_name:"Anna",last_name:"Beispiel",email:"anna@example.com",
       phone:"+491700000000",street:"Testweg",house_number:"1",
       postcode:"20099",city:"Hamburg",salutation:"MS",household_type:"SINGLE",
       employment_status:"EMPLOYEE",income_range:"NOT_SPECIFIED",pets:"NONE",
       move_in_preference:"NOT_SPECIFIED",schufa_status:"NOT_SPECIFIED"
     }));
   await platformSessions({...x.user,is_premium:false},x.chat,89,"platforms:on");
   assert.equal(x.sqlite.prepare("SELECT auto_apply_enabled FROM participants WHERE id='owner'").get().auto_apply_enabled,0);
   assert.match(lastMessage(x).text,/nicht aktualisiert|nicht aktualisiert werden|konnte nicht/i);
 } finally{x.done();}
});

test("free users can activate Scout with a complete applicant and active search, without changing other accounts", async () => {
 const x=setup();
 try {
   const complete = {
     first_name:"Anna",last_name:"Beispiel",email:"anna@example.com",
     phone:"+491700000000",street:"Testweg",house_number:"1",postcode:"20099",
     city:"Hamburg",salutation:"MS",household_type:"SINGLE",
     employment_status:"EMPLOYEE",income_range:"NOT_SPECIFIED",
     pets:"NONE",move_in_preference:"NOT_SPECIFIED",schufa_status:"NOT_SPECIFIED"
   };
   x.sqlite.prepare("INSERT INTO applicant_profiles(participant_id,profile) VALUES('owner',?)")
     .run(JSON.stringify(complete));
   x.sqlite.prepare("INSERT INTO search_profiles(id,participant_id,criteria,active) VALUES('s-free','owner',?,1)")
     .run(JSON.stringify({property_types:["Wohnung"],location_mode:"all_hamburg"}));
   const user={...x.user,is_premium:false};
   await platformSessions(user,x.chat,89,"platforms:resume:1");
   assert.equal(x.sqlite.prepare("SELECT auto_apply_enabled FROM participants WHERE id='owner'").get().auto_apply_enabled,1);
   assert.deepEqual({...x.sqlite.prepare("SELECT enabled,immoscout_enabled FROM application_preferences WHERE participant_id='owner'").get()},{enabled:1,immoscout_enabled:1});
   await platformSessions(user,x.chat,89,"platforms:pause:1");
   assert.equal(x.sqlite.prepare("SELECT auto_apply_enabled FROM participants WHERE id='owner'").get().auto_apply_enabled,0);
 } finally { x.done(); }
});

test("bulk AutoApply starts and pauses all source send preferences without changing search profiles",async()=>{
 const x=setup();
 try{
  x.sqlite.prepare("INSERT INTO applicant_profiles(participant_id,profile) VALUES('owner',?)").run(JSON.stringify({
   first_name:"Anna",last_name:"B",email:"anna@example.com",phone:"+491700000000",street:"Test",house_number:"1",
   postcode:"20099",city:"Hamburg",salutation:"MS",household_type:"SINGLE",employment_status:"EMPLOYEE",
   income_range:"NOT_SPECIFIED",pets:"NONE",move_in_preference:"NOT_SPECIFIED",schufa_status:"NOT_SPECIFIED",
   wbs_status:"NOT_SPECIFIED",message_apartment:"Interesse",message_house:"Interesse",
   message_temporary_wg:"Interesse",message_swap:"Interesse"
  }));
  x.sqlite.prepare("INSERT INTO search_profiles(id,participant_id,criteria,active) VALUES('s-one','owner',?,1)")
   .run(JSON.stringify({property_types:["Wohnung"],location_mode:"all_hamburg",max_warm_rent:1200}));
  await platformSessions(x.user,x.chat,51,"platforms:on");
  assert.equal(lastMessage(x).reply_markup.inline_keyboard.at(-2).length,1);
  assert.deepEqual(lastMessage(x).reply_markup.inline_keyboard.at(-2)[0],
    {text:"Alle pausieren",callback_data:"platforms:off"});
  assert.match(lastMessage(x).text,/3 von 3 Plattformen aktiv/);
  const p=x.sqlite.prepare("SELECT immoscout_enabled,immowelt_enabled,immomio_enabled,enabled FROM application_preferences WHERE participant_id='owner'").get();
  assert.deepEqual([p.immoscout_enabled,p.immowelt_enabled,p.immomio_enabled,p.enabled],[1,1,1,1]);
  assert.equal(x.sqlite.prepare("SELECT auto_apply_enabled FROM participants WHERE id='owner'").get().auto_apply_enabled,1);
  await platformSessions(x.user,x.chat,51,"platforms:off");
  assert.deepEqual(lastMessage(x).reply_markup.inline_keyboard.at(-2)[0],
    {text:"Alle starten",callback_data:"platforms:on"});
  assert.match(lastMessage(x).text,/0 von 3 Plattformen aktiv/);
  const q=x.sqlite.prepare("SELECT immoscout_enabled,immowelt_enabled,immomio_enabled,enabled FROM application_preferences WHERE participant_id='owner'").get();
  assert.deepEqual([q.immoscout_enabled,q.immowelt_enabled,q.immomio_enabled,q.enabled],[0,0,0,0]);
  assert.equal(x.sqlite.prepare("SELECT auto_apply_enabled FROM participants WHERE id='owner'").get().auto_apply_enabled,0);
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM search_profiles").get().n,1);
 }finally{x.done()}
});

test("owner Start/Pause shows persisted personal test sender state without enabling normal sends", async () => {
  const x=setup();
  try {
    const ownerTelegramId=8538226539;
    x.sqlite.prepare("UPDATE participants SET telegram_user_id=?,telegram_chat_id=? WHERE id='owner'")
      .run(ownerTelegramId,ownerTelegramId);
    x.sqlite.prepare("INSERT INTO applicant_profiles(participant_id,profile) VALUES(?,?)").run("owner",JSON.stringify({
      first_name:"Test",last_name:"Person",salutation:"MR",email:"test@example.com",
      phone:"+491700000000",street:"Testweg",house_number:"7",postcode:"20099",
      city:"Hamburg",household_type:"SINGLE",employment_status:"EMPLOYEE",
      income_range:"1000_1500",pets:"NO",wbs_status:"NOT_SPECIFIED",
      move_in_preference:"FLEXIBLE",schufa_status:"NOT_SPECIFIED",
      message_apartment:"Interesse",message_house:"Interesse",
    }));
    const owner={...x.user,telegram_user_id:ownerTelegramId,chat_id:ownerTelegramId};
    const chat={id:ownerTelegramId,type:"private"};
    const status=()=>({
      ...x.sqlite.prepare("SELECT test_auto_apply_enabled,auto_apply_enabled FROM participants WHERE id='owner'").get(),
      ...x.sqlite.prepare("SELECT enabled,immoscout_enabled,immowelt_enabled,immomio_enabled FROM application_preferences WHERE participant_id='owner'").get(),
    });
    await platformSessions(owner,chat,22,"platforms:resume:1");
    assert.match(lastMessage(x).text,/ImmoScout24<\/b>: gestartet \(persönlicher Testversand\)/);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard[0][0].callback_data,"platforms:pause:1");
    assert.equal(status().test_auto_apply_enabled,1);
    assert.equal(status().immoscout_enabled,1);
    assert.equal(status().auto_apply_enabled,0);
    assert.equal(status().enabled,0);
    await platformSessions(owner,chat,22,"platforms:pause:1");
    assert.match(lastMessage(x).text,/ImmoScout24<\/b>: pausiert/);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard[0][0].callback_data,"platforms:resume:1");
    assert.equal(status().test_auto_apply_enabled,0);
    assert.equal(status().immoscout_enabled,0);
    await platformSessions(owner,chat,22,"platforms:on");
    assert.match(lastMessage(x).text,/Alle Quellen<\/b>: gestartet \(persönlicher Testversand\)/);
    assert.deepEqual([status().immoscout_enabled,status().immowelt_enabled,status().immomio_enabled],[1,1,1]);
    assert.equal(status().auto_apply_enabled,0);
    assert.equal(status().enabled,0);
    await platformSessions(owner,chat,22,"platforms:off");
    assert.match(lastMessage(x).text,/Alle Quellen<\/b>: pausiert/);
    assert.deepEqual([status().test_auto_apply_enabled,status().immoscout_enabled,status().immowelt_enabled,status().immomio_enabled],[0,0,0,0]);
  } finally { x.done(); }
});


test("minimal search navigation labels identify their destinations",async()=>{
  const x=setup();
  try {
    const call=async data=>{
      const row=x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get();
      const state=JSON.parse(row?.telegram_state||"{}");
      return handleCallback({id:"nav-"+data,data,from:{id:777},message:{chat:x.chat,message_id:39}},
        {...x.user,onboarding_state:state,onboarding_step:state._step||null});
    };
    await call("profile");
    assert.equal(lastMessage(x).reply_markup.inline_keyboard.at(-1)[0].text,"← Start");
    await call("new");
    await call("type:Wohnung");
    await call("loc:neighborhoods");
    let view=lastMessage(x);
    assert.match(view.text,/Seite 1 von 1/);
    assert.ok(view.reply_markup.inline_keyboard.every(row=>row.length>0),
      "single-page location menus must not produce empty Telegram button rows");
    assert.ok(view.reply_markup.inline_keyboard.flat().some(b=>b.text==="Auswahl bestätigen →"&&b.callback_data==="neighborhood:done"));
    assert.ok(view.reply_markup.inline_keyboard.flat().some(b=>b.text==="← Gebietsauswahl"&&b.callback_data==="location"));
    await call("location");
    await call("loc:boroughs");
    view=lastMessage(x);
    assert.ok(view.reply_markup.inline_keyboard.flat().some(b=>b.text==="Auswahl bestätigen →"&&b.callback_data==="borough:done"));
    await call("location");
    await call("loc:counties_sh");
    view=lastMessage(x);
    assert.match(view.text,/Seite 1 von 1/);
    assert.ok(view.reply_markup.inline_keyboard.every(row=>row.length>0));
    assert.ok(view.reply_markup.inline_keyboard.flat().some(b=>b.text==="Auswahl bestätigen →"&&b.callback_data==="sharea:done"));

    await call("types");
    await call("type:Wohnung");
    await call("loc:all");
    await call("rent:800");
    await call("rooms:2");
    await call("area:40");
    await call("profile:save");
    await call("profile");
    view=lastMessage(x);
    assert.equal(view.reply_markup.inline_keyboard.at(-1)[0].text,"← Start");
    await call("profile:view:1");
    view=lastMessage(x);
    assert.deepEqual(view.reply_markup.inline_keyboard.at(-1)[0],
      {text:"← Suchprofile",callback_data:"profile"});
    await call("profile:edit:1");
    await call("profile:edit-field:1:types");
    view=lastMessage(x);
    assert.ok(view.reply_markup.inline_keyboard.flat().some(b=>b.text==="← Suchprofil bearbeiten"&&b.callback_data==="profile:edit:1"));
  }finally{x.done()}
});

test("applicant profile back button keeps the entry screen after nested navigation",async()=>{
  const x=setup();
  try {
    const call=async data=>{
      const row=x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get();
      const state=JSON.parse(row?.telegram_state||"{}");
      return handleCallback({id:"appnav-"+data,data,from:{id:777},message:{chat:x.chat,message_id:40}},
        {...x.user,onboarding_state:state,onboarding_step:state._step||null});
    };
    await call("platforms:profile-new");
    assert.deepEqual(lastMessage(x).reply_markup.inline_keyboard.at(-1)[0],{text:"← Start",callback_data:"home"});
    await call("platforms:profile-preview");
    assert.equal(lastMessage(x).reply_markup.inline_keyboard.at(-1)[0].callback_data,"platforms:profile-return");
    await call("platforms:profile-return");
    assert.equal(lastMessage(x).reply_markup.inline_keyboard.at(-1)[0].callback_data,"home");
    await call("platforms:profile");
    assert.deepEqual(lastMessage(x).reply_markup.inline_keyboard.at(-1)[0],{text:"← Auto-Bewerbung",callback_data:"platforms"});
    await call("platforms:profile-field:salutation");
    await call("platforms:profile-return");
    assert.deepEqual(lastMessage(x).reply_markup.inline_keyboard.at(-1)[0],{text:"← Auto-Bewerbung",callback_data:"platforms"});
  }finally{x.done()}
});

test("Reset admin user selection returns to the Reset workflow, not general administration",async()=>{
  const x=setup();
  try {
    const admin={...x.user,telegram_user_id:8538226539,chat_id:8538226539};
    const chat={id:8538226539,type:"private"};
    const call=data=>handleCallback({id:"rnav-"+data,data,from:{id:8538226539},message:{chat,message_id:41}},admin);
    await handleMessage({chat,text:"/reset"},admin);
    assert.ok(lastMessage(x).reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="reset:admin:users"));
    await call("reset:admin:users");
    let buttons=lastMessage(x).reply_markup.inline_keyboard.flat();
    assert.ok(buttons.some(b=>b.callback_data==="reset:admin:user:owner"));
    assert.ok(buttons.some(b=>b.text==="← Resets"&&b.callback_data==="reset:admin:menu"));
    await call("reset:admin:user:owner");
    buttons=lastMessage(x).reply_markup.inline_keyboard.flat();
    assert.deepEqual(buttons.map(b=>b.callback_data),["reset:admin:grant:owner:reset","reset:admin:users"]);
    await call("reset:admin:grant:owner:reset");
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM usage_reset_credits WHERE participant_id='owner' AND grant_key LIKE 'user:%'").get().n,1);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard.at(-1)[0].callback_data,"reset:admin:users");
    await call("reset:admin:users");
    await call("reset:admin:menu");
    assert.match(lastMessage(x).text,/Admin · Premium-Resets/);
  }finally{x.done()}
});


test("Telegram search profile can select all Berlin and links only the Berlin MCP source", async () => {
  const x = setup();
  try {
    const call=async data => {
      const state=JSON.parse(x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get().telegram_state);
      return handleCallback({id:"berlin-"+data,data,from:{id:777},
        message:{chat:x.chat,message_id:88}},
        {...x.user,onboarding_state:state,onboarding_step:state._step||null});
    };
    await call("new");
    await call("type:Wohnung");
    await call("location");
    let buttons=lastMessage(x).reply_markup.inline_keyboard.flat().map(b=>b.callback_data);
    for(const action of ["loc:all_be","loc:boroughs_be","loc:localities_be"]) assert.ok(buttons.includes(action));
    await call("loc:all_be");
    await call("rent:1000");
    await call("rooms:2");
    await call("area:40");
    await call("profile:save");
    const saved=x.sqlite.prepare("SELECT criteria FROM search_profiles WHERE participant_id='owner' AND profile_slot=1").get();
    assert.equal(JSON.parse(saved.criteria).location_mode,"all_berlin");
    const linked=x.sqlite.prepare("SELECT source_id FROM source_links ORDER BY source_id").all().map(x=>x.source_id);
    assert.deepEqual(linked,[72],"Berlin profiles must not link Hamburg or SH sources");
    await call("profile:view:1");
    assert.match(lastMessage(x).text,/Ganz Berlin/);
  } finally { x.done(); }
});

test("Telegram Berlin districts and 97 Ortsteile are selectable with pagination", async () => {
  const x=setup();
  try{
    const call=async data=>{
      const state=JSON.parse(x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get().telegram_state);
      return handleCallback({id:"berlin-area-"+data,data,from:{id:777},
        message:{chat:x.chat,message_id:89}},
        {...x.user,onboarding_state:state,onboarding_step:state._step||null});
    };
    await call("new");
    await call("type:Wohnung");
    await call("loc:boroughs_be");
    assert.match(lastMessage(x).text,/Berliner Bezirke/);
    await call("berlinarea:2");
    await call("berlinarea:done");
    let state=JSON.parse(x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get().telegram_state);
    assert.deepEqual(state.berlin_boroughs,["Pankow"]);
    await call("location");
    await call("loc:localities_be");
    let view=lastMessage(x);
    assert.match(view.text,/Seite 1 von 5/);
    assert.ok(view.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="berlinarea:next"));
    await call("berlinarea:prev");
    await call("berlinarea:next");
    await call("berlinarea:20");
    await call("berlinarea:done");
    state=JSON.parse(x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get().telegram_state);
    assert.equal(state.location_mode,"berlin_localities");
    assert.equal(state.berlin_localities.length,1);
  }finally{x.done()}
});
