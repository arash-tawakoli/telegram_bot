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
  sqlite.exec("CREATE TABLE IF NOT EXISTS coach_geo_snapshot(id TEXT PRIMARY KEY,payload TEXT NOT NULL)");
  sqlite.prepare("INSERT INTO coach_geo_snapshot(id,payload) VALUES('de-hh-sh',?)").run(JSON.stringify({
    boroughs:[{id:1,name:"Hamburg-Mitte"}],
    neighborhoods:[{id:1,name:"Altstadt",borough_id:1}],
    schleswigHolsteinAreas:[{code:"01002",name:"Kiel"}],
  }));
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
    assert.match(lastMessage(x).text,/nicht direkt buchbar/);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard.some(row=>/Premium abonnieren/.test(row[0].text)),false);
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
    assert.ok(!keys.includes("platforms:profile-field:wbs_status"));
    assert.ok(keys.includes("platforms:profile-texts"));
    assert.ok(keys.includes("platforms:profile-preview"));
    assert.ok(!keys.includes("platforms:docs"));
    assert.doesNotMatch(lastMessage(x).text, /Profilstatus|Dokumente:/);
    await callback("platforms:profile-field:salutation");
    assert.match(lastMessage(x).text, /Anrede/);
    await callback("platforms:profile-set:salutation:MR");
    const raw = x.sqlite.prepare("SELECT profile FROM applicant_profiles WHERE participant_id='owner'").get()?.profile;
    assert.equal(JSON.parse(raw).salutation, "MR");
    await callback("platforms:profile-texts");
    assert.match(lastMessage(x).text, /Bewerbungstext/);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard[0][0].callback_data, "platforms:profile-text:message_apartment");
    await callback("platforms:profile-text:message_apartment");
    assert.match(lastMessage(x).text, /Wohnung/);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard.at(-1)[0].callback_data, "platforms:profile-texts");
    await callback("platforms:profile-preview");
    assert.match(lastMessage(x).text, /Profilvorschau/);
    assert.match(lastMessage(x).text, /Anrede:/);
    assert.doesNotMatch(lastMessage(x).text,/WBS-Status/);
    assert.equal(lastMessage(x).reply_markup.inline_keyboard.at(-1)[0].callback_data, "platforms:profile");
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
   assert.equal(prompt.reply_markup.inline_keyboard[0][0].callback_data,"platforms:profile");
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
    const controls = lastMessage(x).reply_markup.inline_keyboard.flat().map(b => b.callback_data);
    assert.ok(controls.includes("platforms:test-status"), "test access was a no-op");
    assert.ok(controls.includes("platforms:login:3"), "Immomio login missing");
    assert.ok(controls.includes("platforms:login:4"), "Immowelt login missing");
    assert.ok(controls.includes("platforms:test:off"), "deactivation missing");
    assert.ok(controls.includes("home"), "back to start missing");
    assert.ok(!controls.includes("platforms:on"), "normal auto-apply must remain disabled in test mode");
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

test("ImmoScout and Immowelt connection buttons create single-use HTTPS login links", async () => {
  const x = setup();
  try {
    for (const [source, provider] of [[1, "immoscout24"], [4, "immowelt"]]) {
      await platformSessions(x.user, x.chat, 23, "platforms:login:" + source);
      const first = lastMessage(x).reply_markup.inline_keyboard[0][0];
      assert.match(first.url, /^https:\/\/login\.traumwohnunghamburg\.de\/connect\?ticket=/);
      assert.equal(first.web_app, undefined);
      const row = x.sqlite.prepare("SELECT status FROM provider_connections WHERE participant_id='owner' AND provider=?").get(provider);
      assert.equal(row.status, "pending");
      assert.equal(x.sqlite.prepare("SELECT count(*) AS n FROM provider_auth_flows WHERE participant_id='owner' AND provider=? AND consumed_at IS NULL").get(provider).n, 1);
    }
  } finally { x.done(); }
});

