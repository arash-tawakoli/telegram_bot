// supabase/functions/telegram-ui/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// supabase/functions/telegram-ui/runtime.js
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
var SUPABASE_URL = Deno.env.get("SUPABASE_URL");
var SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
var SERVICE_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
var db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
var PREMIUM_LINK = "https://buy.stripe.com/dRm9AM7DSajfgYK2qVfYY01";
var PROPERTY_TYPES = [
  "Wohnung",
  "Haus",
  "WG",
  "Tauschwohnung"
];
var RENT_PRESETS = /* @__PURE__ */ new Set([800, 1e3, 1250, 2e3]);
var ROOM_PRESETS = /* @__PURE__ */ new Set([1, 2, 3, 4]);
var AREA_PRESETS = /* @__PURE__ */ new Set([20, 50, 70, 90]);
var NEIGHBORHOODS_PER_PAGE = 10;
var SAVED_PAGE_SIZE = 8;
var SECRET_TTL_MS = 5 * 6e4;
var GEO_TTL_MS = 30 * 6e4;
var ADMIN_TELEGRAM_USER_IDS = /* @__PURE__ */ new Set([8538226539, 414638980]);
var secretCache = /* @__PURE__ */ new Map();
var chatLanguages = /* @__PURE__ */ new Map();
var geoCache = null;
function finiteOrNull(value) {
  if (value == null || value === "")
    return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function money(value) {
  if (value == null || value === "")
    return "\u2013";
  const number = Number(value);
  return Number.isFinite(number) ? `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(number)} \u20AC` : String(value);
}
function short(value, max = 45) {
  const text = String(value || "Inserat").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
}
function button(text, callbackData) {
  return { text, callback_data: callbackData };
}
function cancelRow() {
  return [button("\u2716\uFE0F Abbrechen", "cancel")];
}
function backRow(callbackData, nextCallbackData) {
  const row = [button("\u2190 Zur\xFCck", callbackData)];
  if (nextCallbackData)
    row.push(button("Weiter \u2192", nextCallbackData));
  return row;
}
async function secret(name, force = false) {
  const cached = secretCache.get(name);
  if (!force && cached && cached.expiresAt > Date.now())
    return cached.value;
  const { data, error } = await db.rpc("get_bot_secret", {
    secret_name: name
  });
  if (error || !data)
    throw new Error(`secret ${name} unavailable`);
  const value = String(data);
  secretCache.set(name, { value, expiresAt: Date.now() + SECRET_TTL_MS });
  return value;
}
async function telegram(method, body, retry = true) {
  const token = await secret("telegram_bot_token_runtime");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    signal: AbortSignal.timeout(2e4),
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if ((!response.ok || !result.ok) && response.status === 401 && retry) {
    secretCache.delete("telegram_bot_token_runtime");
    return telegram(method, body, false);
  }
  if (!response.ok || !result.ok) {
    throw new Error(String(result?.description || `Telegram ${response.status}`));
  }
  return result.result;
}
function send(chatId, text, replyMarkup) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text: localizeText(text, chatLanguages.get(chatId)),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: localizeMarkup(replyMarkup, chatLanguages.get(chatId))
  });
}
var PARTY_EFFECT_ID = "5046509860389126442";
async function sendCelebration(chatId, text, replyMarkup) {
  const language = chatLanguages.get(chatId);
  try {
    return await telegram("sendMessage", {
      chat_id: chatId,
      text: localizeText(text, language),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: localizeMarkup(replyMarkup, language),
      message_effect_id: PARTY_EFFECT_ID
    });
  } catch {
    return send(chatId, text, replyMarkup);
  }
}
async function edit(chatId, messageId, text, replyMarkup) {
  try {
    return await telegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: localizeText(text, chatLanguages.get(chatId)),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: localizeMarkup(replyMarkup, chatLanguages.get(chatId))
    });
  } catch {
    return send(chatId, text, replyMarkup);
  }
}
function premiumPreviewUrl() {
  return `${SUPABASE_URL}/functions/v1/telegram-premium-image?v=20260903hd4`;
}
async function sendPremiumPreview(chatId, caption, replyMarkup) {
  const language = chatLanguages.get(chatId);
  return telegram("sendPhoto", {
    chat_id: chatId,
    photo: premiumPreviewUrl(),
    caption: localizeText(caption, language),
    parse_mode: "HTML",
    reply_markup: localizeMarkup(replyMarkup, language)
  });
}
async function editPremiumPreview(chatId, messageId, caption, replyMarkup) {
  const language = chatLanguages.get(chatId);
  return telegram("editMessageMedia", {
    chat_id: chatId,
    message_id: messageId,
    media: {
      type: "photo",
      media: premiumPreviewUrl(),
      caption: localizeText(caption, language),
      parse_mode: "HTML"
    },
    reply_markup: localizeMarkup(replyMarkup, language)
  });
}
async function acknowledge(id, text) {
  try {
    await telegram("answerCallbackQuery", { callback_query_id: id, text });
  } catch {
  }
}
async function withPlan(user, subscription = void 0) {
  if (subscription === void 0) {
    const { data, error } = await db.from("user_subscriptions").select("status,current_period_end,cancel_at_period_end").eq("user_id", user.id).maybeSingle();
    if (error)
      throw error;
    subscription = data;
  }
  const now = Date.now();
  const premium2 = user.plan_override === "free" ? false : user.plan_override === "premium" && (!user.plan_override_expires_at || new Date(user.plan_override_expires_at).getTime() > now) || !!user.referral_bonus_until && new Date(user.referral_bonus_until).getTime() > now || !!subscription && ["active", "trialing"].includes(String(subscription.status)) && (!subscription.current_period_end || new Date(subscription.current_period_end).getTime() > now);
  return { ...user, is_premium: !!premium2, subscription };
}
async function saveState(userId, step, draft) {
  const { error } = await db.from("bot_users").update({
    onboarding_step: step,
    onboarding_state: draft,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  }).eq("id", userId);
  if (error)
    throw error;
}
async function geography() {
  if (geoCache && geoCache.expiresAt > Date.now())
    return geoCache.value;
  const [boroughResult, neighborhoodResult] = await Promise.all([
    db.from("hamburg_boroughs").select("id,name,sort_order").order("sort_order"),
    db.from("hamburg_neighborhoods").select("id,name,borough_id").order("id")
  ]);
  if (boroughResult.error)
    throw boroughResult.error;
  if (neighborhoodResult.error)
    throw neighborhoodResult.error;
  const value = {
    boroughs: boroughResult.data || [],
    neighborhoods: neighborhoodResult.data || []
  };
  geoCache = { value, expiresAt: Date.now() + GEO_TTL_MS };
  return value;
}
var HELP_TEXT = "\u2753 <b>Hilfe & Befehle</b>\n\n\u{1F3E0} /start \u2013 Startmen\xFC\n\u{1F50E} /suche \u2013 Suchprofil erstellen oder ersetzen\n\u{1F464} /profile \u2013 Suchprofil anzeigen\n\u2B50\uFE0F /gespeichert \u2013 gespeicherte Inserate\n\u2699\uFE0F /einstellungen \u2013 Einstellungen\n\u23F8 /pause \u2013 Suche pausieren\n\u25B6\uFE0F /resume \u2013 Suche fortsetzen\n\u{1F4E1} /status \u2013 Systemstatus\n\u{1F48E} /premium \u2013 Premium anzeigen\n\u2753 /hilfe \u2013 Hilfe";
async function finishUpdate(updateId, attempt, success, error = null) {
  const { data, error: rpcError } = await db.rpc("finish_telegram_update", { p_update_id: updateId, p_attempt: attempt, p_success: success, p_error: error });
  if (rpcError) throw rpcError;
  if (!data) throw new Error("Telegram update lease lost");
}

// supabase/functions/telegram-ui/profiles.js
function emptyDraft(profileSlot = 1) {
  return {
    profile_slot: Math.max(1, Math.min(3, Number(profileSlot) || 1)),
    property_types: [],
    location_mode: null,
    borough_ids: [],
    neighborhood_ids: [],
    neighborhood_page: 0,
    max_warm_rent: null,
    min_rooms: null,
    min_area_sqm: null
  };
}
function normalizeDraft(raw) {
  const propertyTypes = Array.isArray(raw?.property_types) ? raw.property_types.filter((value) => PROPERTY_TYPES.includes(String(value))) : raw?.type && PROPERTY_TYPES.includes(String(raw.type)) ? [String(raw.type)] : [];
  const legacyMode = raw?.mode === "all_hamburg" ? "all_hamburg" : raw?.mode === "neighborhoods" ? "neighborhoods" : null;
  return {
    profile_slot: Math.max(1, Math.min(3, Number(raw?.profile_slot) || 1)),
    property_types: Array.from(new Set(propertyTypes)),
    location_mode: ["all_hamburg", "boroughs", "neighborhoods"].includes(String(raw?.location_mode || "")) ? raw.location_mode : legacyMode,
    borough_ids: Array.isArray(raw?.borough_ids) ? raw.borough_ids.map(Number).filter(Number.isFinite) : [],
    neighborhood_ids: Array.isArray(raw?.neighborhood_ids) ? raw.neighborhood_ids.map(Number).filter(Number.isFinite) : [],
    neighborhood_page: Number.isFinite(Number(raw?.neighborhood_page)) ? Math.max(0, Number(raw.neighborhood_page)) : 0,
    max_warm_rent: finiteOrNull(raw?.max_warm_rent ?? raw?.rent),
    min_rooms: finiteOrNull(raw?.min_rooms ?? raw?.rooms),
    min_area_sqm: finiteOrNull(raw?.min_area_sqm ?? raw?.area),
    edit_return: raw?.edit_return === true,
    profile_edit: raw?.profile_edit === true
  };
}
function draftFor(user) {
  return normalizeDraft(user?.onboarding_state || {});
}
function validateDraft(draft) {
  if (!draft.property_types.length)
    return "types";
  if (!draft.location_mode)
    return "location";
  if (draft.location_mode === "boroughs" && !draft.borough_ids.length) {
    return "boroughs";
  }
  if (draft.location_mode === "neighborhoods" && !draft.neighborhood_ids.length) {
    return "neighborhoods";
  }
  if (draft.max_warm_rent == null || draft.max_warm_rent < 100 || draft.max_warm_rent > 5e3) {
    return "rent";
  }
  if (draft.min_rooms == null || !ROOM_PRESETS.has(draft.min_rooms)) {
    return "rooms";
  }
  if (draft.min_area_sqm == null || !AREA_PRESETS.has(draft.min_area_sqm)) {
    return "area";
  }
  return null;
}
async function renderTypes(user, chatId, messageId, draft) {
  await saveState(user.id, "types", draft);
  const rows = PROPERTY_TYPES.map((value) => [
    button(`${draft.property_types.includes(value) ? "\u2705 " : ""}${value}`, `type:${value}`)
  ]);
  rows.push([
    button("Alle ausw\xE4hlen", "type:all"),
    button("Auswahl l\xF6schen", "type:clear")
  ], backRow(draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "home", "type:done"), cancelRow());
  const text = "1/5 \xB7 <b>Was suchst du?</b>\n\nW\xE4hle eine oder mehrere Wohnungsarten.";
  return messageId ? edit(chatId, messageId, text, { inline_keyboard: rows }) : send(chatId, text, { inline_keyboard: rows });
}
async function renderLocation(user, chatId, messageId, draft) {
  await saveState(user.id, "location", draft);
  return edit(chatId, messageId, "2/5 \xB7 <b>Wo m\xF6chtest du suchen?</b>", {
    inline_keyboard: [
      [button(`${draft.location_mode === "all_hamburg" ? "\u2705 " : ""}\u{1F310} Ganz Hamburg`, "loc:all")],
      [button(`${draft.location_mode === "boroughs" ? "\u2705 " : ""}\u{1F3D9} Bezirke ausw\xE4hlen`, "loc:boroughs")],
      [button(`${draft.location_mode === "neighborhoods" ? "\u2705 " : ""}\u{1F4CD} Stadtteile ausw\xE4hlen`, "loc:neighborhoods")],
      backRow(draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "types"),
      cancelRow()
    ]
  });
}
async function renderBoroughs(user, chatId, messageId, draft) {
  const geo = await geography();
  await saveState(user.id, "boroughs", draft);
  const rows = [];
  for (let index = 0; index < geo.boroughs.length; index += 2) {
    rows.push(geo.boroughs.slice(index, index + 2).map((borough) => button(`${draft.borough_ids.includes(borough.id) ? "\u2705 " : ""}${borough.name}`, `borough:${borough.id}`)));
  }
  rows.push([
    button("Alle ausw\xE4hlen", "borough:all"),
    button("Auswahl l\xF6schen", "borough:clear")
  ], backRow("location", "borough:done"), cancelRow());
  return edit(chatId, messageId, "2/5 \xB7 <b>Hamburger Bezirke</b>\n\nW\xE4hle einen oder mehrere der 7 Bezirke.", { inline_keyboard: rows });
}
async function renderNeighborhoods(user, chatId, messageId, draft) {
  const geo = await geography();
  const pages = Math.max(1, Math.ceil(geo.neighborhoods.length / NEIGHBORHOODS_PER_PAGE));
  const page = Math.max(0, Math.min(draft.neighborhood_page, pages - 1));
  draft.neighborhood_page = page;
  await saveState(user.id, "neighborhoods", draft);
  const entries = geo.neighborhoods.slice(page * NEIGHBORHOODS_PER_PAGE, (page + 1) * NEIGHBORHOODS_PER_PAGE);
  const rows = [];
  for (let index = 0; index < entries.length; index += 2) {
    rows.push(entries.slice(index, index + 2).map((neighborhood) => button(`${draft.neighborhood_ids.includes(neighborhood.id) ? "\u2705 " : ""}${neighborhood.name}`, `neighborhood:${neighborhood.id}`)));
  }
  rows.push([
    button("Alle ausw\xE4hlen", "neighborhood:all"),
    button("Auswahl l\xF6schen", "neighborhood:clear")
  ], [
    button("\u2190", "neighborhood:prev"),
    button(`${page + 1}/${pages}`, "noop"),
    button("\u2192", "neighborhood:next")
  ], backRow("location", "neighborhood:done"), cancelRow());
  return edit(chatId, messageId, `2/5 \xB7 <b>Hamburger Stadtteile</b>

W\xE4hle beliebig viele Stadtteile.

<b>${draft.neighborhood_ids.length}/${geo.neighborhoods.length} ausgew\xE4hlt</b>`, { inline_keyboard: rows });
}
async function renderRent(user, chatId, messageId, draft) {
  await saveState(user.id, "rent", draft);
  const customSelected = draft.max_warm_rent != null && !RENT_PRESETS.has(draft.max_warm_rent);
  return edit(chatId, messageId, "3/5 \xB7 <b>Maximale Warmmiete</b>", {
    inline_keyboard: [
      [
        button(`${draft.max_warm_rent === 800 ? "\u2705 " : ""}800 \u20AC`, "rent:800"),
        button(`${draft.max_warm_rent === 1e3 ? "\u2705 " : ""}1.000 \u20AC`, "rent:1000")
      ],
      [
        button(`${draft.max_warm_rent === 1250 ? "\u2705 " : ""}1.250 \u20AC`, "rent:1250"),
        button(`${draft.max_warm_rent === 2e3 ? "\u2705 " : ""}2.000 \u20AC`, "rent:2000")
      ],
      [button(customSelected ? `\u2705 Eigener Betrag \xB7 ${money(draft.max_warm_rent)}` : "\u270F\uFE0F Eigener Betrag", "rent:custom")],
      backRow(draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "location"),
      cancelRow()
    ]
  });
}
async function renderCustomRent(user, chatId, messageId, draft) {
  await saveState(user.id, "rent_custom", draft);
  const current = draft.max_warm_rent != null ? `

Aktuell gespeichert: <b>${esc(money(draft.max_warm_rent))}</b>` : "";
  return edit(chatId, messageId, `Gib die maximale Warmmiete als Zahl ein, z. B. <code>1250</code>.

<b>Erlaubt: 100 bis 5.000 \u20AC</b>${current}`, { inline_keyboard: [backRow("rent"), cancelRow()] });
}
async function renderRooms(user, chatId, messageId, draft) {
  await saveState(user.id, "rooms", draft);
  return edit(chatId, messageId, "4/5 \xB7 <b>Mindestens wie viele Zimmer?</b>", {
    inline_keyboard: [
      [
        button(`${draft.min_rooms === 1 ? "\u2705 " : ""}1+`, "rooms:1"),
        button(`${draft.min_rooms === 2 ? "\u2705 " : ""}2+`, "rooms:2")
      ],
      [
        button(`${draft.min_rooms === 3 ? "\u2705 " : ""}3+`, "rooms:3"),
        button(`${draft.min_rooms === 4 ? "\u2705 " : ""}4+`, "rooms:4")
      ],
      backRow(draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "rent"),
      cancelRow()
    ]
  });
}
async function renderArea(user, chatId, messageId, draft) {
  await saveState(user.id, "area", draft);
  return edit(chatId, messageId, "5/5 \xB7 <b>Mindestfl\xE4che</b>", {
    inline_keyboard: [
      [
        button(`${draft.min_area_sqm === 20 ? "\u2705 " : ""}20 m\xB2`, "area:20"),
        button(`${draft.min_area_sqm === 50 ? "\u2705 " : ""}50 m\xB2`, "area:50")
      ],
      [
        button(`${draft.min_area_sqm === 70 ? "\u2705 " : ""}70 m\xB2`, "area:70"),
        button(`${draft.min_area_sqm === 90 ? "\u2705 " : ""}90 m\xB2`, "area:90")
      ],
      backRow(draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "rooms"),
      cancelRow()
    ]
  });
}
async function selectedPlaces(draft) {
  const geo = await geography();
  if (draft.location_mode === "boroughs") {
    const selectedIds = new Set(draft.borough_ids);
    const boroughs = geo.boroughs.filter((value) => selectedIds.has(value.id)).map((value) => value.name);
    const districts = geo.neighborhoods.filter((value) => selectedIds.has(value.borough_id)).map((value) => value.name);
    return {
      location: boroughs.join(", "),
      districts,
      boroughs,
      neighborhoods: []
    };
  }
  if (draft.location_mode === "neighborhoods") {
    const selectedIds = new Set(draft.neighborhood_ids);
    const selected = geo.neighborhoods.filter((value) => selectedIds.has(value.id));
    const neighborhoods = selected.map((value) => value.name);
    const boroughIdSet = new Set(selected.map((value) => value.borough_id));
    const boroughs = geo.boroughs.filter((value) => boroughIdSet.has(value.id)).map((value) => value.name);
    const location = neighborhoods.length > 12 ? `${neighborhoods.slice(0, 12).join(", ")} \u2026 (+${neighborhoods.length - 12})` : neighborhoods.join(", ");
    return {
      location,
      districts: neighborhoods,
      boroughs,
      neighborhoods
    };
  }
  return {
    location: "Ganz Hamburg",
    districts: ["Ganz Hamburg"],
    boroughs: [],
    neighborhoods: []
  };
}
async function renderReview(user, chatId, messageId, draft) {
  const issue = validateDraft(draft);
  if (issue)
    return renderStep(user, chatId, messageId, draft, issue);
  const places = await selectedPlaces(draft);
  await saveState(user.id, "review", draft);
  const text = `\u2705 <b>Suchprofil pr\xFCfen</b>

\u{1F3E0} <b>Typ:</b> ${esc(draft.property_types.join(", "))}
\u{1F4CD} <b>Gebiet:</b> ${esc(places.location)}
\u{1F4B6} <b>Warmmiete:</b> bis ${esc(money(draft.max_warm_rent))}
\u{1F6AA} <b>Zimmer:</b> ${esc(draft.min_rooms)}+
\u{1F4D0} <b>Fl\xE4che:</b> ${esc(draft.min_area_sqm)} m\xB2+`;
  return edit(chatId, messageId, text, {
    inline_keyboard: [
      [button("\u2705 Suche aktivieren", "profile:save")],
      [button("\u{1F3E0} Typ", "edit:types"), button("\u{1F4CD} Gebiet", "edit:location")],
      [button("\u{1F4B6} Miete", "edit:rent"), button("\u{1F6AA} Zimmer", "edit:rooms")],
      [button("\u{1F4D0} Fl\xE4che", "edit:area")],
      backRow("area"),
      cancelRow()
    ]
  });
}
function renderStep(user, chatId, messageId, draft, step) {
  if (step === "types")
    return renderTypes(user, chatId, messageId, draft);
  if (step === "location")
    return renderLocation(user, chatId, messageId, draft);
  if (step === "boroughs")
    return renderBoroughs(user, chatId, messageId, draft);
  if (step === "neighborhoods") {
    return renderNeighborhoods(user, chatId, messageId, draft);
  }
  if (step === "rent")
    return renderRent(user, chatId, messageId, draft);
  if (step === "rent_custom") {
    return renderCustomRent(user, chatId, messageId, draft);
  }
  if (step === "rooms")
    return renderRooms(user, chatId, messageId, draft);
  if (step === "area")
    return renderArea(user, chatId, messageId, draft);
  return renderReview(user, chatId, messageId, draft);
}
async function afterSelection(user, chatId, messageId, draft, next) {
  if (draft.profile_edit) {
    const slot = draft.profile_slot;
    delete draft.profile_edit;
    delete draft.edit_return;
    await persistProfile(user, draft);
    return profile(user, chatId, messageId, slot);
  }
  if (draft.edit_return) {
    delete draft.edit_return;
    return renderReview(user, chatId, messageId, draft);
  }
  return renderStep(user, chatId, messageId, draft, next);
}
async function persistProfile(user, draft) {
  const issue = validateDraft(draft);
  if (issue)
    throw new Error(`incomplete profile: ${issue}`);
  const places = await selectedPlaces(draft);
  const slot = Math.max(1, Math.min(profileLimit(user), Number(draft.profile_slot) || 1));
  const { count: profileCount, error: profileCountError } = await db.from("search_profiles").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if (profileCountError)
    throw profileCountError;
  const { error } = await db.from("search_profiles").upsert({
    user_id: user.id,
    profile_slot: slot,
    name: slot === 1 ? "Meine Suche" : `Meine Suche ${slot}`,
    property_types: draft.property_types,
    location_mode: draft.location_mode,
    districts: places.districts,
    boroughs: places.boroughs,
    neighborhoods: places.neighborhoods,
    max_warm_rent: draft.max_warm_rent,
    min_rooms: draft.min_rooms,
    min_area_sqm: draft.min_area_sqm,
    wbs_only: false,
    furnished_preference: "any",
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  }, { onConflict: "user_id,profile_slot" });
  if (error)
    throw error;
  await saveState(user.id, null, {});
  if (true) {
    const { data: referralReward, error: referralError } = await db.rpc("complete_referral_reward", { p_referred_user_id: user.id });
    if (referralError)
      throw referralError;
    return referralReward || null;
  }
  return null;
}
function profileLimit(user) {
  return user.is_premium ? 3 : 1;
}
function profileLocation(current) {
  return current.location_mode === "all_hamburg" ? "Ganz Hamburg" : current.location_mode === "boroughs" ? (current.boroughs || []).join(", ") || "Hamburg" : (current.neighborhoods || []).join(", ") || (current.districts || []).join(", ") || "Hamburg";
}
async function draftFromProfile(current) {
  const geo = await geography();
  const boroughNames = new Set((Array.isArray(current.boroughs) ? current.boroughs : []).map(String));
  const neighborhoodSource = Array.isArray(current.neighborhoods) && current.neighborhoods.length ? current.neighborhoods : current.location_mode === "neighborhoods" && Array.isArray(current.districts) ? current.districts : [];
  const neighborhoodNames = new Set(neighborhoodSource.map(String));
  return normalizeDraft({
    profile_slot: current.profile_slot,
    property_types: current.property_types || [],
    location_mode: current.location_mode,
    borough_ids: geo.boroughs.filter((entry) => boroughNames.has(String(entry.name))).map((entry) => entry.id),
    neighborhood_ids: geo.neighborhoods.filter((entry) => neighborhoodNames.has(String(entry.name))).map((entry) => entry.id),
    neighborhood_page: 0,
    max_warm_rent: current.max_warm_rent,
    min_rooms: current.min_rooms,
    min_area_sqm: current.min_area_sqm,
    profile_edit: true
  });
}
async function startNewProfile(user, chatId, messageId, requestedSlot) {
  const limit = profileLimit(user);
  const { data, error } = await db.from("search_profiles").select("profile_slot").eq("user_id", user.id).order("profile_slot");
  if (error)
    throw error;
  const used = new Set((data || []).map((row) => Number(row.profile_slot)));
  const slot = requestedSlot && requestedSlot >= 1 && requestedSlot <= limit ? requestedSlot : Array.from({ length: limit }, (_, i) => i + 1).find((value) => !used.has(value));
  if (!slot)
    return profile(user, chatId, messageId);
  const draft = emptyDraft(slot);
  return renderTypes({ ...user, onboarding_state: draft }, chatId, messageId, draft);
}
async function profileEditMenu(user, chatId, messageId, selectedSlot) {
  if (!Number.isInteger(selectedSlot) || selectedSlot < 1 || selectedSlot > profileLimit(user)) {
    return profile(user, chatId, messageId);
  }
  const { data: current, error } = await db.from("search_profiles").select("*").eq("user_id", user.id).eq("profile_slot", selectedSlot).maybeSingle();
  if (error)
    throw error;
  if (!current)
    return profile(user, chatId, messageId);
  await saveState(user.id, null, {});
  const text = `\u270F\uFE0F <b>Suchprofil \xE4ndern</b>

W\xE4hle, was du \xE4ndern m\xF6chtest. Deine aktuell gespeicherten Werte bleiben vorausgew\xE4hlt.

\u{1F3E0} <b>Typ:</b> ${esc((current.property_types || []).join(", "))}
\u{1F4CD} <b>Gebiet:</b> ${esc(profileLocation(current))}
\u{1F4B6} <b>Warmmiete:</b> bis ${esc(money(current.max_warm_rent))}
\u{1F6AA} <b>Zimmer:</b> ${esc(current.min_rooms ?? "\u2013")}+
\u{1F4D0} <b>Fl\xE4che:</b> ${esc(current.min_area_sqm ?? "\u2013")} m\xB2+`;
  const markup = { inline_keyboard: [
    [button("\u{1F3E0} Wohnungsart", `profile:edit-field:${selectedSlot}:types`)],
    [button("\u{1F4CD} Gebiet", `profile:edit-field:${selectedSlot}:location`)],
    [button("\u{1F4B6} Warmmiete", `profile:edit-field:${selectedSlot}:rent`)],
    [button("\u{1F6AA} Zimmer", `profile:edit-field:${selectedSlot}:rooms`)],
    [button("\u{1F4D0} Fl\xE4che", `profile:edit-field:${selectedSlot}:area`)],
    [button("\u2190 Zur\xFCck", `profile:view:${selectedSlot}`)]
  ] };
  return edit(chatId, messageId, text, markup);
}
async function profile(user, chatId, messageId, selectedSlot) {
  const limit = profileLimit(user);
  const { data, error } = await db.from("search_profiles").select("*").eq("user_id", user.id).lte("profile_slot", limit).order("profile_slot");
  if (error)
    throw error;
  const profiles = data || [];
  if (selectedSlot) {
    const current = profiles.find((row) => Number(row.profile_slot) === selectedSlot);
    if (!current)
      return profile(user, chatId, messageId);
    const location = profileLocation(current);
    const text2 = `\u{1F50E} <b>${esc(current.name || `Meine Suche ${selectedSlot}`)}</b>

Status: ${current.is_active ? "aktiv" : "pausiert"}
Typ: ${esc((current.property_types || []).join(", "))}
Gebiet: ${esc(location)}
Warmmiete: bis ${esc(money(current.max_warm_rent))}
Zimmer: ${esc(current.min_rooms ?? "\u2013")}+
Fl\xE4che: ${esc(current.min_area_sqm ?? "\u2013")} m\xB2+`;
    const markup2 = { inline_keyboard: [
      [button("\u270F\uFE0F Suchprofil \xE4ndern", `profile:edit:${selectedSlot}`)],
      [button(current.is_active ? "\u23F8 Pausieren" : "\u25B6\uFE0F Fortsetzen", current.is_active ? `profile:pause:${selectedSlot}` : `profile:resume:${selectedSlot}`)],
      [button("\u{1F5D1} Profil l\xF6schen", `profile:delete:${selectedSlot}`)],
      [button("\u2190 Zur\xFCck", "profile")]
    ] };
    return messageId ? edit(chatId, messageId, text2, markup2) : send(chatId, text2, markup2);
  }
  const rows = profiles.map((row) => [button(`\u{1F50E} ${row.name || `Meine Suche ${row.profile_slot}`} \xB7 ${row.is_active ? "aktiv" : "pausiert"}`, `profile:view:${row.profile_slot}`)]);
  if (user.onboarding_step) {
    const draft = draftFor(user);
    const draftName = draft.profile_slot === 1 ? "Meine Suche" : `Meine Suche ${draft.profile_slot}`;
    const draftLocked = draft.profile_slot > limit;
    rows.push([
      button(`${draftLocked ? "\u{1F512} " : ""}\u{1F50E} ${draftName} \u2022 Entwurf`, draftLocked ? "premium" : "draft")
    ]);
  }
  if (profiles.length < limit)
    rows.push([button("\u2795 Suchprofil erstellen", "new")]);
  if (!user.is_premium && profiles.length >= 1) {
    rows.push([button("\u{1F512} \u2795 Weiteres Suchprofil \xB7 \u{1F48E} Premium", "premium")]);
  }
  rows.push([button("\u2190 Zur\xFCck", "home")]);
  const text = profiles.length ? `\u{1F50E} <b>Meine Suchprofile</b>

${profiles.length}/${limit} Suchprofile angelegt.` : "\u{1F50E} <b>Meine Suchprofile</b>\n\nNoch kein Suchprofil angelegt.";
  const markup = { inline_keyboard: rows };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}
async function renderStatus(user, chatId, messageId) {
  const [profileResult, sourceResult, referralResult] = await Promise.all([
    db.from("search_profiles").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_active", true).lte("profile_slot", profileLimit(user)),
    db.from("sources").select("id", { count: "exact", head: true }),
    db.from("referrals").select("id", { count: "exact", head: true }).eq("referrer_user_id", user.id).eq("status", "rewarded")
  ]);
  if (profileResult.error)
    throw profileResult.error;
  if (sourceResult.error)
    throw sourceResult.error;
  if (referralResult.error)
    throw referralResult.error;
  const text = `\u{1F4E1} <b>Systemstatus</b>

\u{1F50E} Suchprofile aktiv: ${profileResult.count || 0}/${profileLimit(user)}
\u{1F310} Quellen im System: ${sourceResult.count || 0}
\u{1F48E} Erfolgreiche Empfehlungen: ${referralResult.count || 0}
\u2705 System: online`;
  const markup = { inline_keyboard: [[button("\u2190 Einstellungen", "settings")]] };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

// supabase/functions/telegram-ui/localization.js
var LANGS = {
  de: "\u{1F1E9}\u{1F1EA} Deutsch",
  en: "\u{1F1EC}\u{1F1E7} English",
  tr: "\u{1F1F9}\u{1F1F7} T\xFCrk\xE7e",
  ar: "\u{1F1F8}\u{1F1E6} \u0627\u0644\u0639\u0631\u0628\u064A\u0629",
  fa: "\u{1F1EE}\u{1F1F7} \u0641\u0627\u0631\u0633\u06CC",
  prs: "\u{1F1E6}\u{1F1EB} \u062F\u0631\u06CC",
  ps: "\u{1F1E6}\u{1F1EB} \u067E\u069A\u062A\u0648 / Pashto",
  ckb: "\u2600\uFE0F \u06A9\u0648\u0631\u062F\u06CC (\u0633\u06C6\u0631\u0627\u0646\u06CC)",
  ku: "\u2600\uFE0F Kurd\xEE (Kurmanc\xEE)",
  bad: "\u2600\uFE0F Kurd\xEE (Bad\xEEn\xEE)"
};
var TXT = {
  de: {
    welcome: "\u{1F3E0} <b>Traumwohnung Hamburg</b>\n\nFinde passende Wohnungen automatisiert in ganz Hamburg. Erstelle in wenigen Schritten dein pers\xF6nliches Suchprofil.",
    create: "\u{1F50E} Suche erstellen",
    back: "\u2B05\uFE0F Zur\xFCck",
    confirm: "Auswahl best\xE4tigen",
    all: "Alle ausw\xE4hlen",
    types: "1/4 \xB7 <b>Was suchst du?</b>\n\nDu kannst mehrere Optionen ausw\xE4hlen.",
    location: "2/4 \xB7 <b>Wo m\xF6chtest du suchen?</b>",
    allhh: "\u{1F310} Ganz Hamburg",
    boroughs: "\u{1F3D9} Bezirke ausw\xE4hlen",
    neighborhoods: "\u{1F4CD} Stadtteile ausw\xE4hlen",
    chooseB: "W\xE4hle einen oder mehrere der 7 Hamburger Bezirke.",
    chooseN: "W\xE4hle beliebig viele Stadtteile. Alle 104 bestehenden Stadtteile werden ber\xFCcksichtigt.",
    all104: "Alle 104 ausw\xE4hlen",
    clear: "Auswahl l\xF6schen",
    rent: "3/4 \xB7 <b>Maximale Warmmiete</b>",
    custom: "\u270F\uFE0F Eigener Betrag",
    enter: "Gib deine maximale Warmmiete als Zahl ein, z. B. <code>1250</code>.",
    area: "4/4 \xB7 <b>Mindestfl\xE4che</b>",
    none: "Keine Mindestfl\xE4che",
    review: "\u2705 <b>Suchprofil pr\xFCfen</b>",
    activate: "\u2705 Suche aktivieren",
    settings: "\u2699\uFE0F Einstellungen",
    language: "\u{1F310} Sprache",
    saved: "\u{1F4BE} Gespeicherte Inserate",
    nosaved: "Du hast noch keine Inserate gespeichert.",
    created: "\u2705 Deine Suche ist aktiv. Neue passende Inserate werden automatisch zugestellt.",
    use: "Bitte verwende die Buttons unter der Nachricht.",
    save: "\u{1F4BE} Speichern",
    savedState: "\u2705 Gespeichert",
    maps: "\u{1F4CD} Google Maps",
    openSaved: "Inserat anzeigen",
    missing: "nicht angegeben",
    coldRent: "Kaltmiete",
    warmRent: "Warmmiete",
    heating: "Heizkosten",
    additional: "Nebenkosten",
    deposit: "Kaution",
    address: "Adresse",
    rooms: "Zimmer",
    areaLabel: "Fl\xE4che"
  },
  en: {
    welcome: "\u{1F3E0} <b>Traumwohnung Hamburg</b>\n\nFind matching homes automatically across Hamburg and create your search profile in a few steps.",
    create: "\u{1F50E} Create search",
    back: "\u2B05\uFE0F Back",
    confirm: "Confirm",
    all: "Select all",
    types: "1/4 \xB7 <b>What are you looking for?</b>\n\nYou can select multiple options.",
    location: "2/4 \xB7 <b>Where do you want to search?</b>",
    allhh: "\u{1F310} All Hamburg",
    boroughs: "\u{1F3D9} Select boroughs",
    neighborhoods: "\u{1F4CD} Select neighborhoods",
    chooseB: "Select one or more of Hamburg's 7 boroughs.",
    chooseN: "Select any neighborhoods. All 104 existing neighborhoods are included.",
    all104: "Select all 104",
    clear: "Clear selection",
    rent: "3/4 \xB7 <b>Maximum warm rent</b>",
    custom: "\u270F\uFE0F Custom amount",
    enter: "Enter your maximum warm rent, e.g. <code>1250</code>.",
    area: "4/4 \xB7 <b>Minimum area</b>",
    none: "No minimum",
    review: "\u2705 <b>Review search profile</b>",
    activate: "\u2705 Activate search",
    settings: "\u2699\uFE0F Settings",
    language: "\u{1F310} Language",
    saved: "\u{1F4BE} Saved listings",
    nosaved: "You have no saved listings yet.",
    created: "\u2705 Your search is active. New matching listings will be delivered automatically.",
    use: "Please use the buttons below the message.",
    save: "\u{1F4BE} Save",
    savedState: "\u2705 Saved",
    maps: "\u{1F4CD} Google Maps",
    openSaved: "Show listing",
    missing: "not provided",
    coldRent: "Cold rent",
    warmRent: "Warm rent",
    heating: "Heating",
    additional: "Additional costs",
    deposit: "Deposit",
    address: "Address",
    rooms: "Rooms",
    areaLabel: "Area"
  },
  tr: {
    welcome: "\u{1F3E0} <b>Traumwohnung Hamburg</b>\n\nHamburg genelinde uygun evleri otomatik bulun ve arama profilinizi birka\xE7 ad\u0131mda olu\u015Fturun.",
    create: "\u{1F50E} Arama olu\u015Ftur",
    back: "\u2B05\uFE0F Geri",
    confirm: "Onayla",
    all: "T\xFCm\xFCn\xFC se\xE7",
    types: "1/4 \xB7 <b>Ne ar\u0131yorsunuz?</b>\n\nBirden fazla se\xE7enek se\xE7ebilirsiniz.",
    location: "2/4 \xB7 <b>Nerede aramak istiyorsunuz?</b>",
    allhh: "\u{1F310} T\xFCm Hamburg",
    boroughs: "\u{1F3D9} \u0130l\xE7eleri se\xE7",
    neighborhoods: "\u{1F4CD} Semtleri se\xE7",
    chooseB: "Hamburg'un 7 il\xE7esinden bir veya birka\xE7\u0131n\u0131 se\xE7in.",
    chooseN: "\u0130stedi\u011Finiz semtleri se\xE7in. Mevcut 104 semtin tamam\u0131 dahildir.",
    all104: "104'\xFCn\xFC se\xE7",
    clear: "Se\xE7imi temizle",
    rent: "3/4 \xB7 <b>Maksimum s\u0131cak kira</b>",
    custom: "\u270F\uFE0F \xD6zel tutar",
    enter: "Maksimum s\u0131cak kiray\u0131 girin, \xF6r. <code>1250</code>.",
    area: "4/4 \xB7 <b>Minimum alan</b>",
    none: "Minimum yok",
    review: "\u2705 <b>Arama profilini kontrol et</b>",
    activate: "\u2705 Aramay\u0131 etkinle\u015Ftir",
    settings: "\u2699\uFE0F Ayarlar",
    language: "\u{1F310} Dil",
    saved: "\u{1F4BE} Kaydedilen ilanlar",
    nosaved: "Hen\xFCz kay\u0131tl\u0131 ilan\u0131n\u0131z yok.",
    created: "\u2705 Araman\u0131z aktif. Yeni uygun ilanlar otomatik g\xF6nderilecek.",
    use: "L\xFCtfen mesaj\u0131n alt\u0131ndaki d\xFC\u011Fmeleri kullan\u0131n.",
    save: "\u{1F4BE} Kaydet",
    savedState: "\u2705 Kaydedildi",
    maps: "\u{1F4CD} Google Maps",
    openSaved: "\u0130lan\u0131 g\xF6ster",
    missing: "belirtilmedi",
    coldRent: "So\u011Fuk kira",
    warmRent: "S\u0131cak kira",
    heating: "Is\u0131tma",
    additional: "Ek giderler",
    deposit: "Depozito",
    address: "Adres",
    rooms: "Oda",
    areaLabel: "Alan"
  },
  ar: {
    welcome: "\u{1F3E0} <b>Traumwohnung Hamburg</b>\n\n\u0627\u0639\u062B\u0631 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0639\u0644\u0649 \u0627\u0644\u0633\u0643\u0646 \u0627\u0644\u0645\u0646\u0627\u0633\u0628 \u0641\u064A \u062C\u0645\u064A\u0639 \u0623\u0646\u062D\u0627\u0621 \u0647\u0627\u0645\u0628\u0648\u0631\u063A \u0648\u0623\u0646\u0634\u0626 \u0645\u0644\u0641 \u0627\u0644\u0628\u062D\u062B \u0628\u062E\u0637\u0648\u0627\u062A \u0642\u0644\u064A\u0644\u0629.",
    create: "\u{1F50E} \u0625\u0646\u0634\u0627\u0621 \u0628\u062D\u062B",
    back: "\u2B05\uFE0F \u0631\u062C\u0648\u0639",
    confirm: "\u062A\u0623\u0643\u064A\u062F",
    all: "\u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u0643\u0644",
    types: "1/4 \xB7 <b>\u0645\u0627\u0630\u0627 \u062A\u0628\u062D\u062B\u061F</b>\n\n\u064A\u0645\u0643\u0646\u0643 \u0627\u062E\u062A\u064A\u0627\u0631 \u0639\u062F\u0629 \u062E\u064A\u0627\u0631\u0627\u062A.",
    location: "2/4 \xB7 <b>\u0623\u064A\u0646 \u062A\u0631\u064A\u062F \u0627\u0644\u0628\u062D\u062B\u061F</b>",
    allhh: "\u{1F310} \u0643\u0644 \u0647\u0627\u0645\u0628\u0648\u0631\u063A",
    boroughs: "\u{1F3D9} \u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u0645\u0646\u0627\u0637\u0642",
    neighborhoods: "\u{1F4CD} \u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u0623\u062D\u064A\u0627\u0621",
    chooseB: "\u0627\u062E\u062A\u0631 \u0645\u0646\u0637\u0642\u0629 \u0623\u0648 \u0623\u0643\u062B\u0631 \u0645\u0646 \u0645\u0646\u0627\u0637\u0642 \u0647\u0627\u0645\u0628\u0648\u0631\u063A \u0627\u0644\u0633\u0628\u0639.",
    chooseN: "\u0627\u062E\u062A\u0631 \u0627\u0644\u0623\u062D\u064A\u0627\u0621 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629. \u062C\u0645\u064A\u0639 \u0627\u0644\u0623\u062D\u064A\u0627\u0621 \u0627\u0644\u0640104 \u0627\u0644\u062D\u0627\u0644\u064A\u0629 \u0645\u062F\u0631\u062C\u0629.",
    all104: "\u0627\u062E\u062A\u064A\u0627\u0631 104 \u0643\u0644\u0647\u0627",
    clear: "\u0645\u0633\u062D \u0627\u0644\u0627\u062E\u062A\u064A\u0627\u0631",
    rent: "3/4 \xB7 <b>\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 \u0644\u0644\u0625\u064A\u062C\u0627\u0631 \u0627\u0644\u062F\u0627\u0641\u0626</b>",
    custom: "\u270F\uFE0F \u0645\u0628\u0644\u063A \u0645\u062E\u0635\u0635",
    enter: "\u0623\u062F\u062E\u0644 \u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 \u0644\u0644\u0625\u064A\u062C\u0627\u0631\u060C \u0645\u062B\u0627\u0644 <code>1250</code>.",
    area: "4/4 \xB7 <b>\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u062F\u0646\u0649 \u0644\u0644\u0645\u0633\u0627\u062D\u0629</b>",
    none: "\u0628\u062F\u0648\u0646 \u062D\u062F \u0623\u062F\u0646\u0649",
    review: "\u2705 <b>\u0645\u0631\u0627\u062C\u0639\u0629 \u0645\u0644\u0641 \u0627\u0644\u0628\u062D\u062B</b>",
    activate: "\u2705 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0628\u062D\u062B",
    settings: "\u2699\uFE0F \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A",
    language: "\u{1F310} \u0627\u0644\u0644\u063A\u0629",
    saved: "\u{1F4BE} \u0627\u0644\u0625\u0639\u0644\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629",
    nosaved: "\u0644\u0627 \u062A\u0648\u062C\u062F \u0625\u0639\u0644\u0627\u0646\u0627\u062A \u0645\u062D\u0641\u0648\u0638\u0629 \u0628\u0639\u062F.",
    created: "\u2705 \u062A\u0645 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0628\u062D\u062B. \u0633\u062A\u0635\u0644\u0643 \u0627\u0644\u0625\u0639\u0644\u0627\u0646\u0627\u062A \u0627\u0644\u062C\u062F\u064A\u062F\u0629 \u0627\u0644\u0645\u0637\u0627\u0628\u0642\u0629 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B.",
    use: "\u064A\u0631\u062C\u0649 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0623\u0632\u0631\u0627\u0631 \u0623\u0633\u0641\u0644 \u0627\u0644\u0631\u0633\u0627\u0644\u0629.",
    save: "\u{1F4BE} \u062D\u0641\u0638",
    savedState: "\u2705 \u0645\u062D\u0641\u0648\u0638",
    maps: "\u{1F4CD} Google Maps",
    openSaved: "\u0639\u0631\u0636 \u0627\u0644\u0625\u0639\u0644\u0627\u0646",
    missing: "\u063A\u064A\u0631 \u0645\u0630\u0643\u0648\u0631",
    coldRent: "\u0627\u0644\u0625\u064A\u062C\u0627\u0631 \u0627\u0644\u0623\u0633\u0627\u0633\u064A",
    warmRent: "\u0627\u0644\u0625\u064A\u062C\u0627\u0631 \u0627\u0644\u0634\u0627\u0645\u0644",
    heating: "\u0627\u0644\u062A\u062F\u0641\u0626\u0629",
    additional: "\u0627\u0644\u062A\u0643\u0627\u0644\u064A\u0641 \u0627\u0644\u0625\u0636\u0627\u0641\u064A\u0629",
    deposit: "\u0627\u0644\u062A\u0623\u0645\u064A\u0646",
    address: "\u0627\u0644\u0639\u0646\u0648\u0627\u0646",
    rooms: "\u0627\u0644\u063A\u0631\u0641",
    areaLabel: "\u0627\u0644\u0645\u0633\u0627\u062D\u0629"
  },
  fa: {
    welcome: "\u{1F3E0} <b>Traumwohnung Hamburg</b>\n\n\u062E\u0627\u0646\u0647\u200C\u0647\u0627\u06CC \u0645\u0646\u0627\u0633\u0628 \u0631\u0627 \u062F\u0631 \u0633\u0631\u0627\u0633\u0631 \u0647\u0627\u0645\u0628\u0648\u0631\u06AF \u0628\u0647\u200C\u0635\u0648\u0631\u062A \u062E\u0648\u062F\u06A9\u0627\u0631 \u067E\u06CC\u062F\u0627 \u06A9\u0646\u06CC\u062F \u0648 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u0633\u062A\u200C\u0648\u062C\u0648\u06CC \u062E\u0648\u062F \u0631\u0627 \u0628\u0633\u0627\u0632\u06CC\u062F.",
    create: "\u{1F50E} \u0627\u06CC\u062C\u0627\u062F \u062C\u0633\u062A\u200C\u0648\u062C\u0648",
    back: "\u2B05\uFE0F \u0628\u0627\u0632\u06AF\u0634\u062A",
    confirm: "\u062A\u0623\u06CC\u06CC\u062F",
    all: "\u0627\u0646\u062A\u062E\u0627\u0628 \u0647\u0645\u0647",
    types: "1/4 \xB7 <b>\u062F\u0646\u0628\u0627\u0644 \u0686\u0647 \u0647\u0633\u062A\u06CC\u062F\u061F</b>\n\n\u0645\u06CC\u200C\u062A\u0648\u0627\u0646\u06CC\u062F \u0686\u0646\u062F \u06AF\u0632\u06CC\u0646\u0647 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646\u06CC\u062F.",
    location: "2/4 \xB7 <b>\u06A9\u062C\u0627 \u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u06CC\u062F \u062C\u0633\u062A\u200C\u0648\u062C\u0648 \u06A9\u0646\u06CC\u062F\u061F</b>",
    allhh: "\u{1F310} \u06A9\u0644 \u0647\u0627\u0645\u0628\u0648\u0631\u06AF",
    boroughs: "\u{1F3D9} \u0627\u0646\u062A\u062E\u0627\u0628 \u0645\u0646\u0627\u0637\u0642",
    neighborhoods: "\u{1F4CD} \u0627\u0646\u062A\u062E\u0627\u0628 \u0645\u062D\u0644\u0647\u200C\u0647\u0627",
    chooseB: "\u06CC\u06A9 \u06CC\u0627 \u0686\u0646\u062F \u0645\u0648\u0631\u062F \u0627\u0632 \u06F7 \u0645\u0646\u0637\u0642\u0647 \u0647\u0627\u0645\u0628\u0648\u0631\u06AF \u0631\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646\u06CC\u062F.",
    chooseN: "\u0645\u062D\u0644\u0647\u200C\u0647\u0627\u06CC \u0645\u0648\u0631\u062F\u0646\u0638\u0631 \u0631\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646\u06CC\u062F. \u0647\u0645\u0647 \u06F1\u06F0\u06F4 \u0645\u062D\u0644\u0647 \u0645\u0648\u062C\u0648\u062F \u0644\u062D\u0627\u0638 \u0645\u06CC\u200C\u0634\u0648\u0646\u062F.",
    all104: "\u0627\u0646\u062A\u062E\u0627\u0628 \u0647\u0631 \u06F1\u06F0\u06F4",
    clear: "\u067E\u0627\u06A9 \u06A9\u0631\u062F\u0646 \u0627\u0646\u062A\u062E\u0627\u0628",
    rent: "3/4 \xB7 <b>\u062D\u062F\u0627\u06A9\u062B\u0631 \u0627\u062C\u0627\u0631\u0647 \u06AF\u0631\u0645</b>",
    custom: "\u270F\uFE0F \u0645\u0628\u0644\u063A \u062F\u0644\u062E\u0648\u0627\u0647",
    enter: "\u062D\u062F\u0627\u06A9\u062B\u0631 \u0627\u062C\u0627\u0631\u0647 \u06AF\u0631\u0645 \u0631\u0627 \u0648\u0627\u0631\u062F \u06A9\u0646\u06CC\u062F\u060C \u0645\u062B\u0627\u0644 <code>1250</code>.",
    area: "4/4 \xB7 <b>\u062D\u062F\u0627\u0642\u0644 \u0645\u062A\u0631\u0627\u0698</b>",
    none: "\u0628\u062F\u0648\u0646 \u062D\u062F\u0627\u0642\u0644",
    review: "\u2705 <b>\u0628\u0631\u0631\u0633\u06CC \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u0633\u062A\u200C\u0648\u062C\u0648</b>",
    activate: "\u2705 \u0641\u0639\u0627\u0644\u200C\u06A9\u0631\u062F\u0646 \u062C\u0633\u062A\u200C\u0648\u062C\u0648",
    settings: "\u2699\uFE0F \u062A\u0646\u0638\u06CC\u0645\u0627\u062A",
    language: "\u{1F310} \u0632\u0628\u0627\u0646",
    saved: "\u{1F4BE} \u0622\u06AF\u0647\u06CC\u200C\u0647\u0627\u06CC \u0630\u062E\u06CC\u0631\u0647\u200C\u0634\u062F\u0647",
    nosaved: "\u0647\u0646\u0648\u0632 \u0622\u06AF\u0647\u06CC \u0630\u062E\u06CC\u0631\u0647\u200C\u0634\u062F\u0647\u200C\u0627\u06CC \u0646\u062F\u0627\u0631\u06CC\u062F.",
    created: "\u2705 \u062C\u0633\u062A\u200C\u0648\u062C\u0648\u06CC \u0634\u0645\u0627 \u0641\u0639\u0627\u0644 \u0627\u0633\u062A. \u0622\u06AF\u0647\u06CC\u200C\u0647\u0627\u06CC \u062C\u062F\u06CC\u062F \u0645\u0637\u0627\u0628\u0642 \u0628\u0647\u200C\u0635\u0648\u0631\u062A \u062E\u0648\u062F\u06A9\u0627\u0631 \u0627\u0631\u0633\u0627\u0644 \u0645\u06CC\u200C\u0634\u0648\u0646\u062F.",
    use: "\u0644\u0637\u0641\u0627\u064B \u0627\u0632 \u062F\u06A9\u0645\u0647\u200C\u0647\u0627\u06CC \u0632\u06CC\u0631 \u067E\u06CC\u0627\u0645 \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u06A9\u0646\u06CC\u062F.",
    save: "\u{1F4BE} \u0630\u062E\u06CC\u0631\u0647",
    savedState: "\u2705 \u0630\u062E\u06CC\u0631\u0647 \u0634\u062F",
    maps: "\u{1F4CD} Google Maps",
    openSaved: "\u0646\u0645\u0627\u06CC\u0634 \u0622\u06AF\u0647\u06CC",
    missing: "\u0630\u06A9\u0631 \u0646\u0634\u062F\u0647",
    coldRent: "\u0627\u062C\u0627\u0631\u0647 \u067E\u0627\u06CC\u0647",
    warmRent: "\u0627\u062C\u0627\u0631\u0647 \u06AF\u0631\u0645",
    heating: "\u0647\u0632\u06CC\u0646\u0647 \u06AF\u0631\u0645\u0627\u06CC\u0634",
    additional: "\u0647\u0632\u06CC\u0646\u0647\u200C\u0647\u0627\u06CC \u062C\u0627\u0646\u0628\u06CC",
    deposit: "\u0648\u062F\u06CC\u0639\u0647",
    address: "\u0622\u062F\u0631\u0633",
    rooms: "\u0627\u062A\u0627\u0642",
    areaLabel: "\u0645\u062A\u0631\u0627\u0698"
  },
  prs: {
    welcome: "\u{1F3E0} <b>Traumwohnung Hamburg</b>\n\n\u062E\u0627\u0646\u0647 \u0645\u0646\u0627\u0633\u0628 \u0631\u0627 \u062F\u0631 \u0633\u0631\u0627\u0633\u0631 \u0647\u0627\u0645\u0628\u0648\u0631\u06AF \u0628\u0647\u200C\u0635\u0648\u0631\u062A \u062E\u0648\u062F\u06A9\u0627\u0631 \u067E\u06CC\u062F\u0627 \u06A9\u0646\u06CC\u062F \u0648 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u0633\u062A\u200C\u0648\u062C\u0648\u06CC \u062E\u0648\u062F \u0631\u0627 \u0628\u0633\u0627\u0632\u06CC\u062F.",
    create: "\u{1F50E} \u0627\u06CC\u062C\u0627\u062F \u062C\u0633\u062A\u200C\u0648\u062C\u0648",
    back: "\u2B05\uFE0F \u0628\u0631\u06AF\u0634\u062A",
    confirm: "\u062A\u0623\u06CC\u06CC\u062F",
    all: "\u0627\u0646\u062A\u062E\u0627\u0628 \u0647\u0645\u0647",
    types: "1/4 \xB7 <b>\u062F\u0646\u0628\u0627\u0644 \u0686\u0647 \u0646\u0648\u0639 \u062E\u0627\u0646\u0647 \u0647\u0633\u062A\u06CC\u062F\u061F</b>",
    location: "2/4 \xB7 <b>\u062F\u0631 \u06A9\u062C\u0627 \u062C\u0633\u062A\u200C\u0648\u062C\u0648 \u0634\u0648\u062F\u061F</b>",
    allhh: "\u{1F310} \u062A\u0645\u0627\u0645 \u0647\u0627\u0645\u0628\u0648\u0631\u06AF",
    boroughs: "\u{1F3D9} \u0627\u0646\u062A\u062E\u0627\u0628 \u0645\u0646\u0627\u0637\u0642",
    neighborhoods: "\u{1F4CD} \u0627\u0646\u062A\u062E\u0627\u0628 \u0645\u062D\u0644\u0647\u200C\u0647\u0627",
    chooseB: "\u06CC\u06A9 \u06CC\u0627 \u0686\u0646\u062F \u0645\u0646\u0637\u0642\u0647 \u0627\u0632 \u06F7 \u0645\u0646\u0637\u0642\u0647 \u0647\u0627\u0645\u0628\u0648\u0631\u06AF \u0631\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646\u06CC\u062F.",
    chooseN: "\u0645\u062D\u0644\u0647\u200C\u0647\u0627\u06CC \u062F\u0644\u062E\u0648\u0627\u0647 \u0631\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646\u06CC\u062F. \u0647\u0631 \u06F1\u06F0\u06F4 \u0645\u062D\u0644\u0647 \u0645\u0648\u062C\u0648\u062F \u0634\u0627\u0645\u0644 \u0627\u0633\u062A.",
    all104: "\u0627\u0646\u062A\u062E\u0627\u0628 \u0647\u0645\u0647 \u06F1\u06F0\u06F4",
    clear: "\u067E\u0627\u06A9\u200C\u06A9\u0631\u062F\u0646",
    rent: "3/4 \xB7 <b>\u062D\u062F\u0627\u06A9\u062B\u0631 \u06A9\u0631\u0627\u06CC\u0647 \u06AF\u0631\u0645</b>",
    custom: "\u270F\uFE0F \u0645\u0628\u0644\u063A \u062F\u0644\u062E\u0648\u0627\u0647",
    enter: "\u062D\u062F\u0627\u06A9\u062B\u0631 \u06A9\u0631\u0627\u06CC\u0647 \u0631\u0627 \u0648\u0627\u0631\u062F \u06A9\u0646\u06CC\u062F\u060C \u0645\u062B\u0627\u0644 <code>1250</code>.",
    area: "4/4 \xB7 <b>\u062D\u062F\u0627\u0642\u0644 \u0645\u0633\u0627\u062D\u062A</b>",
    none: "\u0628\u062F\u0648\u0646 \u062D\u062F\u0627\u0642\u0644",
    review: "\u2705 <b>\u0628\u0631\u0631\u0633\u06CC \u067E\u0631\u0648\u0641\u0627\u06CC\u0644</b>",
    activate: "\u2705 \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC",
    settings: "\u2699\uFE0F \u062A\u0646\u0638\u06CC\u0645\u0627\u062A",
    language: "\u{1F310} \u0632\u0628\u0627\u0646",
    saved: "\u{1F4BE} \u0622\u06AF\u0647\u06CC\u200C\u0647\u0627\u06CC \u0630\u062E\u06CC\u0631\u0647\u200C\u0634\u062F\u0647",
    nosaved: "\u0647\u0646\u0648\u0632 \u0622\u06AF\u0647\u06CC \u0630\u062E\u06CC\u0631\u0647\u200C\u0634\u062F\u0647 \u0646\u062F\u0627\u0631\u06CC\u062F.",
    created: "\u2705 \u062C\u0633\u062A\u200C\u0648\u062C\u0648\u06CC \u0634\u0645\u0627 \u0641\u0639\u0627\u0644 \u0627\u0633\u062A.",
    use: "\u0644\u0637\u0641\u0627\u064B \u0627\u0632 \u062F\u06A9\u0645\u0647\u200C\u0647\u0627\u06CC \u0632\u06CC\u0631 \u067E\u06CC\u0627\u0645 \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u06A9\u0646\u06CC\u062F.",
    save: "\u{1F4BE} \u0630\u062E\u06CC\u0631\u0647",
    savedState: "\u2705 \u0630\u062E\u06CC\u0631\u0647 \u0634\u062F",
    maps: "\u{1F4CD} Google Maps",
    openSaved: "\u0646\u0645\u0627\u06CC\u0634 \u0622\u06AF\u0647\u06CC",
    missing: "\u0630\u06A9\u0631 \u0646\u0634\u062F\u0647",
    coldRent: "\u06A9\u0631\u0627\u06CC\u0647 \u067E\u0627\u06CC\u0647",
    warmRent: "\u06A9\u0631\u0627\u06CC\u0647 \u06AF\u0631\u0645",
    heating: "\u06AF\u0631\u0645\u0627\u06CC\u0634",
    additional: "\u0645\u0635\u0627\u0631\u0641 \u062C\u0627\u0646\u0628\u06CC",
    deposit: "\u062A\u0636\u0645\u06CC\u0646",
    address: "\u0622\u062F\u0631\u0633",
    rooms: "\u0627\u062A\u0627\u0642",
    areaLabel: "\u0645\u0633\u0627\u062D\u062A"
  },
  ps: {
    welcome: "\u{1F3E0} <b>Traumwohnung Hamburg</b>\n\n\u067E\u0647 \u067C\u0648\u0644 \u0647\u0627\u0645\u0628\u0648\u0631\u06AB \u06A9\u06D0 \u0645\u0646\u0627\u0633\u0628 \u06A9\u0648\u0631\u0648\u0646\u0647 \u067E\u0647 \u0627\u062A\u0648\u0645\u0627\u062A \u0689\u0648\u0644 \u0648\u0645\u0648\u0645\u0626 \u0627\u0648 \u062E\u067E\u0644 \u062F \u0644\u067C\u0648\u0646 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u0648\u0693 \u06A9\u0693\u0626.",
    create: "\u{1F50E} \u0644\u067C\u0648\u0646 \u062C\u0648\u0693\u0648\u0644",
    back: "\u2B05\uFE0F \u0634\u0627\u062A\u0647",
    confirm: "\u062A\u0627\u06CC\u06CC\u062F",
    all: "\u067C\u0648\u0644 \u0648\u067C\u0627\u06A9\u0626",
    types: "1/4 \xB7 <b>\u0685\u0647 \u0644\u067C\u0648\u0626\u061F</b>",
    location: "2/4 \xB7 <b>\u0686\u06D0\u0631\u062A\u0647 \u0644\u067C\u0648\u0646 \u06A9\u0648\u0644 \u063A\u0648\u0627\u0693\u0626\u061F</b>",
    allhh: "\u{1F310} \u067C\u0648\u0644 \u0647\u0627\u0645\u0628\u0648\u0631\u06AB",
    boroughs: "\u{1F3D9} \u0648\u0644\u0633\u0648\u0627\u0644\u06CD \u0648\u067C\u0627\u06A9\u0626",
    neighborhoods: "\u{1F4CD} \u0633\u06CC\u0645\u06D0 \u0648\u067C\u0627\u06A9\u0626",
    chooseB: "\u062F \u0647\u0627\u0645\u0628\u0648\u0631\u06AB \u0644\u0647 \u06F7 \u0648\u0644\u0633\u0648\u0627\u0644\u06CC\u0648 \u0685\u062E\u0647 \u06CC\u0648\u0647 \u06CC\u0627 \u0685\u0648 \u0648\u067C\u0627\u06A9\u0626.",
    chooseN: "\u0647\u0631\u06D0 \u0633\u06CC\u0645\u06D0 \u0686\u06D0 \u063A\u0648\u0627\u0693\u0626 \u0648\u067C\u0627\u06A9\u0626. \u067C\u0648\u0644\u06D0 \u06F1\u06F0\u06F4 \u0633\u06CC\u0645\u06D0 \u0634\u0627\u0645\u0644\u06D0 \u062F\u064A.",
    all104: "\u067C\u0648\u0644\u06D0 \u06F1\u06F0\u06F4 \u0648\u067C\u0627\u06A9\u0626",
    clear: "\u067E\u0627\u06A9\u0648\u0644",
    rent: "3/4 \xB7 <b>\u0627\u0639\u0638\u0645\u064A \u06AB\u0631\u0645 \u06A9\u0631\u0627\u06CC\u0647</b>",
    custom: "\u270F\uFE0F \u062E\u067E\u0644\u0647 \u0627\u0646\u062F\u0627\u0632\u0647",
    enter: "\u0627\u0639\u0638\u0645\u064A \u06A9\u0631\u0627\u06CC\u0647 \u0648\u0644\u06CC\u06A9\u0626\u060C \u0644\u06A9\u0647 <code>1250</code>.",
    area: "4/4 \xB7 <b>\u0644\u0696 \u062A\u0631 \u0644\u0696\u0647 \u0645\u0633\u0627\u062D\u062A</b>",
    none: "\u062D\u062F \u0646\u0634\u062A\u0647",
    review: "\u2705 <b>\u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u0648\u06AB\u0648\u0631\u0626</b>",
    activate: "\u2705 \u0644\u067C\u0648\u0646 \u0641\u0639\u0627\u0644 \u06A9\u0693\u0626",
    settings: "\u2699\uFE0F \u062A\u0646\u0638\u06CC\u0645\u0627\u062A",
    language: "\u{1F310} \u0698\u0628\u0647",
    saved: "\u{1F4BE} \u062E\u0648\u0646\u062F\u064A \u0627\u0639\u0644\u0627\u0646\u0648\u0646\u0647",
    nosaved: "\u062A\u0631 \u0627\u0648\u0633\u0647 \u062E\u0648\u0646\u062F\u064A \u0627\u0639\u0644\u0627\u0646 \u0646\u0634\u062A\u0647.",
    created: "\u2705 \u0633\u062A\u0627\u0633\u0648 \u0644\u067C\u0648\u0646 \u0641\u0639\u0627\u0644 \u062F\u06CC.",
    use: "\u062F \u067E\u06CC\u063A\u0627\u0645 \u0644\u0627\u0646\u062F\u06D0 \u062A\u06BC\u06CD \u0648\u06A9\u0627\u0631\u0648\u0626.",
    save: "\u{1F4BE} \u062E\u0648\u0646\u062F\u064A",
    savedState: "\u2705 \u062E\u0648\u0646\u062F\u064A",
    maps: "\u{1F4CD} Google Maps",
    openSaved: "\u0627\u0639\u0644\u0627\u0646 \u069A\u06A9\u0627\u0631\u0647 \u06A9\u0693\u0647",
    missing: "\u0646\u0647 \u062F\u06CC \u069A\u0648\u062F\u0644 \u0634\u0648\u06CC",
    coldRent: "\u0627\u0633\u0627\u0633\u064A \u06A9\u0631\u0627\u06CC\u0647",
    warmRent: "\u06AB\u0631\u0645 \u06A9\u0631\u0627\u06CC\u0647",
    heating: "\u062A\u0648\u062F\u0648\u062E\u0647",
    additional: "\u0627\u0636\u0627\u0641\u064A \u0644\u06AB\u069A\u062A\u0648\u0646\u0647",
    deposit: "\u0636\u0645\u0627\u0646\u062A",
    address: "\u067E\u062A\u0647",
    rooms: "\u062E\u0648\u0646\u06D0",
    areaLabel: "\u0645\u0633\u0627\u062D\u062A"
  },
  ckb: {
    welcome: "\u{1F3E0} <b>Traumwohnung Hamburg</b>\n\n\u0644\u06D5 \u0647\u06D5\u0645\u0648\u0648 \u0647\u0627\u0645\u0628\u06C6\u0631\u06AF\u062F\u0627 \u0628\u06D5 \u0634\u06CE\u0648\u06D5\u06CC \u0626\u06C6\u062A\u06C6\u0645\u0627\u062A\u06CC\u06A9\u06CC \u062E\u0627\u0646\u0648\u0648\u06CC \u06AF\u0648\u0646\u062C\u0627\u0648 \u0628\u062F\u06C6\u0632\u06D5\u0648\u06D5 \u0648 \u067E\u0695\u06C6\u0641\u0627\u06CC\u0644\u06CC \u06AF\u06D5\u0695\u0627\u0646\u062A \u062F\u0631\u0648\u0633\u062A \u0628\u06A9\u06D5.",
    create: "\u{1F50E} \u062F\u0631\u0648\u0633\u062A\u06A9\u0631\u062F\u0646\u06CC \u06AF\u06D5\u0695\u0627\u0646",
    back: "\u2B05\uFE0F \u06AF\u06D5\u0695\u0627\u0646\u06D5\u0648\u06D5",
    confirm: "\u067E\u0634\u062A\u0695\u0627\u0633\u062A\u06A9\u0631\u062F\u0646\u06D5\u0648\u06D5",
    all: "\u0647\u06D5\u0645\u0648\u0648\u06CC \u0647\u06D5\u06B5\u0628\u0698\u06CE\u0631\u06D5",
    types: "1/4 \xB7 <b>\u0628\u06D5\u062F\u0648\u0627\u06CC \u0686\u06CC \u062F\u06D5\u06AF\u06D5\u0695\u06CE\u06CC\u062A\u061F</b>",
    location: "2/4 \xB7 <b>\u0644\u06D5 \u06A9\u0648\u06CE \u062F\u06D5\u06AF\u06D5\u0695\u06CE\u06CC\u062A\u061F</b>",
    allhh: "\u{1F310} \u0647\u06D5\u0645\u0648\u0648 \u0647\u0627\u0645\u0628\u06C6\u0631\u06AF",
    boroughs: "\u{1F3D9} \u0646\u0627\u0648\u0686\u06D5\u06A9\u0627\u0646",
    neighborhoods: "\u{1F4CD} \u06AF\u06D5\u0695\u06D5\u06A9\u06D5\u06A9\u0627\u0646",
    chooseB: "\u06CC\u06D5\u06A9 \u06CC\u0627\u0646 \u0686\u06D5\u0646\u062F \u0646\u0627\u0648\u0686\u06D5 \u0644\u06D5 \u0667 \u0646\u0627\u0648\u0686\u06D5\u06CC \u0647\u0627\u0645\u0628\u06C6\u0631\u06AF \u0647\u06D5\u06B5\u0628\u0698\u06CE\u0631\u06D5.",
    chooseN: "\u06AF\u06D5\u0695\u06D5\u06A9\u06D5\u06A9\u0627\u0646 \u0647\u06D5\u06B5\u0628\u0698\u06CE\u0631\u06D5. \u0647\u06D5\u0645\u0648\u0648 \u0661\u0660\u0664 \u06AF\u06D5\u0695\u06D5\u06A9 \u0644\u06D5\u0628\u06D5\u0631\u0686\u0627\u0648 \u062F\u06D5\u06AF\u06CC\u0631\u06CE\u0646.",
    all104: "\u0647\u06D5\u0645\u0648\u0648 \u0661\u0660\u0664",
    clear: "\u0633\u0695\u06CC\u0646\u06D5\u0648\u06D5",
    rent: "3/4 \xB7 <b>\u0632\u06C6\u0631\u062A\u0631\u06CC\u0646 \u06A9\u0631\u06CE\u06CC \u06AF\u06D5\u0631\u0645</b>",
    custom: "\u270F\uFE0F \u0628\u0695\u06CC \u062A\u0627\u06CC\u0628\u06D5\u062A",
    enter: "\u0632\u06C6\u0631\u062A\u0631\u06CC\u0646 \u06A9\u0631\u06CE \u0628\u0646\u0648\u0648\u0633\u06D5\u060C \u0628\u06C6 \u0646\u0645\u0648\u0648\u0646\u06D5 <code>1250</code>.",
    area: "4/4 \xB7 <b>\u06A9\u06D5\u0645\u062A\u0631\u06CC\u0646 \u0695\u0648\u0648\u0628\u06D5\u0631</b>",
    none: "\u0628\u06CE \u0633\u0646\u0648\u0648\u0631",
    review: "\u2705 <b>\u067E\u0634\u06A9\u0646\u06CC\u0646\u06CC \u067E\u0695\u06C6\u0641\u0627\u06CC\u0644</b>",
    activate: "\u2705 \u0686\u0627\u0644\u0627\u06A9\u06A9\u0631\u062F\u0646\u06CC \u06AF\u06D5\u0695\u0627\u0646",
    settings: "\u2699\uFE0F \u0695\u06CE\u06A9\u062E\u0633\u062A\u0646\u06D5\u06A9\u0627\u0646",
    language: "\u{1F310} \u0632\u0645\u0627\u0646",
    saved: "\u{1F4BE} \u067E\u0627\u0634\u06D5\u06A9\u06D5\u0648\u062A\u06A9\u0631\u0627\u0648\u06D5\u06A9\u0627\u0646",
    nosaved: "\u0647\u06CE\u0634\u062A\u0627 \u0647\u06CC\u0686\u062A \u067E\u0627\u0634\u06D5\u06A9\u06D5\u0648\u062A \u0646\u06D5\u06A9\u0631\u062F\u0648\u0648\u06D5.",
    created: "\u2705 \u06AF\u06D5\u0695\u0627\u0646\u062A \u0686\u0627\u0644\u0627\u06A9\u06D5.",
    use: "\u062F\u0648\u06AF\u0645\u06D5\u06A9\u0627\u0646\u06CC \u0698\u06CE\u0631 \u067E\u06D5\u06CC\u0627\u0645 \u0628\u06D5\u06A9\u0627\u0631\u0628\u0647\u06CE\u0646\u06D5.",
    save: "\u{1F4BE} \u067E\u0627\u0634\u06D5\u06A9\u06D5\u0648\u062A",
    savedState: "\u2705 \u067E\u0627\u0634\u06D5\u06A9\u06D5\u0648\u062A\u06A9\u0631\u0627",
    maps: "\u{1F4CD} Google Maps",
    openSaved: "\u067E\u06CC\u0634\u0627\u0646\u062F\u0627\u0646\u06CC \u0695\u06CC\u06A9\u0644\u0627\u0645",
    missing: "\u0646\u06D5\u062F\u0631\u0627\u0648\u06D5",
    coldRent: "\u06A9\u0631\u06CE\u06CC \u0633\u0627\u0631\u062F",
    warmRent: "\u06A9\u0631\u06CE\u06CC \u06AF\u06D5\u0631\u0645",
    heating: "\u06AF\u06D5\u0631\u0645\u0627",
    additional: "\u062E\u06D5\u0631\u062C\u06CC \u0632\u06CC\u0627\u062F\u06D5",
    deposit: "\u0628\u0627\u0631\u0645\u062A\u06D5",
    address: "\u0646\u0627\u0648\u0646\u06CC\u0634\u0627\u0646",
    rooms: "\u0698\u0648\u0648\u0631",
    areaLabel: "\u0695\u0648\u0648\u0628\u06D5\u0631"
  },
  ku: {
    welcome: "\u{1F3E0} <b>Traumwohnung Hamburg</b>\n\nLi hem\xFB Hamburg\xEA xaniy\xEAn guncaw bixweber bib\xEEne \xFB prof\xEEla l\xEAger\xEEn\xEA ava bike.",
    create: "\u{1F50E} L\xEAger\xEEn\xEA biafir\xEEne",
    back: "\u2B05\uFE0F Pa\u015F",
    confirm: "Pi\u015Ftrast bike",
    all: "Hem\xFB hilbij\xEAre",
    types: "1/4 \xB7 <b>Tu li \xE7i diger\xEE?</b>",
    location: "2/4 \xB7 <b>Li ku der\xEA bigere?</b>",
    allhh: "\u{1F310} Hem\xFB Hamburg",
    boroughs: "\u{1F3D9} Her\xEAm hilbij\xEAre",
    neighborhoods: "\u{1F4CD} Tax hilbij\xEAre",
    chooseB: "Ji 7 her\xEAm\xEAn Hamburg\xEA yek an \xE7end hilbij\xEAre.",
    chooseN: "Tax\xEAn ku dixwaz\xEE hilbij\xEAre. Hem\xFB 104 tax t\xEAne hesibandin.",
    all104: "Hem\xFB 104",
    clear: "Paqij bike",
    rent: "3/4 \xB7 <b>Her\xEE z\xEAde kir\xEAya germ</b>",
    custom: "\u270F\uFE0F Meblaqa xwe",
    enter: "Kir\xEAya germ biniv\xEEse, m\xEEnak <code>1250</code>.",
    area: "4/4 \xB7 <b>K\xEAmtir\xEEn r\xFBber</b>",
    none: "B\xEA s\xEEnor",
    review: "\u2705 <b>Prof\xEEl\xEA kontrol bike</b>",
    activate: "\u2705 L\xEAger\xEEn\xEA \xE7alak bike",
    settings: "\u2699\uFE0F M\xEEheng",
    language: "\u{1F310} Ziman",
    saved: "\u{1F4BE} \xCElan\xEAn tomar kir\xEE",
    nosaved: "H\xEAj \xEElanek tomar nekiriye.",
    created: "\u2705 L\xEAger\xEEna te \xE7alak e.",
    use: "Bi\u015Fkok\xEAn bin\xEA peyam\xEA bikar b\xEEne.",
    save: "\u{1F4BE} Tomar bike",
    savedState: "\u2705 Tomarkir\xEE",
    maps: "\u{1F4CD} Google Maps",
    openSaved: "\xCElan\xEA n\xEE\u015Fan bide",
    missing: "nehatiye day\xEEn",
    coldRent: "Kir\xEAya sar",
    warmRent: "Kir\xEAya germ",
    heating: "Germkirin",
    additional: "Mesref\xEAn din",
    deposit: "Depoz\xEEto",
    address: "Navn\xEE\u015Fan",
    rooms: "Ode",
    areaLabel: "R\xFBber"
  },
  bad: {
    welcome: "\u{1F3E0} <b>Traumwohnung Hamburg</b>\n\nLi hem\xFB Hamburg\xEA mal\xEAn guncaw bixweber bib\xEEne \xFB prof\xEEla l\xEAger\xEEn\xEA \xE7\xEAke.",
    create: "\u{1F50E} L\xEAger\xEEn \xE7\xEAke",
    back: "\u2B05\uFE0F Pa\u015F",
    confirm: "Pi\u015Ftrast bike",
    all: "Hem\xFB hilbij\xEAre",
    types: "1/4 \xB7 <b>Tu li \xE7i diger\xEE?</b>",
    location: "2/4 \xB7 <b>Li ku der\xEA bigere?</b>",
    allhh: "\u{1F310} Hem\xFB Hamburg",
    boroughs: "\u{1F3D9} Her\xEAm hilbij\xEAre",
    neighborhoods: "\u{1F4CD} Tax hilbij\xEAre",
    chooseB: "Ji 7 her\xEAm\xEAn Hamburg\xEA yek an \xE7end hilbij\xEAre.",
    chooseN: "Tax\xEAn ku dixwaz\xEE hilbij\xEAre. Hem\xFB 104 tax t\xEAne hesibandin.",
    all104: "Hem\xFB 104",
    clear: "Paqij bike",
    rent: "3/4 \xB7 <b>Her\xEE z\xEAde kir\xEAya germ</b>",
    custom: "\u270F\uFE0F Meblaqa xwe",
    enter: "Kir\xEAya germ biniv\xEEse, m\xEEnak <code>1250</code>.",
    area: "4/4 \xB7 <b>K\xEAmtir\xEEn r\xFBber</b>",
    none: "B\xEA s\xEEnor",
    review: "\u2705 <b>Prof\xEEl\xEA kontrol bike</b>",
    activate: "\u2705 L\xEAger\xEEn\xEA \xE7alak bike",
    settings: "\u2699\uFE0F M\xEEheng",
    language: "\u{1F310} Ziman",
    saved: "\u{1F4BE} \xCElan\xEAn tomar kir\xEE",
    nosaved: "H\xEAj \xEElanek tomar nekiriye.",
    created: "\u2705 L\xEAger\xEEna te \xE7alak e.",
    use: "Bi\u015Fkok\xEAn bin\xEA peyam\xEA bikar b\xEEne.",
    save: "\u{1F4BE} Tomar bike",
    savedState: "\u2705 Tomarkir\xEE",
    maps: "\u{1F4CD} Google Maps",
    openSaved: "\xCElan\xEA n\xEE\u015Fan bide",
    missing: "nehatiye day\xEEn",
    coldRent: "Kir\xEAya sar",
    warmRent: "Kir\xEAya germ",
    heating: "Germkirin",
    additional: "Mesref\xEAn din",
    deposit: "Depoz\xEEto",
    address: "Navn\xEE\u015Fan",
    rooms: "Ode",
    areaLabel: "R\xFBber"
  }
};
LANGS.ru = "\u{1F1F7}\u{1F1FA} \u0420\u0443\u0441\u0441\u043A\u0438\u0439";
TXT.ru = {
  welcome: "\u{1F3E0} <b>Traumwohnung Hamburg</b>\n\n\u0410\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043D\u0430\u0445\u043E\u0434\u0438\u0442\u0435 \u043F\u043E\u0434\u0445\u043E\u0434\u044F\u0449\u0443\u044E \u0430\u0440\u0435\u043D\u0434\u0443 \u043F\u043E \u0432\u0441\u0435\u043C\u0443 \u0413\u0430\u043C\u0431\u0443\u0440\u0433\u0443.",
  create: "\u{1F50E} \u0421\u043E\u0437\u0434\u0430\u0442\u044C \u043F\u043E\u0438\u0441\u043A",
  back: "\u2190 \u041D\u0430\u0437\u0430\u0434",
  confirm: "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C",
  all: "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0432\u0441\u0451",
  types: "1/5 \xB7 <b>\u0427\u0442\u043E \u0432\u044B \u0438\u0449\u0435\u0442\u0435?</b>\n\n\u041C\u043E\u0436\u043D\u043E \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0432\u0430\u0440\u0438\u0430\u043D\u0442\u043E\u0432.",
  location: "2/5 \xB7 <b>\u0413\u0434\u0435 \u0432\u044B \u0445\u043E\u0442\u0438\u0442\u0435 \u0438\u0441\u043A\u0430\u0442\u044C?</b>",
  allhh: "\u{1F310} \u0412\u0435\u0441\u044C \u0413\u0430\u043C\u0431\u0443\u0440\u0433",
  boroughs: "\u{1F3D9} \u0412\u044B\u0431\u0440\u0430\u0442\u044C \u043E\u043A\u0440\u0443\u0433\u0430",
  neighborhoods: "\u{1F4CD} \u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0440\u0430\u0439\u043E\u043D\u044B",
  chooseB: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043E\u0434\u0438\u043D \u0438\u043B\u0438 \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0438\u0437 7 \u043E\u043A\u0440\u0443\u0433\u043E\u0432 \u0413\u0430\u043C\u0431\u0443\u0440\u0433\u0430.",
  chooseN: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043D\u0443\u0436\u043D\u044B\u0435 \u0440\u0430\u0439\u043E\u043D\u044B.",
  all104: "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0432\u0441\u0435",
  clear: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0432\u044B\u0431\u043E\u0440",
  rent: "3/5 \xB7 <b>\u041C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0430\u0440\u0435\u043D\u0434\u0430 \u0441 \u043A\u043E\u043C\u043C\u0443\u043D\u0430\u043B\u044C\u043D\u044B\u043C\u0438</b>",
  custom: "\u270F\uFE0F \u0421\u0432\u043E\u044F \u0441\u0443\u043C\u043C\u0430",
  enter: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043C\u0430\u043A\u0441\u0438\u043C\u0430\u043B\u044C\u043D\u0443\u044E \u0430\u0440\u0435\u043D\u0434\u0443, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 <code>1250</code>.",
  area: "5/5 \xB7 <b>\u041C\u0438\u043D\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u043F\u043B\u043E\u0449\u0430\u0434\u044C</b>",
  none: "\u0411\u0435\u0437 \u043C\u0438\u043D\u0438\u043C\u0443\u043C\u0430",
  review: "\u2705 <b>\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u043F\u0440\u043E\u0444\u0438\u043B\u044C \u043F\u043E\u0438\u0441\u043A\u0430</b>",
  activate: "\u2705 \u0410\u043A\u0442\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043F\u043E\u0438\u0441\u043A",
  settings: "\u2699\uFE0F \u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
  language: "\u{1F310} \u042F\u0437\u044B\u043A",
  saved: "\u2B50\uFE0F \u0421\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0435 \u043E\u0431\u044A\u044F\u0432\u043B\u0435\u043D\u0438\u044F",
  nosaved: "\u0421\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0445 \u043E\u0431\u044A\u044F\u0432\u043B\u0435\u043D\u0438\u0439 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442.",
  created: "\u2705 \u041F\u043E\u0438\u0441\u043A \u0430\u043A\u0442\u0438\u0432\u0435\u043D. \u041D\u043E\u0432\u044B\u0435 \u043F\u043E\u0434\u0445\u043E\u0434\u044F\u0449\u0438\u0435 \u043E\u0431\u044A\u044F\u0432\u043B\u0435\u043D\u0438\u044F \u0431\u0443\u0434\u0443\u0442 \u0434\u043E\u0441\u0442\u0430\u0432\u043B\u044F\u0442\u044C\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438.",
  use: "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439\u0442\u0435 \u043A\u043D\u043E\u043F\u043A\u0438 \u043F\u043E\u0434 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435\u043C.",
  save: "\u2B50\uFE0F \u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C",
  savedState: "\u2B50\uFE0F \u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E",
  maps: "\u{1F4CD} Google Maps",
  openSaved: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043E\u0431\u044A\u044F\u0432\u043B\u0435\u043D\u0438\u0435",
  missing: "\u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u043E",
  coldRent: "\u0425\u043E\u043B\u043E\u0434\u043D\u0430\u044F \u0430\u0440\u0435\u043D\u0434\u0430",
  warmRent: "\u0410\u0440\u0435\u043D\u0434\u0430 \u0441 \u043A\u043E\u043C\u043C\u0443\u043D\u0430\u043B\u044C\u043D\u044B\u043C\u0438",
  heating: "\u041E\u0442\u043E\u043F\u043B\u0435\u043D\u0438\u0435",
  additional: "\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u044B",
  deposit: "\u0417\u0430\u043B\u043E\u0433",
  address: "\u0410\u0434\u0440\u0435\u0441",
  rooms: "\u041A\u043E\u043C\u043D\u0430\u0442\u044B",
  areaLabel: "\u041F\u043B\u043E\u0449\u0430\u0434\u044C"
};
delete LANGS.ps;
delete LANGS.bad;
for (const lang of Object.keys(TXT)) {
  for (const [a, b] of [["1/4", "1/5"], ["2/4", "2/5"], ["3/4", "3/5"], ["4/4", "5/5"]]) {
    for (const key of Object.keys(TXT[lang] || {}))
      TXT[lang][key] = String(TXT[lang][key]).replace(a, b);
  }
  if (TXT[lang]?.save)
    TXT[lang].save = TXT[lang].save.replace("\u{1F4BE}", "\u2B50\uFE0F");
  if (TXT[lang]?.saved)
    TXT[lang].saved = TXT[lang].saved.replace("\u{1F4BE}", "\u2B50\uFE0F");
  if (TXT[lang]?.savedState)
    TXT[lang].savedState = TXT[lang].savedState.replace("\u2705", "\u2B50\uFE0F").replace("\u{1F4BE}", "\u2B50\uFE0F");
}
var EXTRA = {
  en: { "Suchprofil": "Search profile", "Meine Suchprofile": "My search profiles", "Suchprofile angelegt": "search profiles created", "Suchprofile aktiv": "Active search profiles", "Premium aktiv": "Premium active", "Traumwohnung Premium": "Traumwohnung Premium", "Premium ist aktiv.": "Premium is active.", "Deine Vorteile:": "Your benefits:", "Sofortige Zustellung": "Instant delivery", "Bis zu 3 Suchprofile": "Up to 3 search profiles", "Baugenossenschafts-Angebote \xF6ffnen": "Open housing-cooperative listings", "Inserate speichern": "Save listings", "Keine Mindestlaufzeit \xB7 jederzeit k\xFCndbar": "No minimum term \xB7 cancel anytime", "Premium freischalten": "Unlock Premium", "Abo verwalten": "Manage subscription", "Freunde empfehlen": "Refer friends", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos": "Recommend Traumwohnung Hamburg and you both receive 7 days Premium for free", "Erfolgreiche Empfehlungen": "Successful referrals", "Sprachen": "Languages", "W\xE4hle deine Sprache. Das komplette Bot-Men\xFC wird entsprechend angezeigt.": "Choose your language. The complete bot menu will be shown accordingly.", "Quellen im System": "Sources in the system", "Systemstatus": "System status", "System: online": "System: online", "Suchprofil erstellen": "Create search profile", "Noch kein Suchprofil angelegt.": "No search profile yet.", "Suchprofil \xE4ndern": "Edit search profile", "Pausieren": "Pause", "Fortsetzen": "Resume", "Gespeichert": "Saved", "Hilfe": "Help", "Status": "Status", "Einstellungen": "Settings", "Entwurf fortsetzen": "Continue draft" },
  tr: { "Suchprofil": "Arama profili", "Meine Suchprofile": "Arama profillerim", "Suchprofile angelegt": "arama profili olu\u015Fturuldu", "Suchprofile aktiv": "Aktif arama profilleri", "Premium aktiv": "Premium aktif", "Premium ist aktiv.": "Premium aktif.", "Deine Vorteile:": "Avantajlar\u0131n:", "Sofortige Zustellung": "An\u0131nda teslim", "Bis zu 3 Suchprofile": "3 arama profiline kadar", "Baugenossenschafts-Angebote \xF6ffnen": "Konut kooperatifi ilanlar\u0131n\u0131 a\xE7", "Inserate speichern": "\u0130lanlar\u0131 kaydet", "Keine Mindestlaufzeit \xB7 jederzeit k\xFCndbar": "Minimum s\xFCre yok \xB7 istedi\u011Fin zaman iptal", "Premium freischalten": "Premium'u a\xE7", "Abo verwalten": "Aboneli\u011Fi y\xF6net", "Freunde empfehlen": "Arkada\u015Flar\u0131n\u0131 davet et", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos": "Traumwohnung Hamburg'u \xF6nerin; ikiniz de 7 g\xFCn Premium'u \xFCcretsiz al\u0131n", "Erfolgreiche Empfehlungen": "Ba\u015Far\u0131l\u0131 davetler", "Sprachen": "Diller", "W\xE4hle deine Sprache. Das komplette Bot-Men\xFC wird entsprechend angezeigt.": "Dilini se\xE7. Bot men\xFCs\xFCn\xFCn tamam\u0131 buna g\xF6re g\xF6sterilir.", "Quellen im System": "Sistemdeki kaynaklar", "Systemstatus": "Sistem durumu", "System: online": "Sistem: \xE7evrimi\xE7i", "Suchprofil erstellen": "Arama profili olu\u015Ftur", "Noch kein Suchprofil angelegt.": "Hen\xFCz arama profili yok.", "Suchprofil \xE4ndern": "Arama profilini d\xFCzenle", "Pausieren": "Duraklat", "Fortsetzen": "Devam et", "Gespeichert": "Kaydedildi", "Hilfe": "Yard\u0131m", "Status": "Durum", "Einstellungen": "Ayarlar", "Entwurf fortsetzen": "Tasla\u011Fa devam et" },
  ru: { "Suchprofil": "\u041F\u0440\u043E\u0444\u0438\u043B\u044C \u043F\u043E\u0438\u0441\u043A\u0430", "Meine Suchprofile": "\u041C\u043E\u0438 \u043F\u0440\u043E\u0444\u0438\u043B\u0438 \u043F\u043E\u0438\u0441\u043A\u0430", "Suchprofile angelegt": "\u043F\u0440\u043E\u0444\u0438\u043B\u0435\u0439 \u043F\u043E\u0438\u0441\u043A\u0430 \u0441\u043E\u0437\u0434\u0430\u043D\u043E", "Suchprofile aktiv": "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0435 \u043F\u0440\u043E\u0444\u0438\u043B\u0438 \u043F\u043E\u0438\u0441\u043A\u0430", "Premium aktiv": "Premium \u0430\u043A\u0442\u0438\u0432\u0435\u043D", "Premium ist aktiv.": "Premium \u0430\u043A\u0442\u0438\u0432\u0435\u043D.", "Deine Vorteile:": "\u0412\u0430\u0448\u0438 \u043F\u0440\u0435\u0438\u043C\u0443\u0449\u0435\u0441\u0442\u0432\u0430:", "Sofortige Zustellung": "\u041C\u0433\u043D\u043E\u0432\u0435\u043D\u043D\u0430\u044F \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0430", "Bis zu 3 Suchprofile": "\u0414\u043E 3 \u043F\u0440\u043E\u0444\u0438\u043B\u0435\u0439 \u043F\u043E\u0438\u0441\u043A\u0430", "Baugenossenschafts-Angebote \xF6ffnen": "\u041E\u0442\u043A\u0440\u044B\u0432\u0430\u0442\u044C \u043E\u0431\u044A\u044F\u0432\u043B\u0435\u043D\u0438\u044F \u0436\u0438\u043B\u0438\u0449\u043D\u044B\u0445 \u043A\u043E\u043E\u043F\u0435\u0440\u0430\u0442\u0438\u0432\u043E\u0432", "Inserate speichern": "\u0421\u043E\u0445\u0440\u0430\u043D\u044F\u0442\u044C \u043E\u0431\u044A\u044F\u0432\u043B\u0435\u043D\u0438\u044F", "Keine Mindestlaufzeit \xB7 jederzeit k\xFCndbar": "\u0411\u0435\u0437 \u043C\u0438\u043D\u0438\u043C\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u0441\u0440\u043E\u043A\u0430 \xB7 \u043E\u0442\u043C\u0435\u043D\u0430 \u0432 \u043B\u044E\u0431\u043E\u0435 \u0432\u0440\u0435\u043C\u044F", "Premium freischalten": "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u044C Premium", "Abo verwalten": "\u0423\u043F\u0440\u0430\u0432\u043B\u044F\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u043E\u0439", "Freunde empfehlen": "\u041F\u0440\u0438\u0433\u043B\u0430\u0441\u0438\u0442\u044C \u0434\u0440\u0443\u0437\u0435\u0439", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos": "\u041F\u043E\u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0443\u0439\u0442\u0435 Traumwohnung Hamburg \u2014 \u0432\u044B \u043E\u0431\u0430 \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u0435 7 \u0434\u043D\u0435\u0439 Premium \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E", "Erfolgreiche Empfehlungen": "\u0423\u0441\u043F\u0435\u0448\u043D\u044B\u0435 \u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0430\u0446\u0438\u0438", "Sprachen": "\u042F\u0437\u044B\u043A\u0438", "W\xE4hle deine Sprache. Das komplette Bot-Men\xFC wird entsprechend angezeigt.": "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u044F\u0437\u044B\u043A. \u0412\u0441\u0451 \u043C\u0435\u043D\u044E \u0431\u043E\u0442\u0430 \u0431\u0443\u0434\u0435\u0442 \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u043E \u043D\u0430 \u043D\u0451\u043C.", "Quellen im System": "\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0438 \u0432 \u0441\u0438\u0441\u0442\u0435\u043C\u0435", "Systemstatus": "\u0421\u0442\u0430\u0442\u0443\u0441 \u0441\u0438\u0441\u0442\u0435\u043C\u044B", "System: online": "\u0421\u0438\u0441\u0442\u0435\u043C\u0430: \u043E\u043D\u043B\u0430\u0439\u043D", "Suchprofil erstellen": "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u043F\u0440\u043E\u0444\u0438\u043B\u044C \u043F\u043E\u0438\u0441\u043A\u0430", "Noch kein Suchprofil angelegt.": "\u041F\u0440\u043E\u0444\u0438\u043B\u044C \u043F\u043E\u0438\u0441\u043A\u0430 \u043F\u043E\u043A\u0430 \u043D\u0435 \u0441\u043E\u0437\u0434\u0430\u043D.", "Suchprofil \xE4ndern": "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u043F\u0440\u043E\u0444\u0438\u043B\u044C \u043F\u043E\u0438\u0441\u043A\u0430", "Pausieren": "\u041F\u0430\u0443\u0437\u0430", "Fortsetzen": "\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C", "Gespeichert": "\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E", "Hilfe": "\u041F\u043E\u043C\u043E\u0449\u044C", "Status": "\u0421\u0442\u0430\u0442\u0443\u0441", "Einstellungen": "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438", "Entwurf fortsetzen": "\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C \u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A" },
  ar: { "Suchprofil": "\u0645\u0644\u0641 \u0627\u0644\u0628\u062D\u062B", "Meine Suchprofile": "\u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0628\u062D\u062B \u0627\u0644\u062E\u0627\u0635\u0629 \u0628\u064A", "Suchprofile angelegt": "\u0645\u0644\u0641\u0627\u062A \u0628\u062D\u062B \u062A\u0645 \u0625\u0646\u0634\u0627\u0624\u0647\u0627", "Suchprofile aktiv": "\u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0628\u062D\u062B \u0627\u0644\u0646\u0634\u0637\u0629", "Premium aktiv": "Premium \u0645\u0641\u0639\u0651\u0644", "Premium ist aktiv.": "Premium \u0645\u0641\u0639\u0651\u0644.", "Deine Vorteile:": "\u0645\u0632\u0627\u064A\u0627\u0643:", "Sofortige Zustellung": "\u0625\u0631\u0633\u0627\u0644 \u0641\u0648\u0631\u064A", "Bis zu 3 Suchprofile": "\u062D\u062A\u0649 3 \u0645\u0644\u0641\u0627\u062A \u0628\u062D\u062B", "Baugenossenschafts-Angebote \xF6ffnen": "\u0641\u062A\u062D \u0639\u0631\u0648\u0636 \u062A\u0639\u0627\u0648\u0646\u064A\u0627\u062A \u0627\u0644\u0625\u0633\u0643\u0627\u0646", "Inserate speichern": "\u062D\u0641\u0638 \u0627\u0644\u0625\u0639\u0644\u0627\u0646\u0627\u062A", "Keine Mindestlaufzeit \xB7 jederzeit k\xFCndbar": "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u062F\u0629 \u062F\u0646\u064A\u0627 \xB7 \u0625\u0644\u063A\u0627\u0621 \u0641\u064A \u0623\u064A \u0648\u0642\u062A", "Premium freischalten": "\u062A\u0641\u0639\u064A\u0644 Premium", "Abo verwalten": "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643", "Freunde empfehlen": "\u062F\u0639\u0648\u0629 \u0627\u0644\u0623\u0635\u062F\u0642\u0627\u0621", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos": "\u0631\u0634\u0651\u062D Traumwohnung Hamburg \u0648\u0633\u064A\u062D\u0635\u0644 \u0643\u0644\u0627\u0643\u0645\u0627 \u0639\u0644\u0649 7 \u0623\u064A\u0627\u0645 Premium \u0645\u062C\u0627\u0646\u064B\u0627", "Erfolgreiche Empfehlungen": "\u0627\u0644\u0625\u062D\u0627\u0644\u0627\u062A \u0627\u0644\u0646\u0627\u062C\u062D\u0629", "Sprachen": "\u0627\u0644\u0644\u063A\u0627\u062A", "W\xE4hle deine Sprache. Das komplette Bot-Men\xFC wird entsprechend angezeigt.": "\u0627\u062E\u062A\u0631 \u0644\u063A\u062A\u0643. \u0633\u062A\u0638\u0647\u0631 \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0628\u0648\u062A \u0643\u0627\u0645\u0644\u0629 \u0628\u0647\u0630\u0647 \u0627\u0644\u0644\u063A\u0629.", "Quellen im System": "\u0627\u0644\u0645\u0635\u0627\u062F\u0631 \u0641\u064A \u0627\u0644\u0646\u0638\u0627\u0645", "Systemstatus": "\u062D\u0627\u0644\u0629 \u0627\u0644\u0646\u0638\u0627\u0645", "System: online": "\u0627\u0644\u0646\u0638\u0627\u0645: \u0645\u062A\u0635\u0644", "Suchprofil erstellen": "\u0625\u0646\u0634\u0627\u0621 \u0645\u0644\u0641 \u0628\u062D\u062B", "Noch kein Suchprofil angelegt.": "\u0644\u0645 \u064A\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0645\u0644\u0641 \u0628\u062D\u062B \u0628\u0639\u062F.", "Suchprofil \xE4ndern": "\u062A\u0639\u062F\u064A\u0644 \u0645\u0644\u0641 \u0627\u0644\u0628\u062D\u062B", "Pausieren": "\u0625\u064A\u0642\u0627\u0641 \u0645\u0624\u0642\u062A", "Fortsetzen": "\u0645\u062A\u0627\u0628\u0639\u0629", "Gespeichert": "\u062A\u0645 \u0627\u0644\u062D\u0641\u0638", "Hilfe": "\u0645\u0633\u0627\u0639\u062F\u0629", "Status": "\u0627\u0644\u062D\u0627\u0644\u0629", "Einstellungen": "\u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A", "Entwurf fortsetzen": "\u0645\u062A\u0627\u0628\u0639\u0629 \u0627\u0644\u0645\u0633\u0648\u062F\u0629" },
  fa: { "Suchprofil": "\u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u0633\u062A\u062C\u0648", "Meine Suchprofile": "\u067E\u0631\u0648\u0641\u0627\u06CC\u0644\u200C\u0647\u0627\u06CC \u062C\u0633\u062A\u062C\u0648\u06CC \u0645\u0646", "Suchprofile angelegt": "\u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u0633\u062A\u062C\u0648 \u0633\u0627\u062E\u062A\u0647 \u0634\u062F\u0647", "Suchprofile aktiv": "\u067E\u0631\u0648\u0641\u0627\u06CC\u0644\u200C\u0647\u0627\u06CC \u062C\u0633\u062A\u062C\u0648\u06CC \u0641\u0639\u0627\u0644", "Premium aktiv": "Premium \u0641\u0639\u0627\u0644", "Premium ist aktiv.": "Premium \u0641\u0639\u0627\u0644 \u0627\u0633\u062A.", "Deine Vorteile:": "\u0645\u0632\u0627\u06CC\u0627\u06CC \u0634\u0645\u0627:", "Sofortige Zustellung": "\u0627\u0631\u0633\u0627\u0644 \u0641\u0648\u0631\u06CC", "Bis zu 3 Suchprofile": "\u062A\u0627 \u06F3 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u0633\u062A\u062C\u0648", "Baugenossenschafts-Angebote \xF6ffnen": "\u0628\u0627\u0632 \u06A9\u0631\u062F\u0646 \u0622\u06AF\u0647\u06CC\u200C\u0647\u0627\u06CC \u062A\u0639\u0627\u0648\u0646\u06CC \u0645\u0633\u06A9\u0646", "Inserate speichern": "\u0630\u062E\u06CC\u0631\u0647 \u0622\u06AF\u0647\u06CC\u200C\u0647\u0627", "Keine Mindestlaufzeit \xB7 jederzeit k\xFCndbar": "\u0628\u062F\u0648\u0646 \u062D\u062F\u0627\u0642\u0644 \u0645\u062F\u062A \xB7 \u0644\u063A\u0648 \u062F\u0631 \u0647\u0631 \u0632\u0645\u0627\u0646", "Premium freischalten": "\u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC Premium", "Abo verwalten": "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0627\u0634\u062A\u0631\u0627\u06A9", "Freunde empfehlen": "\u0645\u0639\u0631\u0641\u06CC \u0628\u0647 \u062F\u0648\u0633\u062A\u0627\u0646", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos": "Traumwohnung Hamburg \u0631\u0627 \u0645\u0639\u0631\u0641\u06CC \u06A9\u0646\u06CC\u062F \u0648 \u0647\u0631 \u062F\u0648\u06CC \u0634\u0645\u0627 \u06F7 \u0631\u0648\u0632 Premium \u0631\u0627\u06CC\u06AF\u0627\u0646 \u062F\u0631\u06CC\u0627\u0641\u062A \u0645\u06CC\u200C\u06A9\u0646\u06CC\u062F", "Erfolgreiche Empfehlungen": "\u0645\u0639\u0631\u0641\u06CC\u200C\u0647\u0627\u06CC \u0645\u0648\u0641\u0642", "Sprachen": "\u0632\u0628\u0627\u0646\u200C\u0647\u0627", "W\xE4hle deine Sprache. Das komplette Bot-Men\xFC wird entsprechend angezeigt.": "\u0632\u0628\u0627\u0646 \u062E\u0648\u062F \u0631\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646\u06CC\u062F. \u062A\u0645\u0627\u0645 \u0645\u0646\u0648\u06CC \u0631\u0628\u0627\u062A \u0628\u0647 \u0622\u0646 \u0632\u0628\u0627\u0646 \u0646\u0645\u0627\u06CC\u0634 \u062F\u0627\u062F\u0647 \u0645\u06CC\u200C\u0634\u0648\u062F.", "Quellen im System": "\u0645\u0646\u0627\u0628\u0639 \u062F\u0631 \u0633\u06CC\u0633\u062A\u0645", "Systemstatus": "\u0648\u0636\u0639\u06CC\u062A \u0633\u06CC\u0633\u062A\u0645", "System: online": "\u0633\u06CC\u0633\u062A\u0645: \u0622\u0646\u0644\u0627\u06CC\u0646", "Suchprofil erstellen": "\u0633\u0627\u062E\u062A \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u0633\u062A\u062C\u0648", "Noch kein Suchprofil angelegt.": "\u0647\u0646\u0648\u0632 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u0633\u062A\u062C\u0648 \u0633\u0627\u062E\u062A\u0647 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A.", "Suchprofil \xE4ndern": "\u0648\u06CC\u0631\u0627\u06CC\u0634 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u0633\u062A\u062C\u0648", "Pausieren": "\u062A\u0648\u0642\u0641", "Fortsetzen": "\u0627\u062F\u0627\u0645\u0647", "Gespeichert": "\u0630\u062E\u06CC\u0631\u0647 \u0634\u062F", "Hilfe": "\u0631\u0627\u0647\u0646\u0645\u0627", "Status": "\u0648\u0636\u0639\u06CC\u062A", "Einstellungen": "\u062A\u0646\u0638\u06CC\u0645\u0627\u062A", "Entwurf fortsetzen": "\u0627\u062F\u0627\u0645\u0647 \u067E\u06CC\u0634\u200C\u0646\u0648\u06CC\u0633" },
  prs: { "Suchprofil": "\u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u0633\u062A\u062C\u0648", "Meine Suchprofile": "\u067E\u0631\u0648\u0641\u0627\u06CC\u0644\u200C\u0647\u0627\u06CC \u062C\u0633\u062A\u062C\u0648\u06CC \u0645\u0646", "Suchprofile angelegt": "\u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u0633\u062A\u062C\u0648 \u0633\u0627\u062E\u062A\u0647 \u0634\u062F\u0647", "Suchprofile aktiv": "\u067E\u0631\u0648\u0641\u0627\u06CC\u0644\u200C\u0647\u0627\u06CC \u062C\u0633\u062A\u062C\u0648\u06CC \u0641\u0639\u0627\u0644", "Premium aktiv": "Premium \u0641\u0639\u0627\u0644", "Premium ist aktiv.": "Premium \u0641\u0639\u0627\u0644 \u0627\u0633\u062A.", "Deine Vorteile:": "\u0645\u0632\u0627\u06CC\u0627\u06CC \u0634\u0645\u0627:", "Sofortige Zustellung": "\u0627\u0631\u0633\u0627\u0644 \u0641\u0648\u0631\u06CC", "Bis zu 3 Suchprofile": "\u062A\u0627 \u06F3 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u0633\u062A\u062C\u0648", "Baugenossenschafts-Angebote \xF6ffnen": "\u0628\u0627\u0632 \u06A9\u0631\u062F\u0646 \u0622\u06AF\u0647\u06CC\u200C\u0647\u0627\u06CC \u062A\u0639\u0627\u0648\u0646\u06CC \u0645\u0633\u06A9\u0646", "Inserate speichern": "\u0630\u062E\u06CC\u0631\u0647 \u0622\u06AF\u0647\u06CC\u200C\u0647\u0627", "Keine Mindestlaufzeit \xB7 jederzeit k\xFCndbar": "\u0628\u062F\u0648\u0646 \u062D\u062F\u0627\u0642\u0644 \u0645\u062F\u062A \xB7 \u0644\u063A\u0648 \u062F\u0631 \u0647\u0631 \u0632\u0645\u0627\u0646", "Premium freischalten": "\u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC Premium", "Abo verwalten": "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0627\u0634\u062A\u0631\u0627\u06A9", "Freunde empfehlen": "\u0645\u0639\u0631\u0641\u06CC \u0628\u0647 \u062F\u0648\u0633\u062A\u0627\u0646", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos": "Traumwohnung Hamburg \u0631\u0627 \u0645\u0639\u0631\u0641\u06CC \u06A9\u0646\u06CC\u062F \u0648 \u0647\u0631 \u062F\u0648\u06CC \u0634\u0645\u0627 \u06F7 \u0631\u0648\u0632 Premium \u0631\u0627\u06CC\u06AF\u0627\u0646 \u062F\u0631\u06CC\u0627\u0641\u062A \u0645\u06CC\u200C\u06A9\u0646\u06CC\u062F", "Erfolgreiche Empfehlungen": "\u0645\u0639\u0631\u0641\u06CC\u200C\u0647\u0627\u06CC \u0645\u0648\u0641\u0642", "Sprachen": "\u0632\u0628\u0627\u0646\u200C\u0647\u0627", "W\xE4hle deine Sprache. Das komplette Bot-Men\xFC wird entsprechend angezeigt.": "\u0632\u0628\u0627\u0646 \u062E\u0648\u062F \u0631\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646\u06CC\u062F. \u062A\u0645\u0627\u0645 \u0645\u0646\u0648\u06CC \u0631\u0628\u0627\u062A \u0628\u0647 \u0622\u0646 \u0632\u0628\u0627\u0646 \u0646\u0645\u0627\u06CC\u0634 \u062F\u0627\u062F\u0647 \u0645\u06CC\u200C\u0634\u0648\u062F.", "Quellen im System": "\u0645\u0646\u0627\u0628\u0639 \u062F\u0631 \u0633\u06CC\u0633\u062A\u0645", "Systemstatus": "\u0648\u0636\u0639\u06CC\u062A \u0633\u06CC\u0633\u062A\u0645", "System: online": "\u0633\u06CC\u0633\u062A\u0645: \u0622\u0646\u0644\u0627\u06CC\u0646", "Suchprofil erstellen": "\u0633\u0627\u062E\u062A \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u0633\u062A\u062C\u0648", "Noch kein Suchprofil angelegt.": "\u0647\u0646\u0648\u0632 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u0633\u062A\u062C\u0648 \u0633\u0627\u062E\u062A\u0647 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A.", "Suchprofil \xE4ndern": "\u0648\u06CC\u0631\u0627\u06CC\u0634 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u062C\u0633\u062A\u062C\u0648", "Pausieren": "\u062A\u0648\u0642\u0641", "Fortsetzen": "\u0627\u062F\u0627\u0645\u0647", "Gespeichert": "\u0630\u062E\u06CC\u0631\u0647 \u0634\u062F", "Hilfe": "\u0631\u0627\u0647\u0646\u0645\u0627", "Status": "\u0648\u0636\u0639\u06CC\u062A", "Einstellungen": "\u062A\u0646\u0638\u06CC\u0645\u0627\u062A", "Entwurf fortsetzen": "\u0627\u062F\u0627\u0645\u0647 \u067E\u06CC\u0634\u200C\u0646\u0648\u06CC\u0633" },
  ckb: { "Suchprofil": "\u067E\u0695\u06C6\u0641\u0627\u06CC\u0644\u06CC \u06AF\u06D5\u0695\u0627\u0646", "Meine Suchprofile": "\u067E\u0695\u06C6\u0641\u0627\u06CC\u0644\u06D5\u06A9\u0627\u0646\u06CC \u06AF\u06D5\u0695\u0627\u0646\u0645", "Suchprofile angelegt": "\u067E\u0695\u06C6\u0641\u0627\u06CC\u0644\u06CC \u06AF\u06D5\u0695\u0627\u0646 \u062F\u0631\u0648\u0633\u062A\u06A9\u0631\u0627\u0648\u06D5", "Suchprofile aktiv": "\u067E\u0695\u06C6\u0641\u0627\u06CC\u0644\u06D5 \u0686\u0627\u0644\u0627\u06A9\u06D5\u06A9\u0627\u0646\u06CC \u06AF\u06D5\u0695\u0627\u0646", "Premium aktiv": "Premium \u0686\u0627\u0644\u0627\u06A9", "Premium ist aktiv.": "Premium \u0686\u0627\u0644\u0627\u06A9\u06D5.", "Deine Vorteile:": "\u0633\u0648\u0648\u062F\u06D5\u06A9\u0627\u0646\u062A:", "Sofortige Zustellung": "\u06AF\u06D5\u06CC\u0627\u0646\u062F\u0646\u06CC \u062F\u06D5\u0633\u062A\u0628\u06D5\u062C\u06CE", "Bis zu 3 Suchprofile": "\u062A\u0627 \u0663 \u067E\u0695\u06C6\u0641\u0627\u06CC\u0644\u06CC \u06AF\u06D5\u0695\u0627\u0646", "Baugenossenschafts-Angebote \xF6ffnen": "\u06A9\u0631\u062F\u0646\u06D5\u0648\u06D5\u06CC \u0695\u06CC\u06A9\u0644\u0627\u0645\u06D5\u06A9\u0627\u0646\u06CC \u06A9\u06C6\u0645\u06D5\u06B5\u06D5\u06CC \u0646\u06CC\u0634\u062A\u06D5\u062C\u06CE\u0628\u0648\u0648\u0646", "Inserate speichern": "\u067E\u0627\u0634\u06D5\u06A9\u06D5\u0648\u062A\u06A9\u0631\u062F\u0646\u06CC \u0695\u06CC\u06A9\u0644\u0627\u0645\u06D5\u06A9\u0627\u0646", "Keine Mindestlaufzeit \xB7 jederzeit k\xFCndbar": "\u0647\u06CC\u0686 \u0645\u0627\u0648\u06D5\u06CC \u06A9\u06D5\u0645\u062A\u0631\u06CC\u0646 \u0646\u06CC\u06CC\u06D5 \xB7 \u0647\u06D5\u0631\u06A9\u0627\u062A \u062F\u06D5\u062A\u0648\u0627\u0646\u06CC\u062A \u0647\u06D5\u06B5\u0628\u0648\u06D5\u0634\u06CE\u0646\u06CC\u062A\u06D5\u0648\u06D5", "Premium freischalten": "Premium \u0686\u0627\u0644\u0627\u06A9 \u0628\u06A9\u06D5", "Abo verwalten": "\u0628\u06D5\u0695\u06CE\u0648\u06D5\u0628\u0631\u062F\u0646\u06CC \u0628\u06D5\u0634\u062F\u0627\u0631\u06CC", "Freunde empfehlen": "\u0647\u0627\u0648\u0695\u06CE \u067E\u06CE\u0634\u0646\u06CC\u0627\u0631 \u0628\u06A9\u06D5", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos": "Traumwohnung Hamburg \u067E\u06CE\u0634\u0646\u06CC\u0627\u0631 \u0628\u06A9\u06D5 \u0648 \u0647\u06D5\u0631\u062F\u0648\u0648\u06A9\u062A\u0627\u0646 \u0667 \u0695\u06C6\u0698 Premium \u0628\u06D5\u062E\u06C6\u0695\u0627\u06CC\u06CC \u0648\u06D5\u0631\u062F\u06D5\u06AF\u0631\u0646", "Erfolgreiche Empfehlungen": "\u067E\u06CE\u0634\u0646\u06CC\u0627\u0631\u06D5 \u0633\u06D5\u0631\u06A9\u06D5\u0648\u062A\u0648\u0648\u06D5\u06A9\u0627\u0646", "Sprachen": "\u0632\u0645\u0627\u0646\u06D5\u06A9\u0627\u0646", "W\xE4hle deine Sprache. Das komplette Bot-Men\xFC wird entsprechend angezeigt.": "\u0632\u0645\u0627\u0646\u06D5\u06A9\u06D5\u062A \u0647\u06D5\u06B5\u0628\u0698\u06CE\u0631\u06D5. \u0647\u06D5\u0645\u0648\u0648 \u0645\u06CC\u0646\u06CC\u0648\u06CC \u0628\u06C6\u062A \u0628\u06D5\u0648 \u0632\u0645\u0627\u0646\u06D5 \u067E\u06CC\u0634\u0627\u0646 \u062F\u06D5\u062F\u0631\u06CE\u062A.", "Quellen im System": "\u0633\u06D5\u0631\u0686\u0627\u0648\u06D5\u06A9\u0627\u0646 \u0644\u06D5 \u0633\u06CC\u0633\u062A\u06D5\u0645", "Systemstatus": "\u062F\u06C6\u062E\u06CC \u0633\u06CC\u0633\u062A\u06D5\u0645", "System: online": "\u0633\u06CC\u0633\u062A\u06D5\u0645: \u0626\u06C6\u0646\u0644\u0627\u06CC\u0646", "Suchprofil erstellen": "\u062F\u0631\u0648\u0633\u062A\u06A9\u0631\u062F\u0646\u06CC \u067E\u0695\u06C6\u0641\u0627\u06CC\u0644\u06CC \u06AF\u06D5\u0695\u0627\u0646", "Noch kein Suchprofil angelegt.": "\u0647\u06CE\u0634\u062A\u0627 \u067E\u0695\u06C6\u0641\u0627\u06CC\u0644\u06CC \u06AF\u06D5\u0695\u0627\u0646 \u062F\u0631\u0648\u0633\u062A \u0646\u06D5\u06A9\u0631\u0627\u0648\u06D5.", "Suchprofil \xE4ndern": "\u062F\u06D5\u0633\u062A\u06A9\u0627\u0631\u06CC\u06A9\u0631\u062F\u0646\u06CC \u067E\u0695\u06C6\u0641\u0627\u06CC\u0644\u06CC \u06AF\u06D5\u0695\u0627\u0646", "Pausieren": "\u0648\u06D5\u0633\u062A\u0627\u0646\u062F\u0646", "Fortsetzen": "\u0628\u06D5\u0631\u062F\u06D5\u0648\u0627\u0645\u0628\u0648\u0648\u0646", "Gespeichert": "\u067E\u0627\u0634\u06D5\u06A9\u06D5\u0648\u062A\u06A9\u0631\u0627", "Hilfe": "\u06CC\u0627\u0631\u0645\u06D5\u062A\u06CC", "Status": "\u062F\u06C6\u062E", "Einstellungen": "\u0695\u06CE\u06A9\u062E\u0633\u062A\u0646\u06D5\u06A9\u0627\u0646", "Entwurf fortsetzen": "\u0628\u06D5\u0631\u062F\u06D5\u0648\u0627\u0645\u0628\u0648\u0648\u0646 \u0644\u06D5 \u0695\u06D5\u0634\u0646\u0648\u0648\u0633" },
  ku: { "Suchprofil": "Prof\xEEla l\xEAger\xEEn\xEA", "Meine Suchprofile": "Prof\xEEl\xEAn l\xEAger\xEEna min", "Suchprofile angelegt": "prof\xEEl\xEAn l\xEAger\xEEn\xEA hatine \xE7\xEAkirin", "Suchprofile aktiv": "Prof\xEEl\xEAn l\xEAger\xEEn\xEA y\xEAn \xE7alak", "Premium aktiv": "Premium \xE7alak", "Premium ist aktiv.": "Premium \xE7alak e.", "Deine Vorteile:": "Feydey\xEAn te:", "Sofortige Zustellung": "\u015Eandina yekser", "Bis zu 3 Suchprofile": "Heta 3 prof\xEEl\xEAn l\xEAger\xEEn\xEA", "Baugenossenschafts-Angebote \xF6ffnen": "\xCElan\xEAn kooperat\xEEf\xEAn xan\xEE vekin", "Inserate speichern": "\xCElanan tomar bike", "Keine Mindestlaufzeit \xB7 jederzeit k\xFCndbar": "Dem\xEA her\xEE k\xEAm tune \xB7 her dem dikar\xEE betal bik\xEE", "Premium freischalten": "Premium \xE7alak bike", "Abo verwalten": "Abonetiya bir\xEAve bibe", "Freunde empfehlen": "Hevalan p\xEA\u015Fniyar bike", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos": "Traumwohnung Hamburg p\xEA\u015Fniyar bike \xFB h\xFBn herdu 7 roj Premium bela\u015F bist\xEEnin", "Erfolgreiche Empfehlungen": "P\xEA\u015Fniyar\xEAn serket\xEE", "Sprachen": "Ziman", "W\xE4hle deine Sprache. Das komplette Bot-Men\xFC wird entsprechend angezeigt.": "Ziman\xEA xwe hilbij\xEAre. Hem\xFB menuya bot\xEA bi w\xEE ziman\xEE t\xEA n\xEE\u015Fandan.", "Quellen im System": "\xC7avkan\xEE di pergal\xEA de", "Systemstatus": "Rew\u015Fa pergal\xEA", "System: online": "Pergal: online", "Suchprofil erstellen": "Prof\xEEla l\xEAger\xEEn\xEA biafir\xEEne", "Noch kein Suchprofil angelegt.": "H\xEEn prof\xEElek l\xEAger\xEEn\xEA tune.", "Suchprofil \xE4ndern": "Prof\xEEla l\xEAger\xEEn\xEA biguher\xEEne", "Pausieren": "Rawest\xEEne", "Fortsetzen": "Bidom\xEEne", "Gespeichert": "Tomarkir\xEE", "Hilfe": "Al\xEEkar\xEE", "Status": "Rew\u015F", "Einstellungen": "M\xEEheng", "Entwurf fortsetzen": "P\xEA\u015Fniv\xEEs\xEA bidom\xEEne" }
};
Object.assign(EXTRA.en, { "30 Tage Premium f\xFCr 0 \u20AC": "30 days Premium for \u20AC0", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos \u{1F48E}": "Recommend Traumwohnung Hamburg and you both receive 30 days Premium for free \u{1F48E}", "Abbrechen": "Cancel" });
Object.assign(EXTRA.tr, { "30 Tage Premium f\xFCr 0 \u20AC": "0 \u20AC'ya 30 G\xFCn Premium", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos \u{1F48E}": "Traumwohnung Hamburg'u \xF6nerin; ikiniz de 30 g\xFCn Premium'u \xFCcretsiz al\u0131n \u{1F48E}", "Abbrechen": "\u0130ptal" });
Object.assign(EXTRA.ru, { "30 Tage Premium f\xFCr 0 \u20AC": "30 \u0434\u043D\u0435\u0439 Premium \u0437\u0430 0 \u20AC", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos \u{1F48E}": "\u041F\u043E\u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0443\u0439\u0442\u0435 Traumwohnung Hamburg \u2014 \u0432\u044B \u043E\u0431\u0430 \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u0435 30 \u0434\u043D\u0435\u0439 Premium \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E \u{1F48E}", "Abbrechen": "\u041E\u0442\u043C\u0435\u043D\u0430" });
Object.assign(EXTRA.ar, { "30 Tage Premium f\xFCr 0 \u20AC": "30 \u064A\u0648\u0645 Premium \u0645\u0642\u0627\u0628\u0644 0 \u20AC", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos \u{1F48E}": "\u0631\u0634\u0651\u062D Traumwohnung Hamburg \u0648\u0633\u064A\u062D\u0635\u0644 \u0643\u0644\u0627\u0643\u0645\u0627 \u0639\u0644\u0649 30 \u064A\u0648\u0645\u064B\u0627 \u0645\u0646 Premium \u0645\u062C\u0627\u0646\u064B\u0627 \u{1F48E}", "Abbrechen": "\u0625\u0644\u063A\u0627\u0621" });
Object.assign(EXTRA.fa, { "30 Tage Premium f\xFCr 0 \u20AC": "\u06F3\u06F0 \u0631\u0648\u0632 Premium \u0628\u0627 \u06F0 \u20AC", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos \u{1F48E}": "Traumwohnung Hamburg \u0631\u0627 \u0645\u0639\u0631\u0641\u06CC \u06A9\u0646\u06CC\u062F \u0648 \u0647\u0631 \u062F\u0648\u06CC \u0634\u0645\u0627 \u06F3\u06F0 \u0631\u0648\u0632 Premium \u0631\u0627\u06CC\u06AF\u0627\u0646 \u062F\u0631\u06CC\u0627\u0641\u062A \u0645\u06CC\u200C\u06A9\u0646\u06CC\u062F \u{1F48E}", "Abbrechen": "\u0644\u063A\u0648" });
Object.assign(EXTRA.prs, { "30 Tage Premium f\xFCr 0 \u20AC": "\u06F3\u06F0 \u0631\u0648\u0632 Premium \u0628\u0627 \u06F0 \u20AC", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos \u{1F48E}": "Traumwohnung Hamburg \u0631\u0627 \u0645\u0639\u0631\u0641\u06CC \u06A9\u0646\u06CC\u062F \u0648 \u0647\u0631 \u062F\u0648\u06CC \u0634\u0645\u0627 \u06F3\u06F0 \u0631\u0648\u0632 Premium \u0631\u0627\u06CC\u06AF\u0627\u0646 \u062F\u0631\u06CC\u0627\u0641\u062A \u0645\u06CC\u200C\u06A9\u0646\u06CC\u062F \u{1F48E}", "Abbrechen": "\u0644\u063A\u0648" });
Object.assign(EXTRA.ckb, { "30 Tage Premium f\xFCr 0 \u20AC": "\u0663\u0660 \u0695\u06C6\u0698 Premium \u0628\u06D5 \u0660 \u20AC", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos \u{1F48E}": "Traumwohnung Hamburg \u067E\u06CE\u0634\u0646\u06CC\u0627\u0631 \u0628\u06A9\u06D5 \u0648 \u0647\u06D5\u0631\u062F\u0648\u0648\u06A9\u062A\u0627\u0646 \u0663\u0660 \u0695\u06C6\u0698 Premium \u0628\u06D5\u062E\u06C6\u0695\u0627\u06CC\u06CC \u0648\u06D5\u0631\u062F\u06D5\u06AF\u0631\u0646 \u{1F48E}", "Abbrechen": "\u0647\u06D5\u06B5\u0648\u06D5\u0634\u0627\u0646\u062F\u0646\u06D5\u0648\u06D5" });
Object.assign(EXTRA.ku, { "30 Tage Premium f\xFCr 0 \u20AC": "30 roj Premium bi 0 \u20AC", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos \u{1F48E}": "Traumwohnung Hamburg p\xEA\u015Fniyar bike \xFB h\xFBn herdu 30 roj Premium bela\u015F bist\xEEnin \u{1F48E}", "Abbrechen": "Betal bike" });
var CURRENT_ALIASES = [
  ["\u{1F3E0} <b>Traumwohnung Hamburg</b>\n\nFinde passende Mietangebote in Hamburg \u2013 automatisch und direkt per Telegram.\n\nW\xE4hle unten, was du machen m\xF6chtest.", "welcome"],
  ["1/5 \xB7 <b>Was suchst du?</b>\n\nW\xE4hle eine oder mehrere Wohnungsarten.", "types"],
  ["2/5 \xB7 <b>Wo m\xF6chtest du suchen?</b>", "location"],
  ["W\xE4hle einen oder mehrere der 7 Bezirke.", "chooseB"],
  ["W\xE4hle beliebig viele Stadtteile.", "chooseN"],
  ["3/5 \xB7 <b>Maximale Warmmiete</b>", "rent"],
  ["5/5 \xB7 <b>Mindestfl\xE4che</b>", "area"],
  ["\u2705 <b>Suchprofil pr\xFCfen</b>", "review"],
  ["\u2705 Suche aktivieren", "activate"],
  ["\u2190 Zur\xFCck", "back"],
  ["Alle ausw\xE4hlen", "all"],
  ["Auswahl l\xF6schen", "clear"],
  ["\u270F\uFE0F Eigener Betrag", "custom"],
  ["\u2B50\uFE0F Gespeicherte Inserate", "saved"],
  ["\u2B50\uFE0F Gespeichert", "savedState"],
  ["\u2B50\uFE0F Speichern", "save"],
  ["\u{1F4CD} Google Maps", "maps"]
];
function localizeText(text, language) {
  const lang = language && TXT[language] ? language : "de";
  if (lang === "de")
    return text;
  let out = text;
  for (const [from, key] of CURRENT_ALIASES.sort((a, b) => b[0].length - a[0].length))
    out = out.split(from).join(TXT[lang]?.[key] || from);
  const extra = EXTRA[lang] || {};
  for (const from of Object.keys(extra).sort((a, b) => b.length - a.length))
    out = out.split(from).join(extra[from]);
  return out;
}
function localizeMarkup(markup, language) {
  if (!markup || typeof markup !== "object")
    return markup;
  const copy = structuredClone(markup);
  if (Array.isArray(copy.inline_keyboard)) {
    for (const row of copy.inline_keyboard)
      for (const item of row || [])
        if (item?.text)
          item.text = localizeText(String(item.text), language);
  }
  return copy;
}

// supabase/functions/telegram-ui/navigation.js
function homeKeyboard(user) {
  const rows = [
    [
      button("\u{1F50E} Suchprofil", "profile"),
      button(user.is_premium ? "\u2B50\uFE0F Gespeichert" : "\u{1F512} \u2B50\uFE0F Gespeichert", "saved")
    ],
    [
      button("\u2699\uFE0F Einstellungen", "settings"),
      button("\u2753 Hilfe", "help")
    ],
    [button("\u{1F48E} 30 Tage Premium f\xFCr 0 \u20AC", "referral")]
  ];
  return { inline_keyboard: rows };
}
function home(user, chatId, messageId) {
  const text = "\u{1F3E0} <b>Traumwohnung Hamburg</b>\n\nFinde passende Mietangebote in Hamburg \u2013 automatisch und direkt per Telegram.\n\nW\xE4hle unten, was du machen m\xF6chtest.";
  return messageId ? edit(chatId, messageId, text, homeKeyboard(user)) : send(chatId, text, homeKeyboard(user));
}
async function premium(user, chatId, messageId, messageHasPhoto = false) {
  const rows = [];
  let text;
  if (user.is_premium) {
    text = "\u{1F48E} <b>Traumwohnung Premium</b>\n\n\u2705 <b>Premium ist aktiv.</b>\n\n<b>Deine Vorteile:</b>\n\u26A1 Sofortige Zustellung\n\u{1F50E} Bis zu 3 Suchprofile\n\u{1F513} Baugenossenschafts-Angebote \xF6ffnen\n\u2B50\uFE0F Inserate speichern";
    rows.push([button("\u{1F4B3} Abo verwalten", "portal")]);
  } else {
    text = "\u{1F48E} <b>Traumwohnung Premium</b>\n\n<b>Deine Vorteile:</b>\n\u26A1 Sofortige Zustellung\n\u{1F50E} Bis zu 3 Suchprofile\n\u{1F513} Baugenossenschafts-Angebote \xF6ffnen\n\u2B50\uFE0F Inserate speichern\n\n<s>1,99 \u20AC</s> <b>0,99 \u20AC / Monat</b>\nKeine Mindestlaufzeit \xB7 jederzeit k\xFCndbar";
    rows.push([{ text: "\u{1F48E} Premium freischalten", url: `${PREMIUM_LINK}?client_reference_id=${encodeURIComponent(user.id)}` }]);
  }
  rows.push([button("\u2190 Zur\xFCck", "home")]);
  const markup = { inline_keyboard: rows };
  if (messageId && messageHasPhoto)
    return editPremiumPreview(chatId, messageId, text, markup);
  return sendPremiumPreview(chatId, text, markup);
}
async function saved(user, chatId, messageId, requestedPage = 0) {
  if (!user.is_premium)
    return premium(user, chatId, messageId);
  const { count, error: countError } = await db.from("saved_listings").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if (countError)
    throw countError;
  const total = count || 0;
  if (!total) {
    const text2 = "\u2B50\uFE0F <b>Gespeicherte Inserate</b>\n\nNoch keine Inserate gespeichert.";
    const markup2 = { inline_keyboard: [[button("\u2190 Zur\xFCck", "home")]] };
    return messageId ? edit(chatId, messageId, text2, markup2) : send(chatId, text2, markup2);
  }
  const pages = Math.max(1, Math.ceil(total / SAVED_PAGE_SIZE));
  const page = Math.max(0, Math.min(Number(requestedPage) || 0, pages - 1));
  const from = page * SAVED_PAGE_SIZE;
  const to = from + SAVED_PAGE_SIZE - 1;
  const { data, error } = await db.from("saved_listings").select("listing_id,created_at,listings(title,canonical_url,is_active)").eq("user_id", user.id).order("created_at", { ascending: false }).range(from, to);
  if (error)
    throw error;
  const rows = [];
  for (const [index, row] of (data || []).entries()) {
    const listing = row.listings || {};
    const label = `\u{1F3E0} ${from + index + 1}. ${short(listing.title, 42)}`;
    try {
      const url = new URL(listing.canonical_url);
      if (["http:", "https:"].includes(url.protocol)) {
        rows.push([{ text: label, url: url.href }]);
        continue;
      }
    } catch {
    }
    rows.push([button(label, "noop")]);
  }
  rows.push([
    button("\u2190 Zur\xFCck", `saved:${Math.max(0, page - 1)}`),
    button(`${page + 1}/${pages}`, "noop"),
    button("Weiter \u2192", `saved:${Math.min(pages - 1, page + 1)}`)
  ]);
  rows.push([button("\u2716\uFE0F Abbrechen", "home")]);
  const text = `\u2B50\uFE0F <b>Gespeicherte Inserate</b>

${total} \xB7 Seite ${page + 1}/${pages}`;
  const markup = { inline_keyboard: rows };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}
async function setPaused(userId, paused, slot) {
  let query = db.from("search_profiles").update({ is_active: !paused, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("user_id", userId);
  if (slot)
    query = query.eq("profile_slot", slot);
  const { error } = await query;
  if (error)
    throw error;
}
async function toggleSave(user, listingId) {
  if (!user.is_premium) return null;
  const { data, error } = await db.rpc("toggle_saved_once", { p_update_id: user.request_update_id, p_user_id: user.id, p_listing_id: listingId });
  if (error) throw error;
  return data;
}
async function referralPage(user, chatId, messageId) {
  let { data: code, error } = await db.from("referral_codes").select("code").eq("user_id", user.id).maybeSingle();
  if (error)
    throw error;
  if (!code) {
    const value = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
    const result = await db.from("referral_codes").insert({ user_id: user.id, code: value }).select("code").single();
    if (result.error)
      throw result.error;
    code = result.data;
  }
  await send(chatId, "\u{1F381} <b>30 Tage Premium f\xFCr 0 \u20AC</b>\n\nEmpfehle Traumwohnung Hamburg weiter und ihr erhaltet beide 30 Tage Premium kostenlos \u{1F48E}\n\nTeile jetzt diesen Link \u{1F447}");
  return send(chatId, `https://t.me/traumwohnunghamburgbot?start=ref_${code.code}`);
}
async function languagePage(user, chatId, messageId) {
  const codes = ["de", "en", "ckb", "ku", "prs", "fa", "ru", "tr", "ar"];
  const rows = codes.map((code) => [button(`${user.ui_language === code ? "\u2705 " : ""}${LANGS[code]}`, `lang:${code}`)]);
  rows.push([button("\u2190 Einstellungen", "settings")]);
  const markup = { inline_keyboard: rows };
  const text = "\u{1F310} <b>Sprachen</b>\n\nW\xE4hle deine Sprache. Das komplette Bot-Men\xFC wird entsprechend angezeigt.";
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}
async function settings(user, chatId, messageId) {
  const text = "\u2699\uFE0F <b>Einstellungen</b>\n\nVerwalte hier Premium, Sprache und Systemstatus.";
  const markup = { inline_keyboard: [
    [button("\u{1F510} Plattformkonten / Auto-Bewerbung", "platforms")],
    [button(user.is_premium ? "\u{1F48E} Premium aktiv" : "\u{1F48E} Premium", "premium")],
    [button("\u{1F310} Sprachen", "language"), button("\u{1F4E1} Systemstatus", "status")],
    [button("\u2190 Zur\xFCck", "home")]
  ] };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

// supabase/functions/telegram-ui/platform-sessions.js
var privateSessionOwner = (user, chat) => chat?.type === "private" && user.is_active && Number(chat.id) === Number(user.telegram_user_id) && Number(chat.id) === Number(user.chat_id);
async function applicationWorker(action, userId, source) {
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/application-worker`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": await secret("internal_worker_secret") },
      body: JSON.stringify({ action, userId, source }),
      signal: AbortSignal.timeout(45e3)
    });
  } catch {
    throw Error("Die Plattform antwortet gerade nicht. Bitte erneut versuchen; ein bereits gestartetes Anmeldefenster wird wiederverwendet.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw Error(result?.error === "session_busy" ? "Eine Sitzung l\xE4uft noch. Bitte in K\xFCrze erneut versuchen." : "Plattformverbindung momentan nicht verf\xFCgbar. Bitte erneut versuchen.");
  return result;
}
async function purgePlatformSessions(userId) {
  const { data, error } = await db.from("platform_sessions").select("source_id").eq("user_id", userId);
  if (error) throw Error("Plattformverbindungen konnten nicht geladen werden.");
  for (const row of data || []) {
    const result = await applicationWorker("disconnect", userId, row.source_id);
    if (result.status !== "disconnected") throw Error("Die Plattformsitzung wird noch verwendet. Bitte sp\xE4ter erneut l\xF6schen.");
  }
}
async function platformSessions(user, chat, messageId, data = "platforms") {
  if (!privateSessionOwner(user, chat)) return;
  const [, action, rawSource] = data.split(":"), source = Number(rawSource);
  const render = (text, rows2) => messageId ? edit(chat.id, messageId, text, { inline_keyboard: rows2 }) : send(chat.id, text, { inline_keyboard: rows2 });
  const back = [[button("\u2190 Plattformkonten", "platforms")]];
  if (action === "login" || action === "disconnect" || action === "check") {
    if (![1, 2].includes(source)) return;
    if (action !== "disconnect" && !user.is_premium) return render("Zum Verbinden ist Premium erforderlich.", back);
    const name = source === 1 ? "ImmoScout24" : "Kleinanzeigen";
    const progress = await send(chat.id, `${name}: ${action === "login" ? "Anmeldefenster wird vorbereitet \u2026" : action === "check" ? "Verbindung wird gepr\xFCft \u2026" : "Sitzung wird getrennt \u2026"}`, { inline_keyboard: back });
    const finish = (text, rows2 = back) => progress?.message_id ? edit(chat.id, progress.message_id, text, { inline_keyboard: rows2 }) : send(chat.id, text, { inline_keyboard: rows2 });
    let result;
    try {
      result = await applicationWorker(action, user.id, source);
    } catch (error2) {
      return finish(error2.message);
    }
    if (result.status === "busy") return finish(`${name}: Die Sitzung wird noch verwendet. Bitte in ${Math.max(1, Math.ceil(result.retryAfter || 10))} Sekunden erneut versuchen.`);
    if (result.status === "login") return finish(`${name}: ${result.reused ? "Dein Anmeldefenster ist bereits ge\xF6ffnet." : "Dein Anmeldefenster ist bereit; die Plattformseite l\xE4dt gegebenenfalls noch kurz."}

\xD6ffne den Button und melde dich dort selbst an. Das Fenster bleibt noch etwa ${Math.max(1, Math.floor(result.expiresIn || 100))} Sekunden offen. Pr\xFCfe die Verbindung nach Ende des Anmeldefensters.

Der Link ist pers\xF6nlich; bitte nicht weitergeben. Passw\xF6rter nicht an den Bot senden.`, [[{ text: `\u{1F510} ${name} \xF6ffnen`, url: result.url }], ...back]);
    if (action === "disconnect") return finish("Plattformsitzung gel\xF6scht.");
    return finish(result.authenticated === true ? "Anmeldung best\xE4tigt." : result.authenticated === false ? "Bitte erneut bei der Plattform anmelden." : "Die Anmeldung konnte nicht eindeutig best\xE4tigt werden. Bitte das Anmeldefenster \xF6ffnen und den Plattformstatus pr\xFCfen.");
  }
  if (action === "off") {
    const { error: error2 } = await db.from("bot_users").update({ auto_apply_enabled: false }).eq("id", user.id);
    if (error2) throw Error("Auto-Bewerbung konnte nicht deaktiviert werden.");
  }
  if (action === "on") {
    if (!user.is_premium) return render("Auto-Bewerbungen ben\xF6tigen aktives Premium.", back);
    const { error: error2 } = await db.from("bot_users").update({ auto_apply_enabled: true }).eq("id", user.id);
    if (error2) return render("Auto-Bewerbungen sind noch nicht freigegeben. Zuerst m\xFCssen die Plattformtests abgeschlossen sein.", back);
  }
  const [{ data: rows, error }, { data: profile2, error: profileError }, { data: applications, error: applicationError }] = await Promise.all([
    db.from("platform_sessions").select("source_id,status,session_id,lease_until").eq("user_id", user.id),
    db.from("bot_users").select("auto_apply_enabled").eq("id", user.id).single(),
    db.from("applications").select("listing_id,status").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5)
  ]);
  if (error || profileError || applicationError) throw Error("Plattformkonten konnten nicht geladen werden.");
  const names = { 1: "ImmoScout24", 2: "Kleinanzeigen" }, labels = { login: "Anmeldefenster ge\xF6ffnet", saved: "Sitzung gespeichert; Anmeldung wird beim Verwenden gepr\xFCft", needs_login: "Anmeldung erforderlich", disconnecting: "L\xF6schung noch offen" };
  const sessionLabel = (row) => row?.status === "login" && (!row.session_id || Date.parse(row.lease_until) <= Date.now()) ? "Anmeldefenster beendet \u2013 Verbindung pr\xFCfen" : labels[row?.status] || "nicht verbunden";
  return render(`\u{1F510} Plattformkonten

${[1, 2].map((id) => `${names[id]}: ${sessionLabel(rows?.find((r) => r.source_id === id))}`).join("\n")}

Auto-Bewerbung: ${profile2.auto_apply_enabled ? "aktiv (nur mit Premium)" : "aus"}
Der automatische Versand bleibt bis zum erfolgreichen Plattformtest gesperrt.`, [
    ...[1, 2].flatMap((id) => [...user.is_premium ? [[button(`${names[id]} anmelden`, `platforms:login:${id}`)], [button(`${names[id]} pr\xFCfen`, `platforms:check:${id}`)]] : [], ...rows?.some((r) => r.source_id === id) ? [[button(`${names[id]} trennen`, `platforms:disconnect:${id}`)]] : []]),
    [button(profile2.auto_apply_enabled ? "Auto-Bewerbung deaktivieren" : "\u26A1 Auto-Bewerbung aktivieren", `platforms:${profile2.auto_apply_enabled ? "off" : "on"}`)],
    ...(applications || []).map((a, i) => [button(`${{ sent: "\u2705 Gesendet", failed: "\u274C Fehlgeschlagen", manual_required: "\u26A1 Manueller Schritt", pending: "\u23F3 Vorgemerkt", processing: "\u23F3 Wird verarbeitet" }[a.status]} \xB7 ${i + 1}`, `apply:${a.listing_id}`)]),
    [button("\u2190 Einstellungen", "settings")]
  ]);
}

// supabase/functions/telegram-ui/admin.js
function isAdmin(user) {
  return ADMIN_TELEGRAM_USER_IDS.has(Number(user?.telegram_user_id));
}
function effectivePremiumFor(user, subscription) {
  const now = Date.now();
  if (user?.plan_override === "free")
    return false;
  if (user?.plan_override === "premium" && (!user.plan_override_expires_at || new Date(user.plan_override_expires_at).getTime() > now))
    return true;
  if (user?.referral_bonus_until && new Date(user.referral_bonus_until).getTime() > now)
    return true;
  return !!subscription && ["active", "trialing"].includes(String(subscription.status || "")) && (!subscription.current_period_end || new Date(subscription.current_period_end).getTime() > now);
}
function adminGrantLabel(grant) {
  return grant === "7d" ? "7 Tage" : grant === "30d" ? "30 Tage" : grant === "3m" ? "3 Monate" : "lebenslang";
}
function adminGrantExpiry(grant) {
  if (grant === "free" || grant === "life")
    return null;
  const date = /* @__PURE__ */ new Date();
  if (grant === "7d")
    date.setUTCDate(date.getUTCDate() + 7);
  else if (grant === "30d")
    date.setUTCDate(date.getUTCDate() + 30);
  else
    date.setUTCMonth(date.getUTCMonth() + 3);
  return date.toISOString();
}
function adminOverrideLabel(user) {
  if (user.plan_override === "free")
    return "FREE";
  if (user.plan_override !== "premium")
    return "STRIPE";
  if (!user.plan_override_expires_at)
    return "PREMIUM \xB7 LEBENSLANG";
  const until = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(user.plan_override_expires_at));
  return `PREMIUM \xB7 bis ${until}`;
}
function adminPremiumNotice(grant) {
  return grant === "life" ? "\u{1F48E} <b>Kostenloses Premium aktiviert</b>\n\nDu hast kostenlos Premium auf Lebenszeit bekommen. Premium ist ab sofort aktiv." : `\u{1F48E} <b>Kostenloses Premium aktiviert</b>

Du hast ${adminGrantLabel(grant)} kostenlos Premium bekommen. Premium ist ab sofort aktiv.`;
}
async function adminUsers(user, chatId, messageId) {
  if (!isAdmin(user))
    return;
  const { data: users, error } = await db.from("bot_users").select("id,telegram_user_id,first_name,last_name,username,is_active,plan_override,plan_override_expires_at,referral_bonus_until,created_at").order("created_at");
  if (error)
    throw error;
  const ids = (users || []).map((entry) => entry.id);
  let subscriptions = [];
  if (ids.length) {
    const { data, error: subscriptionError } = await db.from("user_subscriptions").select("user_id,status,current_period_end").in("user_id", ids);
    if (subscriptionError)
      throw subscriptionError;
    subscriptions = data || [];
  }
  const subscriptionByUser = new Map(subscriptions.map((entry) => [String(entry.user_id), entry]));
  const rows = (users || []).map((entry) => {
    const premium2 = effectivePremiumFor(entry, subscriptionByUser.get(String(entry.id)));
    const name = short([entry.first_name, entry.last_name].filter(Boolean).join(" ") || entry.username || String(entry.telegram_user_id), 34);
    return [
      button(`${entry.is_active ? premium2 ? "\u{1F48E}" : "\u25AB\uFE0F" : "\u{1F6AB}"} ${name} \xB7 ${entry.is_active ? premium2 ? "PREMIUM" : "FREE" : "GESPERRT"}`, `admin:user:${entry.id}`)
    ];
  });
  if (!rows.length)
    rows.push([button("Keine Nutzer", "noop")]);
  const blocked = (users || []).filter((entry) => !entry.is_active).length;
  const text = `\u{1F512} <b>Admin</b>

Nutzer: ${users?.length || 0} \xB7 gesperrt: ${blocked}`;
  const markup = { inline_keyboard: rows };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}
async function adminUser(user, chatId, messageId, userId) {
  if (!isAdmin(user))
    return;
  const { data: target, error } = await db.from("bot_users").select("id,telegram_user_id,chat_id,first_name,last_name,username,is_active,plan_override,plan_override_expires_at,referral_bonus_until").eq("id", userId).maybeSingle();
  if (error)
    throw error;
  if (!target)
    return adminUsers(user, chatId, messageId);
  const { data: subscription, error: subscriptionError } = await db.from("user_subscriptions").select("status,current_period_end,cancel_at_period_end").eq("user_id", userId).maybeSingle();
  if (subscriptionError)
    throw subscriptionError;
  const premium2 = effectivePremiumFor(target, subscription);
  const name = [target.first_name, target.last_name].filter(Boolean).join(" ") || target.username || String(target.telegram_user_id);
  const text = `\u{1F512} <b>Admin \xB7 Nutzer</b>

<b>${esc(name)}</b>
Telegram: <code>${esc(target.telegram_user_id)}</code>
Status: <b>${premium2 ? "PREMIUM" : "FREE"}</b>
Override: ${esc(adminOverrideLabel(target))}
Stripe: ${esc(String(subscription?.status || "inactive").toUpperCase())}
Zugriff: <b>${target.is_active ? "AKTIV" : "GESPERRT"}</b>`;
  const markup = {
    inline_keyboard: [
      [
        button("7 Tage", `admin:set:${userId}:7d`),
        button("30 Tage", `admin:set:${userId}:30d`)
      ],
      [
        button("3 Monate", `admin:set:${userId}:3m`),
        button("\u267E Lebenslang", `admin:set:${userId}:life`)
      ],
      [button("Free setzen", `admin:set:${userId}:free`)],
      ...isAdmin(target) ? [[button("\u{1F512} Admin-Konto", "noop")]] : [
        [button(target.is_active ? "\u{1F6AB} Nutzer sperren" : "\u2705 Nutzer entsperren", target.is_active ? `admin:block:${userId}` : `admin:unblock:${userId}`)],
        [button("\u{1F5D1} Nutzer l\xF6schen", `admin:delete:${userId}`)]
      ],
      [button("\u2190 Nutzer", "admin:list")]
    ]
  };
  return edit(chatId, messageId, text, markup);
}
async function setUserBlocked(userId, blocked) {
  const { data: target, error: targetError } = await db.from("bot_users").select("id,telegram_user_id,is_active").eq("id", userId).maybeSingle();
  if (targetError)
    throw targetError;
  if (!target)
    throw new Error("user unavailable");
  if (isAdmin(target))
    throw new Error("admin accounts cannot be blocked");
  const { error } = await db.from("bot_users").update({ is_active: !blocked, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", userId);
  if (error)
    throw error;
  if (blocked) {
    const { error: profileError } = await db.from("search_profiles").update({ is_active: false, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("user_id", userId);
    if (profileError)
      throw profileError;
  }
}
async function deleteUser(userId) {
  const { data: target, error: targetError } = await db.from("bot_users").select("id,telegram_user_id").eq("id", userId).maybeSingle();
  if (targetError)
    throw targetError;
  if (!target)
    return;
  if (isAdmin(target))
    throw new Error("admin accounts cannot be deleted");
  await purgePlatformSessions(userId);
  const { error } = await db.from("bot_users").delete().eq("id", userId);
  if (error)
    throw error;
}
async function setPlanOverride(userId, grant) {
  const plan = grant === "free" ? "free" : "premium";
  const expiresAt = adminGrantExpiry(grant);
  const { data: target, error } = await db.from("bot_users").update({
    plan_override: plan,
    plan_override_expires_at: expiresAt,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  }).eq("id", userId).select("id,chat_id").maybeSingle();
  if (error)
    throw error;
  if (!target)
    throw new Error("user unavailable");
  if (plan === "premium") {
    const { data: profiles, error: profileError } = await db.from("search_profiles").select("id").eq("user_id", userId);
    if (profileError)
      throw profileError;
    const profileIds = (profiles || []).map((profile2) => profile2.id);
    if (profileIds.length) {
      const { error: deliveryError } = await db.from("delivery_events").update({ next_retry_at: null }).in("profile_id", profileIds).eq("status", "pending");
      if (deliveryError)
        throw deliveryError;
    }
  }
  return target;
}

// supabase/functions/telegram-ui/application-message.js
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function applicationTarget(listing) {
  try {
    const url = new URL(listing.canonical_url);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const scout = Number(listing.source_id) === 1 && ["www.immobilienscout24.de", "immobilienscout24.de"].includes(url.hostname) && /^\/expose\/\d+\/?$/.test(url.pathname);
    const klein = Number(listing.source_id) === 2 && ["www.kleinanzeigen.de", "kleinanzeigen.de"].includes(url.hostname) && /^\/s-anzeige\/[^/]+\/\d+-\d+-\d+\/?$/.test(url.pathname);
    if (!scout && !klein) return null;
    url.search = "";
    url.hash = "";
    return { platform: scout ? "ImmoScout24" : "Kleinanzeigen", url: url.href };
  } catch {
    return null;
  }
}
function quickApplyButton(listing) {
  if (!UUID.test(listing.id || "") || listing.is_active === false || !applicationTarget(listing)) return null;
  return { text: "\u26A1 Schnell bewerben", callback_data: `apply:${listing.id}` };
}
var singleLine = (value, max) => String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).replace(/[\uD800-\uDBFF]$/, "");
function generateApplicationMessage(user, listing) {
  const title = singleLine(listing.title, 50) || "Ihre Wohnung";
  const name = singleLine([user.first_name, user.last_name].filter(Boolean).join(" "), 40) || "[Dein Name]";
  return `Guten Tag,

ich interessiere mich f\xFCr \u201E${title}\u201C und w\xFCrde die Wohnung gerne besichtigen. \xDCber eine R\xFCckmeldung freue ich mich.

Freundliche Gr\xFC\xDFe
${name}`;
}

// supabase/functions/telegram-ui/application.js
async function quickApplication(user, query) {
  const chat = query.message?.chat;
  if (chat?.type !== "private" || Number(chat.id) !== Number(user.telegram_user_id) || Number(chat.id) !== Number(user.chat_id) || !user.is_active) return;
  const id = String(query.data || "").slice("apply:".length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return send(chat.id, "Dieses Angebot ist nicht verf\xFCgbar.");
  }
  const { data: deliveries, error: deliveryError } = await db.from("delivery_events").select("id").eq("recipient_user_id", user.id).eq("listing_id", id).eq("status", "sent").limit(1);
  if (deliveryError) throw deliveryError;
  let owned = !!deliveries?.length;
  if (!owned && user.is_premium) {
    const { data: saved2, error: error2 } = await db.from("saved_listings").select("id").eq("user_id", user.id).eq("listing_id", id).limit(1);
    if (error2) throw error2;
    owned = !!saved2?.length;
  }
  if (!owned) return send(chat.id, "Bitte w\xE4hle eine dir zugestellte oder gespeicherte Wohnung.");
  const { data: listing, error } = await db.from("listings").select("id,source_id,canonical_url,title,is_active").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!listing || !quickApplyButton(listing)) {
    return send(chat.id, "Dieses Angebot ist inaktiv oder unterst\xFCtzt keine Schnellbewerbung.");
  }
  const target = applicationTarget(listing);
  const { data: application, error: applicationError } = await db.from("applications").select("status,submission_started_at").eq("user_id", user.id).eq("listing_id", id).maybeSingle();
  if (applicationError) throw applicationError;
  if (application?.status === "sent" || application?.submission_started_at) {
    return telegram("sendMessage", {
      chat_id: chat.id,
      text: application.status === "sent" ? "\u2705 Diese Bewerbung wurde bereits gesendet. Bitte nicht erneut bewerben." : "\u26A0\uFE0F Der Versand wurde gestartet, aber m\xF6glicherweise noch nicht best\xE4tigt. Pr\xFCfe zuerst deine Plattformnachrichten, bevor du erneut absendest.",
      reply_markup: { inline_keyboard: [[{ text: `${target.platform} pr\xFCfen`, url: target.url }]] }
    });
  }
  const message = generateApplicationMessage(user, listing);
  return telegram("sendMessage", {
    chat_id: chat.id,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    text: `\u26A1 <b>Schnell bewerben</b>

Noch nicht versendet. Bitte Text und Namen pr\xFCfen. Dann Text kopieren, das Angebot \xF6ffnen und im Kontaktformular einf\xFCgen und absenden. Falls n\xF6tig, direkt bei der Plattform anmelden.

<pre>${esc(message)}</pre>

Der Bot erh\xE4lt keine Plattform-Passw\xF6rter und kann den manuellen Versand nicht best\xE4tigen.`,
    reply_markup: { inline_keyboard: [
      ...message.length <= 256 ? [[{ text: "\u{1F4CB} Bewerbungstext kopieren", copy_text: { text: message } }]] : [],
      [{ text: `${target.platform} \xF6ffnen`, url: target.url }]
    ] }
  });
}

// supabase/functions/telegram-ui/handlers.js
async function handleMessage(message, user) {
  const chatId = Number(message.chat.id);
  const text = String(message.text || "").trim();
  const [rawCommand, argument = ""] = text.split(/\s+/, 2);
  const command = rawCommand.toLowerCase().replace(/@traumwohnunghamburgbot$/i, "");
  if (command === "/admin") {
    if (!isAdmin(user))
      return;
    return adminUsers(user, chatId);
  }
  if (command === "/start") {
    if (argument.startsWith("ref_") && user.__is_new_user === true) {
      const { error } = await db.rpc("redeem_referral_code", {
        p_referred_user_id: user.id,
        p_code: argument.slice(4)
      });
      if (error)
        console.error("referral_register", error.message);
    }
    telegram("setChatMenuButton", {
      chat_id: chatId,
      menu_button: { type: "commands" }
    }).catch(() => {
    });
    return home(user, chatId);
  }
  if (command === "/suche")
    return startNewProfile(user, chatId);
  if (command === "/profile")
    return profile(user, chatId);
  if (command === "/gespeichert" || command === "/saved") {
    return saved(user, chatId);
  }
  if (command === "/einstellungen" || command === "/settings") {
    return settings(user, chatId);
  }
  if (command === "/pause") {
    await setPaused(user.id, true);
    return send(chatId, "\u23F8 Dein Suchprofil ist pausiert.");
  }
  if (command === "/resume") {
    await setPaused(user.id, false);
    return send(chatId, "\u25B6\uFE0F Dein Suchprofil ist wieder aktiv.");
  }
  if (command === "/status")
    return renderStatus(user, chatId);
  if (command === "/hilfe" || command === "/help") {
    return send(chatId, HELP_TEXT);
  }
  if (command === "/premium")
    return premium(user, chatId);
  const draft = draftFor(user);
  if (user.onboarding_step === "rent_custom") {
    const value = Number(text.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(value) || value < 100 || value > 5e3) {
      return send(chatId, "Bitte einen Betrag zwischen 100 und 5.000 eingeben.");
    }
    draft.max_warm_rent = value;
    if (draft.profile_edit) {
      const slot = draft.profile_slot;
      delete draft.profile_edit;
      delete draft.edit_return;
      await persistProfile(user, draft);
      return profile(user, chatId, void 0, slot);
    }
    if (draft.edit_return) {
      delete draft.edit_return;
      return renderReview(user, chatId, message.message_id, draft);
    }
    await saveState(user.id, "rooms", draft);
    return send(chatId, "4/5 \xB7 <b>Mindestens wie viele Zimmer?</b>", {
      inline_keyboard: [
        [button("1+", "rooms:1"), button("2+", "rooms:2")],
        [button("3+", "rooms:3"), button("4+", "rooms:4")],
        backRow("rent"),
        cancelRow()
      ]
    });
  }
  return send(chatId, "Bitte verwende die Befehle oder Buttons. Mit /hilfe siehst du alle Befehle.");
}
async function handleCallback(query, user) {
  const chatId = Number(query.message?.chat.id);
  const messageId = Number(query.message?.message_id);
  const data = String(query.data || "");
  const ack = (text) => user.__callback_acked ? Promise.resolve() : acknowledge(query.id, text);
  if (!chatId || !messageId)
    return ack();
  if (data.startsWith("admin:")) {
    if (!isAdmin(user))
      return ack();
    if (data === "admin:list") {
      EdgeRuntime.waitUntil(ack());
      return adminUsers(user, chatId, messageId);
    }
    if (data.startsWith("admin:user:")) {
      EdgeRuntime.waitUntil(ack());
      return adminUser(user, chatId, messageId, data.slice("admin:user:".length));
    }
    if (data.startsWith("admin:block:")) {
      const userId = data.slice("admin:block:".length);
      try {
        await setUserBlocked(userId, true);
        await ack("Nutzer gesperrt");
      } catch (error) {
        await ack(String(error).includes("admin accounts") ? "Admin-Konto gesch\xFCtzt" : "Sperren fehlgeschlagen");
      }
      return adminUser(user, chatId, messageId, userId);
    }
    if (data.startsWith("admin:unblock:")) {
      const userId = data.slice("admin:unblock:".length);
      try {
        await setUserBlocked(userId, false);
        await ack("Nutzer entsperrt");
      } catch (error) {
        await ack(String(error).includes("admin accounts") ? "Admin-Konto gesch\xFCtzt" : "Entsperren fehlgeschlagen");
      }
      return adminUser(user, chatId, messageId, userId);
    }
    if (data.startsWith("admin:delete-confirm:")) {
      const userId = data.slice("admin:delete-confirm:".length);
      try {
        await deleteUser(userId);
        await ack("Nutzer gel\xF6scht");
      } catch (error) {
        await ack(String(error).includes("admin accounts") ? "Admin-Konto gesch\xFCtzt" : "L\xF6schen fehlgeschlagen");
      }
      return adminUsers(user, chatId, messageId);
    }
    if (data.startsWith("admin:delete:")) {
      const userId = data.slice("admin:delete:".length);
      EdgeRuntime.waitUntil(ack());
      return edit(chatId, messageId, "\u{1F5D1} <b>Nutzer wirklich l\xF6schen?</b>\n\nSuchprofile, gespeicherte Inserate, Referral- und Abo-Zuordnungen werden dauerhaft gel\xF6scht.", { inline_keyboard: [
        [button("\u{1F5D1} Ja, endg\xFCltig l\xF6schen", `admin:delete-confirm:${userId}`)],
        [button("\u2190 Abbrechen", `admin:user:${userId}`)]
      ] });
    }
    if (data.startsWith("admin:set:")) {
      const parts = data.split(":");
      const userId = parts[2];
      const grant = parts[3];
      if (!userId || !["free", "7d", "30d", "3m", "life"].includes(grant)) {
        return ack();
      }
      const target = await setPlanOverride(userId, grant);
      let noticeFailed = false;
      if (grant !== "free") {
        try {
          await send(Number(target.chat_id), adminPremiumNotice(grant));
        } catch (error) {
          noticeFailed = true;
          console.error("admin_premium_notice", error);
        }
      }
      await ack(grant === "free" ? "Free gesetzt" : noticeFailed ? "Premium gesetzt \xB7 Nachricht fehlgeschlagen" : `${adminGrantLabel(grant)} Premium gesetzt`);
      return adminUser(user, chatId, messageId, userId);
    }
    return ack();
  }
  if (data.startsWith("save:")) {
    const savedState = await toggleSave(user, data.slice(5));
    if (savedState !== null && user.__callback_acked) {
      try {
        const markup = structuredClone(query.message?.reply_markup || {});
        let changed = false;
        for (const row of markup.inline_keyboard || []) for (const item of row || []) {
          if (item?.callback_data === data) {
            item.text = savedState ? "\u2B50\uFE0F Gespeichert" : "\u2B50\uFE0F Speichern";
            changed = true;
          }
        }
        if (changed) await telegram("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: markup });
      } catch (error) {
        console.error("save_button_refresh", String(error));
      }
    }
    if (savedState === null) {
      EdgeRuntime.waitUntil(ack());
      return premium(user, chatId, messageId);
    }
    return ack(savedState ? "\u2B50\uFE0F Gespeichert" : "Entfernt");
  }
  EdgeRuntime.waitUntil(ack());
  if (data === "platforms" || data.startsWith("platforms:")) return platformSessions(user, query.message.chat, query.message?.photo ? void 0 : messageId, data);
  if (data.startsWith("apply:")) return quickApplication(user, query);
  if (data === "noop")
    return;
  if (data === "cancel") {
    await saveState(user.id, null, {});
    return home({ ...user, onboarding_step: null, onboarding_state: {} }, chatId, messageId);
  }
  if (data === "home") {
    if (query.message?.photo) {
      await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {
      });
      return home(user, chatId);
    }
    return home(user, chatId, messageId);
  }
  if (data === "new")
    return startNewProfile(user, chatId, messageId);
  if (data === "draft") {
    const draft2 = draftFor(user);
    const step = String(user.onboarding_step || "types");
    return renderStep(user, chatId, messageId, draft2, [
      "types",
      "location",
      "boroughs",
      "neighborhoods",
      "rent",
      "rent_custom",
      "rooms",
      "area",
      "review"
    ].includes(step) ? step : "types");
  }
  if (data === "profile" || data === "profiles")
    return profile(user, chatId, messageId);
  if (data === "p:view:1")
    return profile(user, chatId, messageId, 1);
  if (data.startsWith("profile:view:"))
    return profile(user, chatId, messageId, Number(data.split(":")[2]));
  if (data.startsWith("profile:edit-field:")) {
    const parts = data.split(":");
    const slot = Number(parts[2]);
    const field = parts[3];
    if (!Number.isInteger(slot) || slot < 1 || slot > profileLimit(user))
      return;
    const { data: current, error } = await db.from("search_profiles").select("*").eq("user_id", user.id).eq("profile_slot", slot).maybeSingle();
    if (error)
      throw error;
    if (!current)
      return profile(user, chatId, messageId);
    const draft2 = await draftFromProfile(current);
    if (field === "types")
      return renderTypes(user, chatId, messageId, draft2);
    if (field === "location")
      return renderLocation(user, chatId, messageId, draft2);
    if (field === "rent")
      return renderRent(user, chatId, messageId, draft2);
    if (field === "rooms")
      return renderRooms(user, chatId, messageId, draft2);
    if (field === "area")
      return renderArea(user, chatId, messageId, draft2);
    return profileEditMenu(user, chatId, messageId, slot);
  }
  if (data.startsWith("profile:edit:")) {
    return profileEditMenu(user, chatId, messageId, Number(data.split(":")[2]));
  }
  if (data.startsWith("profile:delete-confirm:")) {
    const slot = Number(data.split(":")[2]);
    if (!Number.isInteger(slot) || slot < 1 || slot > profileLimit(user))
      return;
    const { error } = await db.from("search_profiles").delete().eq("user_id", user.id).eq("profile_slot", slot);
    if (error)
      throw error;
    return profile(user, chatId, messageId);
  }
  if (data.startsWith("profile:delete:")) {
    const slot = Number(data.split(":")[2]);
    if (!Number.isInteger(slot) || slot < 1 || slot > profileLimit(user))
      return;
    return edit(chatId, messageId, "\u{1F5D1} <b>Suchprofil l\xF6schen?</b>\n\nDiese Aktion kann nicht r\xFCckg\xE4ngig gemacht werden.", { inline_keyboard: [
      [button("\u{1F5D1} Ja, l\xF6schen", `profile:delete-confirm:${slot}`)],
      [button("\u2190 Abbrechen", `profile:view:${slot}`)]
    ] });
  }
  if (data.startsWith("profile:pause:") || data.startsWith("profile:resume:")) {
    const slot = Number(data.split(":")[2]);
    await setPaused(user.id, data.startsWith("profile:pause:"), slot);
    return profile(user, chatId, messageId, slot);
  }
  if (data === "saved")
    return saved(user, chatId, messageId, 0);
  if (data.startsWith("saved:")) {
    return saved(user, chatId, messageId, Number(data.slice(6)) || 0);
  }
  if (data === "settings")
    return settings(user, chatId, messageId);
  if (data === "referral")
    return referralPage(user, chatId, messageId);
  if (data === "language")
    return languagePage(user, chatId, messageId);
  if (data.startsWith("lang:")) {
    const code = data.slice(5);
    if (!["de", "en", "ckb", "ku", "prs", "fa", "ru", "tr", "ar"].includes(code))
      return;
    const { error } = await db.from("bot_users").update({ ui_language: code, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", user.id);
    if (error)
      throw error;
    chatLanguages.set(chatId, code);
    return settings({ ...user, ui_language: code }, chatId, messageId);
  }
  if (data === "help") {
    return edit(chatId, messageId, HELP_TEXT, {
      inline_keyboard: [[button("\u2190 Zur\xFCck", "home")]]
    });
  }
  if (data === "premium") {
    if (query.message?.photo)
      return premium(user, chatId, messageId, true);
    await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {
    });
    return premium(user, chatId);
  }
  if (data === "portal") {
    if (query.message?.photo)
      await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {
      });
    const url = await secret("stripe_portal_url").catch(() => null);
    const valid = url && /^https:\/\/billing\.stripe\.com\//.test(url);
    return edit(chatId, messageId, valid ? "\u{1F4B3} <b>Abo verwalten</b>" : "\u{1F4B3} Das Stripe Customer Portal ist aktuell noch nicht konfiguriert.", {
      inline_keyboard: [
        ...valid ? [[{ text: "Stripe \xF6ffnen", url }]] : [],
        [button("\u2190 Premium", "premium")]
      ]
    });
  }
  if (data === "pause") {
    await setPaused(user.id, true);
    return edit(chatId, messageId, "\u23F8 Dein Suchprofil ist pausiert.", homeKeyboard(user));
  }
  if (data === "resume") {
    await setPaused(user.id, false);
    return edit(chatId, messageId, "\u25B6\uFE0F Dein Suchprofil ist wieder aktiv.", homeKeyboard(user));
  }
  if (data === "status")
    return renderStatus(user, chatId, messageId);
  const draft = draftFor(user);
  if (data === "types")
    return renderTypes(user, chatId, messageId, draft);
  if (data === "location")
    return renderLocation(user, chatId, messageId, draft);
  if (data === "boroughs") {
    return renderBoroughs(user, chatId, messageId, draft);
  }
  if (data === "neighborhoods") {
    return renderNeighborhoods(user, chatId, messageId, draft);
  }
  if (data === "rent")
    return renderRent(user, chatId, messageId, draft);
  if (data === "rooms")
    return renderRooms(user, chatId, messageId, draft);
  if (data === "area")
    return renderArea(user, chatId, messageId, draft);
  if (data.startsWith("edit:")) {
    draft.edit_return = true;
    const step = data.slice(5);
    if (step === "types")
      return renderTypes(user, chatId, messageId, draft);
    if (step === "location") {
      return renderLocation(user, chatId, messageId, draft);
    }
    if (step === "rent")
      return renderRent(user, chatId, messageId, draft);
    if (step === "rooms")
      return renderRooms(user, chatId, messageId, draft);
    if (step === "area")
      return renderArea(user, chatId, messageId, draft);
  }
  if (data.startsWith("type:")) {
    const value = data.slice(5);
    if (value === "all")
      draft.property_types = [...PROPERTY_TYPES];
    else if (value === "clear")
      draft.property_types = [];
    else if (value === "done") {
      if (!draft.property_types.length) {
        return renderTypes(user, chatId, messageId, draft);
      }
      return afterSelection(user, chatId, messageId, draft, "location");
    } else if (PROPERTY_TYPES.includes(value)) {
      const type = value;
      draft.property_types = draft.property_types.includes(type) ? draft.property_types.filter((entry) => entry !== type) : [...draft.property_types, type];
    }
    return renderTypes(user, chatId, messageId, draft);
  }
  if (data.startsWith("loc:")) {
    const value = data.slice(4);
    if (value === "all") {
      draft.location_mode = "all_hamburg";
      draft.borough_ids = [];
      draft.neighborhood_ids = [];
      return afterSelection(user, chatId, messageId, draft, "rent");
    }
    if (value === "boroughs") {
      draft.location_mode = "boroughs";
      draft.neighborhood_ids = [];
      return renderBoroughs(user, chatId, messageId, draft);
    }
    if (value === "neighborhoods") {
      draft.location_mode = "neighborhoods";
      draft.borough_ids = [];
      return renderNeighborhoods(user, chatId, messageId, draft);
    }
  }
  if (data.startsWith("borough:")) {
    const value = data.slice(8);
    const geo = await geography();
    if (value === "all") {
      draft.borough_ids = geo.boroughs.map((entry) => entry.id);
    } else if (value === "clear") {
      draft.borough_ids = [];
    } else if (value === "done") {
      if (!draft.borough_ids.length) {
        return renderBoroughs(user, chatId, messageId, draft);
      }
      return afterSelection(user, chatId, messageId, draft, "rent");
    } else {
      const id = Number(value);
      if (geo.boroughs.some((entry) => entry.id === id)) {
        draft.borough_ids = draft.borough_ids.includes(id) ? draft.borough_ids.filter((entry) => entry !== id) : [...draft.borough_ids, id];
      }
    }
    return renderBoroughs(user, chatId, messageId, draft);
  }
  if (data.startsWith("neighborhood:")) {
    const value = data.slice(13);
    const geo = await geography();
    if (value === "all") {
      draft.neighborhood_ids = geo.neighborhoods.map((entry) => entry.id);
    } else if (value === "clear") {
      draft.neighborhood_ids = [];
    } else if (value === "prev") {
      draft.neighborhood_page = Math.max(0, draft.neighborhood_page - 1);
    } else if (value === "next") {
      const pages = Math.max(1, Math.ceil(geo.neighborhoods.length / NEIGHBORHOODS_PER_PAGE));
      draft.neighborhood_page = Math.min(pages - 1, draft.neighborhood_page + 1);
    } else if (value === "done") {
      if (!draft.neighborhood_ids.length) {
        return renderNeighborhoods(user, chatId, messageId, draft);
      }
      return afterSelection(user, chatId, messageId, draft, "rent");
    } else {
      const id = Number(value);
      if (geo.neighborhoods.some((entry) => entry.id === id)) {
        draft.neighborhood_ids = draft.neighborhood_ids.includes(id) ? draft.neighborhood_ids.filter((entry) => entry !== id) : [...draft.neighborhood_ids, id];
      }
    }
    return renderNeighborhoods(user, chatId, messageId, draft);
  }
  if (data.startsWith("rent:")) {
    const value = data.slice(5);
    if (value === "custom") {
      return renderCustomRent(user, chatId, messageId, draft);
    }
    const amount = Number(value);
    if (RENT_PRESETS.has(amount)) {
      draft.max_warm_rent = amount;
      return afterSelection(user, chatId, messageId, draft, "rooms");
    }
    return renderRent(user, chatId, messageId, draft);
  }
  if (data.startsWith("rooms:")) {
    const rooms = Number(data.slice(6));
    if (ROOM_PRESETS.has(rooms)) {
      draft.min_rooms = rooms;
      return afterSelection(user, chatId, messageId, draft, "area");
    }
    return renderRooms(user, chatId, messageId, draft);
  }
  if (data.startsWith("area:")) {
    const area = Number(data.slice(5));
    if (AREA_PRESETS.has(area)) {
      draft.min_area_sqm = area;
      return afterSelection(user, chatId, messageId, draft, "review");
    }
    return renderArea(user, chatId, messageId, draft);
  }
  if (data === "profile:save" || data === "s:save") {
    const issue = validateDraft(draft);
    if (issue)
      return renderStep(user, chatId, messageId, draft, issue);
    const referralReward = await persistProfile(user, draft);
    const result = await edit(chatId, messageId, "\u2705 Deine Suche ist aktiv. Neue passende Inserate werden automatisch zugestellt.", homeKeyboard({ ...user, onboarding_step: null }));
    if (referralReward?.status === "rewarded") {
      await sendCelebration(chatId, "\u{1F48E} <b>30 Tage Premium kostenlos aktiviert</b>\n\nDein erstes Suchprofil ist erstellt und dir wurden 30 Tage Premium kostenlos gutgeschrieben.\n\nViel Erfolg und viel Spa\xDF bei deiner Wohnungssuche! \u{1F3E0}");
    }
    return result;
  }
}

// supabase/functions/telegram-ui/index.ts
Deno.serve(async (request) => {
  let updateId = null, attempt = null;
  try {
    if (request.method === "GET" || request.method === "HEAD") {
      const url = new URL(request.url);
      if (url.searchParams.get("asset") === "premium") {
        return fetch(`${SUPABASE_URL}/functions/v1/telegram-premium-image?v=20260903hd4`, { method: request.method });
      }
    }
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    let expectedSecret = await secret("telegram_webhook_secret");
    const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") || "";
    if (suppliedSecret !== expectedSecret) {
      secretCache.delete("telegram_webhook_secret");
      expectedSecret = await secret("telegram_webhook_secret", true);
      if (suppliedSecret !== expectedSecret) {
        return new Response("unauthorized", { status: 401 });
      }
    }
    const payload = await request.json().catch(() => ({}));
    const from = payload.callback_query?.from || payload.message?.from;
    const chatId = payload.callback_query?.message?.chat?.id || payload.message?.chat?.id;
    if (!from?.id || !chatId)
      return Response.json({ ok: true, ignored: true });
    const { data: prepared, error: claimError } = await db.rpc("prepare_telegram_update", { p_payload: payload });
    const claim = prepared?.claim;
    if (claimError) throw claimError;
    if (claim === 0) return Response.json({ ok: true, duplicate: true });
    if (claim < 0) return Response.json({ ok: false, busy: true }, { status: 503 });
    updateId = payload.update_id;
    attempt = claim;
    const user = await withPlan({ ...prepared.user, __is_new_user: prepared.is_new_user === true }, prepared.subscription ?? null);
    user.request_update_id = updateId;
    user.__callback_acked = request.headers.get("x-callback-acked") === "1";
    if (!user.is_active && !isAdmin(user)) {
      await finishUpdate(updateId, attempt, true);
      return Response.json({ ok: true, blocked: true });
    }
    chatLanguages.set(Number(chatId), String(user.ui_language || "de"));
    if (payload.callback_query) {
      await handleCallback(payload.callback_query, user);
    } else if (payload.message?.chat?.type === "private" && (payload.message?.text || payload.message?.document || payload.message?.photo)) {
      await handleMessage(payload.message, user);
    }
    await finishUpdate(updateId, attempt, true);
    return Response.json({ ok: true });
  } catch (error) {
    if (updateId !== null && attempt !== null) {
      try {
        await finishUpdate(updateId, attempt, false, String(error));
      } catch (ackError) {
        console.error("inbox_finish", String(ackError));
      }
    }
    console.error("telegram_command_runtime", error);
    return Response.json({ ok: false, error: "command_runtime_failed" }, { status: 500 });
  }
});