test("Immomio connect action presents an external OAuth link without changing application status", async () => {
  const x = setup();
  const savedFetch = globalThis.fetch;
  try {
    x.sqlite.exec("INSERT INTO applicant_profiles(participant_id,profile) VALUES('owner','{\"email\":\"test@example.org\"}')");
    globalThis.fetch = async (target, options) => {
      if (String(target) === "https://gql-ps.immomio.com/tenant/graphql")
        return Response.json({ data: { sso: { baseUrl: "https://sso.immomio.com" } } });
      return savedFetch(target, options);
    };
    await platformSessions(x.user, x.chat, 24, "platforms:login:3");
    const row = lastMessage(x).reply_markup.inline_keyboard[0][0];
    assert.match(row.url, /^https:\/\/sso\.immomio\.com\/auth\/realms\/immomio\//);
    assert.equal(row.web_app, undefined);
    assert.equal(x.sqlite.prepare("SELECT status FROM provider_connections WHERE participant_id='owner' AND provider='immomio'").get().status, "pending");
    assert.equal(x.sqlite.prepare("SELECT count(*) AS n FROM applications").get().n, 0);
  } finally { globalThis.fetch = savedFetch; x.done(); }
});

test("application text reply flow saves edits and expands first name in the preview", async () => {
  const x = setup();
  try {
    x.sqlite.prepare("INSERT INTO applicant_profiles(participant_id,profile) VALUES('owner',?)")
      .run(JSON.stringify({first_name:"Nora",last_name:"Mustermann",message_apartment:"Hallo [[Vorname]]"}));
    await platformSessions(x.user,x.chat,42,"platforms:profile-text:message_apartment");
    assert.match(lastMessage(x).text,/Hallo Nora/);
    assert.doesNotMatch(lastMessage(x).text,/\[\[Vorname\]\]/);

    await handleCallback({
      id:"cb-edit-text", data:"platforms:profile-field:message_apartment",
      from:{id:777},message:{chat:x.chat,message_id:42},
    },x.user);
    const prompt = lastMessage(x);
    assert.equal(prompt.reply_markup.force_reply,true);
    assert.match(prompt.text,/Schreibe oder passe deinen Bewerbungstext/);

    const state=JSON.parse(x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get().telegram_state);
    assert.equal(state._applicant_field,"message_apartment");
    await handleAutoApplyMessage({...x.user,onboarding_state:state},{
      chat:x.chat,message_id:505,text:"Sehr geehrte Damen und Herren, ich bin [[Vorname]].",
      reply_to_message:{text:prompt.text,message_id:504},
    });
    const saved=JSON.parse(x.sqlite.prepare("SELECT profile FROM applicant_profiles WHERE participant_id='owner'").get().profile);
    assert.equal(saved.message_apartment,"Sehr geehrte Damen und Herren, ich bin [[Vorname]].");
    assert.match(lastMessage(x).text,/Sehr geehrte Damen und Herren, ich bin Nora/);
    await platformSessions(x.user,x.chat,42,"platforms:profile-text:message_apartment");
    assert.match(lastMessage(x).text,/ich bin Nora/);
  }finally{x.done();}
});

test("applicant confetti occurs once after both identity fields are first saved",async()=>{
 const x=setup();
 try{
  const callback=async data=>{
   const state=JSON.parse(x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get().telegram_state);
   return handleCallback({id:"cb-"+data,data,from:{id:777},message:{chat:x.chat,message_id:31}},
     {...x.user,onboarding_state:state,onboarding_step:state._step||null});
  };
  const fill=async (field,value)=>{
   await callback("platforms:profile-field:"+field);
   const state=JSON.parse(x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get().telegram_state);
   await handleAutoApplyMessage({...x.user,onboarding_state:state},{
    chat:x.chat,message_id:90,text:value,
   });
  };
  await callback("platforms:profile-new");
  assert.equal(x.sent.filter(req=>req.body?.message_effect_id).length,0);
  await fill("first_name","Nora");
  assert.equal(x.sent.filter(req=>req.body?.message_effect_id).length,0);
  await fill("last_name","Mustermann");
  assert.equal(x.sent.filter(req=>req.body?.message_effect_id==="5046509860389126442").length,1);
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM telegram_profile_milestones WHERE participant_id='owner' AND profile_type='applicant'").get().n,1);
  await fill("first_name","Norah");
  assert.equal(x.sent.filter(req=>req.body?.message_effect_id==="5046509860389126442").length,1);
 }finally{x.done();}
});

test("first search profile save sends one Telegram native celebration, not repeated",async()=>{
 const x=setup();
 try{
   const callback=async data=>{
     const state=JSON.parse(x.sqlite.prepare("SELECT telegram_state FROM participants WHERE id='owner'").get().telegram_state);
     return handleCallback({id:"cb-"+data,data,from:{id:777},message:{chat:x.chat,message_id:71}},
       {...x.user,onboarding_state:state,onboarding_step:state._step||null});
   };
   for(const action of ["new","type:Wohnung","loc:all","rent:800","rooms:2","area:40","profile:save"])
     await callback(action);
   assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM search_profiles WHERE participant_id='owner'").get().n,1);
   assert.equal(x.sent.filter(req=>req.body?.message_effect_id==="5046509860389126442").length,1);
   await callback("profile:save");
   assert.equal(x.sent.filter(req=>req.body?.message_effect_id==="5046509860389126442").length,1);
 }finally{x.done();}
});
