import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

type PropertyType = "Wohnung" | "Haus" | "WG" | "Tauschwohnung";
type LocationMode = "all_hamburg" | "boroughs" | "neighborhoods";
type OnboardingStep =
  | "types"
  | "location"
  | "boroughs"
  | "neighborhoods"
  | "rent"
  | "rent_custom"
  | "rooms"
  | "area"
  | "review";

type Draft = {
  property_types: PropertyType[];
  location_mode: LocationMode | null;
  borough_ids: number[];
  neighborhood_ids: number[];
  neighborhood_page: number;
  max_warm_rent: number | null;
  min_rooms: number | null;
  min_area_sqm: number | null;
  edit_return?: boolean;
};

type Geography = {
  boroughs: Array<{ id: number; name: string; sort_order?: number }>;
  neighborhoods: Array<{ id: number; name: string; borough_id: number }>;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SERVICE_KEY =
  SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PREMIUM_LINK = "https://buy.stripe.com/00w00c7DSgHD6k64z3fYY00";
const PROPERTY_TYPES: PropertyType[] = [
  "Wohnung",
  "Haus",
  "WG",
  "Tauschwohnung",
];
const RENT_PRESETS = new Set([800, 1000, 1250, 1500]);
const ROOM_PRESETS = new Set([1, 2, 3, 4]);
const AREA_PRESETS = new Set([30, 50, 70, 90]);
const NEIGHBORHOODS_PER_PAGE = 10;
const SECRET_TTL_MS = 5 * 60_000;
const GEO_TTL_MS = 30 * 60_000;

const secretCache = new Map<string, { value: string; expiresAt: number }>();
let geoCache: { value: Geography; expiresAt: number } | null = null;

function emptyDraft(): Draft {
  return {
    property_types: [],
    location_mode: null,
    borough_ids: [],
    neighborhood_ids: [],
    neighborhood_page: 0,
    max_warm_rent: null,
    min_rooms: null,
    min_area_sqm: null,
  };
}

function normalizeDraft(raw: any): Draft {
  const propertyTypes: PropertyType[] = Array.isArray(raw?.property_types)
    ? raw.property_types.filter((value: unknown) =>
      PROPERTY_TYPES.includes(String(value) as PropertyType)
    )
    : raw?.type && PROPERTY_TYPES.includes(String(raw.type) as PropertyType)
    ? [String(raw.type) as PropertyType]
    : [];

  const legacyMode = raw?.mode === "all_hamburg"
    ? "all_hamburg"
    : raw?.mode === "neighborhoods"
    ? "neighborhoods"
    : null;

  return {
    property_types: Array.from(new Set<PropertyType>(propertyTypes)),
    location_mode: ["all_hamburg", "boroughs", "neighborhoods"].includes(
        String(raw?.location_mode || ""),
      )
      ? raw.location_mode
      : legacyMode,
    borough_ids: Array.isArray(raw?.borough_ids)
      ? raw.borough_ids.map(Number).filter(Number.isFinite)
      : [],
    neighborhood_ids: Array.isArray(raw?.neighborhood_ids)
      ? raw.neighborhood_ids.map(Number).filter(Number.isFinite)
      : [],
    neighborhood_page: Number.isFinite(Number(raw?.neighborhood_page))
      ? Math.max(0, Number(raw.neighborhood_page))
      : 0,
    max_warm_rent: finiteOrNull(raw?.max_warm_rent ?? raw?.rent),
    min_rooms: finiteOrNull(raw?.min_rooms ?? raw?.rooms),
    min_area_sqm: finiteOrNull(raw?.min_area_sqm ?? raw?.area),
    edit_return: raw?.edit_return === true,
  };
}

function finiteOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function draftFor(user: any): Draft {
  return normalizeDraft(user?.onboarding_state || {});
}

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value: unknown) {
  if (value == null || value === "") return "–";
  const number = Number(value);
  return Number.isFinite(number)
    ? `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(number)} €`
    : String(value);
}

function short(value: unknown, max = 45) {
  const text = String(value || "Inserat").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function button(text: string, callbackData: string) {
  return { text, callback_data: callbackData };
}

function cancelRow() {
  return [button("✖️ Abbrechen", "cancel")];
}

function backRow(callbackData: string, nextCallbackData?: string) {
  const row = [button("← Zurück", callbackData)];
  if (nextCallbackData) row.push(button("Weiter →", nextCallbackData));
  return row;
}

async function secret(name: string, force = false) {
  const cached = secretCache.get(name);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;

  const { data, error } = await db.rpc("get_bot_secret", {
    secret_name: name,
  });
  if (error || !data) throw new Error(`secret ${name} unavailable`);

  const value = String(data);
  secretCache.set(name, { value, expiresAt: Date.now() + SECRET_TTL_MS });
  return value;
}

async function telegram(method: string, body: any, retry = true): Promise<any> {
  const token = await secret("telegram_bot_token_runtime");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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

function send(chatId: number, text: string, replyMarkup?: any) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
  });
}

async function edit(
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: any,
) {
  try {
    return await telegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    });
  } catch {
    return send(chatId, text, replyMarkup);
  }
}

async function acknowledge(id: string, text?: string) {
  try {
    await telegram("answerCallbackQuery", { callback_query_id: id, text });
  } catch {
    // Expired callbacks must not break the command runtime.
  }
}

async function ensureUser(from: any, chatId: number) {
  const { data: existing, error } = await db
    .from("bot_users")
    .select("*")
    .eq("telegram_user_id", from.id)
    .maybeSingle();
  if (error) throw error;

  const patch = {
    chat_id: chatId,
    username: from.username || null,
    first_name: from.first_name || null,
    last_name: from.last_name || null,
    language_code: from.language_code || null,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { data, error: updateError } = await db
      .from("bot_users")
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (updateError) throw updateError;
    return data;
  }

  const { data, error: insertError } = await db
    .from("bot_users")
    .insert({ telegram_user_id: from.id, ...patch })
    .select("*")
    .single();
  if (insertError) throw insertError;
  return data;
}

async function withPlan(user: any) {
  const { data: subscription, error } = await db
    .from("user_subscriptions")
    .select("status,current_period_end,cancel_at_period_end")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;

  const now = Date.now();
  const premium = user.plan_override === "free"
    ? false
    : (user.plan_override === "premium" &&
        (!user.plan_override_expires_at ||
          new Date(user.plan_override_expires_at).getTime() > now)) ||
      (!!user.referral_bonus_until &&
        new Date(user.referral_bonus_until).getTime() > now) ||
      (!!subscription &&
        ["active", "trialing"].includes(String(subscription.status)) &&
        (!subscription.current_period_end ||
          new Date(subscription.current_period_end).getTime() > now));

  return { ...user, is_premium: !!premium, subscription };
}

async function saveState(userId: string, step: OnboardingStep | null, draft: any) {
  const { error } = await db
    .from("bot_users")
    .update({
      onboarding_step: step,
      onboarding_state: draft,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) throw error;
}

async function geography(): Promise<Geography> {
  if (geoCache && geoCache.expiresAt > Date.now()) return geoCache.value;

  const [boroughResult, neighborhoodResult] = await Promise.all([
    db.from("hamburg_boroughs").select("id,name,sort_order").order("sort_order"),
    db.from("hamburg_neighborhoods").select("id,name,borough_id").order("id"),
  ]);
  if (boroughResult.error) throw boroughResult.error;
  if (neighborhoodResult.error) throw neighborhoodResult.error;

  const value: Geography = {
    boroughs: boroughResult.data || [],
    neighborhoods: neighborhoodResult.data || [],
  };
  geoCache = { value, expiresAt: Date.now() + GEO_TTL_MS };
  return value;
}

function homeKeyboard(user: any) {
  const rows: any[] = [];
  if (user.onboarding_step) {
    rows.push([button("▶️ Entwurf fortsetzen", "draft")]);
  }
  rows.push(
    [button("🔎 Suchprofil", "profile")],
    [button("💾 Gespeichert", "saved")],
    [
      button("⚙️ Einstellungen", "settings"),
      button("❓ Hilfe", "help"),
    ],
    [
      button(
        user.is_premium ? "👑 Premium aktiv" : "👑 Premium",
        "premium",
      ),
    ],
  );
  return { inline_keyboard: rows };
}

const HELP_TEXT =
  "❓ <b>Hilfe</b>\n\n" +
  "/start – Startmenü\n" +
  "/suche – Suchprofil erstellen oder ersetzen\n" +
  "/profile – Suchprofil anzeigen\n" +
  "/gespeichert – gespeicherte Inserate\n" +
  "/einstellungen – Einstellungen\n" +
  "/pause – Suche pausieren\n" +
  "/resume – Suche fortsetzen\n" +
  "/status – Systemstatus\n" +
  "/premium – Premium anzeigen\n" +
  "/hilfe – Hilfe";

function home(user: any, chatId: number, messageId?: number) {
  const text =
    "🏠 <b>Traumwohnung Hamburg</b>\n\n" +
    "Die Bedienung läuft vollständig über Telegram-Befehle und Buttons.\n\n" +
    "Nutze /suche, um dein Suchprofil zu erstellen oder zu ersetzen.";
  return messageId
    ? edit(chatId, messageId, text, homeKeyboard(user))
    : send(chatId, text, homeKeyboard(user));
}

function validateDraft(draft: Draft): OnboardingStep | null {
  if (!draft.property_types.length) return "types";
  if (!draft.location_mode) return "location";
  if (draft.location_mode === "boroughs" && !draft.borough_ids.length) {
    return "boroughs";
  }
  if (
    draft.location_mode === "neighborhoods" &&
    !draft.neighborhood_ids.length
  ) {
    return "neighborhoods";
  }
  if (
    draft.max_warm_rent == null ||
    draft.max_warm_rent < 100 ||
    draft.max_warm_rent > 5000
  ) {
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

async function renderTypes(
  user: any,
  chatId: number,
  messageId: number | undefined,
  draft: Draft,
) {
  await saveState(user.id, "types", draft);
  const rows: any[] = PROPERTY_TYPES.map((value) => [
    button(
      `${draft.property_types.includes(value) ? "✅ " : ""}${value}`,
      `type:${value}`,
    ),
  ]);
  rows.push(
    [
      button("Alle auswählen", "type:all"),
      button("Auswahl löschen", "type:clear"),
    ],
    backRow("home", "type:done"),
    cancelRow(),
  );
  const text =
    "1/5 · <b>Was suchst du?</b>\n\n" +
    "Wähle eine oder mehrere Wohnungsarten.";
  return messageId
    ? edit(chatId, messageId, text, { inline_keyboard: rows })
    : send(chatId, text, { inline_keyboard: rows });
}

async function renderLocation(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
) {
  await saveState(user.id, "location", draft);
  return edit(chatId, messageId, "2/5 · <b>Wo möchtest du suchen?</b>", {
    inline_keyboard: [
      [button("🌐 Ganz Hamburg", "loc:all")],
      [button("🏙 Bezirke auswählen", "loc:boroughs")],
      [button("📍 Stadtteile auswählen", "loc:neighborhoods")],
      backRow("types"),
      cancelRow(),
    ],
  });
}

async function renderBoroughs(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
) {
  const geo = await geography();
  await saveState(user.id, "boroughs", draft);
  const rows: any[] = [];
  for (let index = 0; index < geo.boroughs.length; index += 2) {
    rows.push(
      geo.boroughs.slice(index, index + 2).map((borough) =>
        button(
          `${draft.borough_ids.includes(borough.id) ? "✅ " : ""}${borough.name}`,
          `borough:${borough.id}`,
        )
      ),
    );
  }
  rows.push(
    [
      button("Alle auswählen", "borough:all"),
      button("Auswahl löschen", "borough:clear"),
    ],
    backRow("location", "borough:done"),
    cancelRow(),
  );
  return edit(
    chatId,
    messageId,
    "2/5 · <b>Hamburger Bezirke</b>\n\nWähle einen oder mehrere der 7 Bezirke.",
    { inline_keyboard: rows },
  );
}

async function renderNeighborhoods(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
) {
  const geo = await geography();
  const pages = Math.max(
    1,
    Math.ceil(geo.neighborhoods.length / NEIGHBORHOODS_PER_PAGE),
  );
  const page = Math.max(0, Math.min(draft.neighborhood_page, pages - 1));
  draft.neighborhood_page = page;
  await saveState(user.id, "neighborhoods", draft);

  const entries = geo.neighborhoods.slice(
    page * NEIGHBORHOODS_PER_PAGE,
    (page + 1) * NEIGHBORHOODS_PER_PAGE,
  );
  const rows: any[] = [];
  for (let index = 0; index < entries.length; index += 2) {
    rows.push(
      entries.slice(index, index + 2).map((neighborhood) =>
        button(
          `${draft.neighborhood_ids.includes(neighborhood.id) ? "✅ " : ""}${neighborhood.name}`,
          `neighborhood:${neighborhood.id}`,
        )
      ),
    );
  }
  rows.push(
    [
      button("Alle auswählen", "neighborhood:all"),
      button("Auswahl löschen", "neighborhood:clear"),
    ],
    [
      button("←", "neighborhood:prev"),
      button(`${page + 1}/${pages}`, "noop"),
      button("→", "neighborhood:next"),
    ],
    backRow("location", "neighborhood:done"),
    cancelRow(),
  );
  return edit(
    chatId,
    messageId,
    `2/5 · <b>Hamburger Stadtteile</b>\n\nWähle beliebig viele Stadtteile.\n\n<b>${draft.neighborhood_ids.length}/${geo.neighborhoods.length} ausgewählt</b>`,
    { inline_keyboard: rows },
  );
}

async function renderRent(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
) {
  await saveState(user.id, "rent", draft);
  return edit(chatId, messageId, "3/5 · <b>Maximale Warmmiete</b>", {
    inline_keyboard: [
      [button("800 €", "rent:800"), button("1.000 €", "rent:1000")],
      [button("1.250 €", "rent:1250"), button("1.500 €", "rent:1500")],
      [button("✏️ Eigener Betrag", "rent:custom")],
      backRow("location"),
      cancelRow(),
    ],
  });
}

async function renderCustomRent(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
) {
  await saveState(user.id, "rent_custom", draft);
  return edit(
    chatId,
    messageId,
    "Gib die maximale Warmmiete als Zahl ein, z. B. <code>1250</code>.\n\n<b>Erlaubt: 100 bis 5.000 €</b>",
    { inline_keyboard: [backRow("rent"), cancelRow()] },
  );
}

async function renderRooms(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
) {
  await saveState(user.id, "rooms", draft);
  return edit(chatId, messageId, "4/5 · <b>Mindestens wie viele Zimmer?</b>", {
    inline_keyboard: [
      [button("1+", "rooms:1"), button("2+", "rooms:2")],
      [button("3+", "rooms:3"), button("4+", "rooms:4")],
      backRow("rent"),
      cancelRow(),
    ],
  });
}

async function renderArea(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
) {
  await saveState(user.id, "area", draft);
  return edit(chatId, messageId, "5/5 · <b>Mindestfläche</b>", {
    inline_keyboard: [
      [button("30 m²", "area:30"), button("50 m²", "area:50")],
      [button("70 m²", "area:70"), button("90 m²", "area:90")],
      backRow("rooms"),
      cancelRow(),
    ],
  });
}

async function selectedPlaces(draft: Draft) {
  const geo = await geography();
  if (draft.location_mode === "boroughs") {
    const selectedIds = new Set(draft.borough_ids);
    const boroughs = geo.boroughs
      .filter((value) => selectedIds.has(value.id))
      .map((value) => value.name);
    const districts = geo.neighborhoods
      .filter((value) => selectedIds.has(value.borough_id))
      .map((value) => value.name);
    return {
      location: boroughs.join(", "),
      districts,
      boroughs,
      neighborhoods: [] as string[],
    };
  }

  if (draft.location_mode === "neighborhoods") {
    const selectedIds = new Set(draft.neighborhood_ids);
    const selected = geo.neighborhoods.filter((value) => selectedIds.has(value.id));
    const neighborhoods = selected.map((value) => value.name);
    const boroughIdSet = new Set(selected.map((value) => value.borough_id));
    const boroughs = geo.boroughs
      .filter((value) => boroughIdSet.has(value.id))
      .map((value) => value.name);
    const location = neighborhoods.length > 12
      ? `${neighborhoods.slice(0, 12).join(", ")} … (+${neighborhoods.length - 12})`
      : neighborhoods.join(", ");
    return {
      location,
      districts: neighborhoods,
      boroughs,
      neighborhoods,
    };
  }

  return {
    location: "Ganz Hamburg",
    districts: ["Ganz Hamburg"],
    boroughs: [] as string[],
    neighborhoods: [] as string[],
  };
}

async function renderReview(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
): Promise<any> {
  const issue = validateDraft(draft);
  if (issue) return renderStep(user, chatId, messageId, draft, issue);

  const places = await selectedPlaces(draft);
  await saveState(user.id, "review", draft);
  const text =
    "✅ <b>Suchprofil prüfen</b>\n\n" +
    `🏠 <b>Typ:</b> ${esc(draft.property_types.join(", "))}\n` +
    `📍 <b>Gebiet:</b> ${esc(places.location)}\n` +
    `💶 <b>Warmmiete:</b> bis ${esc(money(draft.max_warm_rent))}\n` +
    `🚪 <b>Zimmer:</b> ${esc(draft.min_rooms)}+\n` +
    `📐 <b>Fläche:</b> ${esc(draft.min_area_sqm)} m²+`;

  return edit(chatId, messageId, text, {
    inline_keyboard: [
      [button("✅ Suche aktivieren", "profile:save")],
      [button("🏠 Typ", "edit:types"), button("📍 Gebiet", "edit:location")],
      [button("💶 Miete", "edit:rent"), button("🚪 Zimmer", "edit:rooms")],
      [button("📐 Fläche", "edit:area")],
      backRow("area"),
      cancelRow(),
    ],
  });
}

function renderStep(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
  step: OnboardingStep,
): Promise<any> {
  if (step === "types") return renderTypes(user, chatId, messageId, draft);
  if (step === "location") return renderLocation(user, chatId, messageId, draft);
  if (step === "boroughs") return renderBoroughs(user, chatId, messageId, draft);
  if (step === "neighborhoods") {
    return renderNeighborhoods(user, chatId, messageId, draft);
  }
  if (step === "rent") return renderRent(user, chatId, messageId, draft);
  if (step === "rent_custom") {
    return renderCustomRent(user, chatId, messageId, draft);
  }
  if (step === "rooms") return renderRooms(user, chatId, messageId, draft);
  if (step === "area") return renderArea(user, chatId, messageId, draft);
  return renderReview(user, chatId, messageId, draft);
}

async function afterSelection(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
  next: OnboardingStep,
) {
  if (draft.edit_return) {
    delete draft.edit_return;
    return renderReview(user, chatId, messageId, draft);
  }
  return renderStep(user, chatId, messageId, draft, next);
}

async function persistProfile(user: any, draft: Draft) {
  const issue = validateDraft(draft);
  if (issue) throw new Error(`incomplete profile: ${issue}`);
  const places = await selectedPlaces(draft);

  const { error } = await db.from("search_profiles").upsert(
    {
      user_id: user.id,
      profile_slot: 1,
      name: "Meine Suche",
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
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,profile_slot" },
  );
  if (error) throw error;
  await saveState(user.id, null, {});
}

async function profile(user: any, chatId: number, messageId?: number) {
  const { data, error } = await db
    .from("search_profiles")
    .select("*")
    .eq("user_id", user.id)
    .eq("profile_slot", 1)
    .maybeSingle();
  if (error) throw error;

  if (!data) {
    const text = "🔎 <b>Mein Suchprofil</b>\n\nNoch kein Suchprofil angelegt.";
    const markup = {
      inline_keyboard: [
        [button("➕ Erstellen", "new")],
        [button("← Start", "home")],
      ],
    };
    return messageId
      ? edit(chatId, messageId, text, markup)
      : send(chatId, text, markup);
  }

  const location = data.location_mode === "all_hamburg"
    ? "Ganz Hamburg"
    : data.location_mode === "boroughs"
    ? (data.boroughs || []).join(", ") || "Hamburg"
    : (data.neighborhoods || []).join(", ") || "Hamburg";
  const text =
    `🔎 <b>${esc(data.name || "Meine Suche")}</b>\n\n` +
    `Status: ${data.is_active ? "aktiv" : "pausiert"}\n` +
    `Typ: ${esc((data.property_types || []).join(", "))}\n` +
    `Gebiet: ${esc(location)}\n` +
    `Warmmiete: bis ${esc(money(data.max_warm_rent))}\n` +
    `Zimmer: ${esc(data.min_rooms ?? "–")}+\n` +
    `Fläche: ${esc(data.min_area_sqm ?? "–")} m²+`;
  const markup = {
    inline_keyboard: [
      [button("✏️ Ersetzen", "new")],
      [
        button(
          data.is_active ? "⏸ Pausieren" : "▶️ Fortsetzen",
          data.is_active ? "pause" : "resume",
        ),
      ],
      [button("← Start", "home")],
    ],
  };
  return messageId
    ? edit(chatId, messageId, text, markup)
    : send(chatId, text, markup);
}

async function premium(user: any, chatId: number, messageId?: number) {
  const rows: any[] = [];
  let text: string;
  if (user.is_premium) {
    text = "👑 <b>Premium aktiv</b>\n\nAlle Premium-Funktionen sind aktiv.";
    rows.push([button("💳 Abo verwalten", "portal")]);
  } else {
    text =
      "👑 <b>Traumwohnung Premium</b>\n\n" +
      "✅ Alle Quellen inkl. Baugenossenschaften\n" +
      "✅ Sofortige Zustellung\n" +
      "✅ Inserate speichern\n\n" +
      "<b>4,99 € / Monat</b>\n" +
      "Keine Mindestlaufzeit · jederzeit kündbar";
    rows.push([
      {
        text: "👑 Premium freischalten",
        url: `${PREMIUM_LINK}?client_reference_id=${encodeURIComponent(user.id)}`,
      },
    ]);
  }
  rows.push([button("← Start", "home")]);
  const markup = { inline_keyboard: rows };
  return messageId
    ? edit(chatId, messageId, text, markup)
    : send(chatId, text, markup);
}

async function saved(user: any, chatId: number, messageId?: number) {
  if (!user.is_premium) return premium(user, chatId, messageId);

  const { data, error } = await db
    .from("saved_listings")
    .select("listing_id,created_at,listings(title,canonical_url,warm_rent,cold_rent,is_active)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;

  if (!data?.length) {
    const text = "💾 <b>Gespeicherte Inserate</b>\n\nNoch keine Inserate gespeichert.";
    const markup = { inline_keyboard: [[button("← Start", "home")]] };
    return messageId
      ? edit(chatId, messageId, text, markup)
      : send(chatId, text, markup);
  }

  const lines = ["💾 <b>Gespeicherte Inserate</b>", ""];
  const rows: any[] = [];
  for (const [index, row] of data.entries()) {
    const listing: any = row.listings || {};
    lines.push(
      `${index + 1}. ${esc(short(listing.title))} · ${esc(money(listing.warm_rent || listing.cold_rent))}${listing.is_active ? "" : " · inaktiv"}`,
    );
    try {
      const url = new URL(listing.canonical_url);
      if (["http:", "https:"].includes(url.protocol)) {
        rows.push([{ text: `${index + 1}. Inserat öffnen`, url: url.href }]);
      }
    } catch {
      // Ignore malformed historic listing URLs.
    }
  }
  rows.push([button("← Start", "home")]);
  const markup = { inline_keyboard: rows };
  return messageId
    ? edit(chatId, messageId, lines.join("\n"), markup)
    : send(chatId, lines.join("\n"), markup);
}

async function renderStatus(user: any, chatId: number, messageId?: number) {
  const [profileResult, sourceResult] = await Promise.all([
    db
      .from("search_profiles")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("profile_slot", 1)
      .eq("is_active", true),
    db
      .from("sources")
      .select("id", { count: "exact", head: true })
      .eq("enabled", true)
      .eq("runtime_mode", "live"),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (sourceResult.error) throw sourceResult.error;

  const text =
    "📡 <b>Status</b>\n\n" +
    `Aktives Suchprofil: ${profileResult.count ? "ja" : "nein"}\n` +
    `Aktive Quellen: ${sourceResult.count || 0}\n` +
    "System: online";
  const markup = { inline_keyboard: [[button("← Start", "home")]] };
  return messageId
    ? edit(chatId, messageId, text, markup)
    : send(chatId, text, markup);
}

async function setPaused(userId: string, paused: boolean) {
  const { error } = await db
    .from("search_profiles")
    .update({ is_active: !paused, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("profile_slot", 1);
  if (error) throw error;
}

async function toggleSave(user: any, listingId: string) {
  if (!user.is_premium) return null;

  const { data: listing, error } = await db
    .from("listings")
    .select("id,duplicate_of_listing_id")
    .eq("id", listingId)
    .maybeSingle();
  if (error) throw error;
  if (!listing) throw new Error("listing unavailable");

  const canonicalListingId = listing.duplicate_of_listing_id || listing.id;
  const { data: existing, error: existingError } = await db
    .from("saved_listings")
    .select("id")
    .eq("user_id", user.id)
    .eq("listing_id", canonicalListingId)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing) {
    const { error: deleteError } = await db
      .from("saved_listings")
      .delete()
      .eq("id", existing.id);
    if (deleteError) throw deleteError;
    return false;
  }

  const { error: insertError } = await db
    .from("saved_listings")
    .insert({ user_id: user.id, listing_id: canonicalListingId });
  if (insertError) throw insertError;
  return true;
}

async function settings(user: any, chatId: number, messageId?: number) {
  const text = "⚙️ <b>Einstellungen</b>\n\nDie Bedienung erfolgt über Befehle und Buttons.";
  const markup = {
    inline_keyboard: [
      [button("⏸ Pausieren", "pause"), button("▶️ Fortsetzen", "resume")],
      [button("👑 Premium", "premium")],
      [button("← Start", "home")],
    ],
  };
  return messageId
    ? edit(chatId, messageId, text, markup)
    : send(chatId, text, markup);
}

async function handleMessage(message: any, user: any) {
  const chatId = Number(message.chat.id);
  const text = String(message.text || "").trim();
  const [rawCommand, argument = ""] = text.split(/\s+/, 2);
  const command = rawCommand
    .toLowerCase()
    .replace(/@traumwohnunghamburgbot$/i, "");

  if (command === "/start") {
    if (argument.startsWith("ref_")) {
      const { error } = await db.rpc("redeem_referral_code", {
        p_referred_user_id: user.id,
        p_code: argument.slice(4),
      });
      if (error) console.error("referral", error.message);
    }
    telegram("setChatMenuButton", {
      chat_id: chatId,
      menu_button: { type: "commands" },
    }).catch(() => {});
    return home(user, chatId);
  }

  if (command === "/suche") {
    const draft = emptyDraft();
    return renderTypes({ ...user, onboarding_state: draft }, chatId, undefined, draft);
  }
  if (command === "/profile") return profile(user, chatId);
  if (command === "/gespeichert" || command === "/saved") {
    return saved(user, chatId);
  }
  if (command === "/einstellungen" || command === "/settings") {
    return settings(user, chatId);
  }
  if (command === "/pause") {
    await setPaused(user.id, true);
    return send(chatId, "⏸ Dein Suchprofil ist pausiert.");
  }
  if (command === "/resume") {
    await setPaused(user.id, false);
    return send(chatId, "▶️ Dein Suchprofil ist wieder aktiv.");
  }
  if (command === "/status") return renderStatus(user, chatId);
  if (command === "/hilfe" || command === "/help") {
    return send(chatId, HELP_TEXT);
  }
  if (command === "/premium") return premium(user, chatId);

  const draft = draftFor(user);
  if (user.onboarding_step === "rent_custom") {
    const value = Number(text.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(value) || value < 100 || value > 5000) {
      return send(
        chatId,
        "Bitte einen Betrag zwischen 100 und 5.000 eingeben.",
      );
    }
    draft.max_warm_rent = value;
    if (draft.edit_return) {
      delete draft.edit_return;
      return renderReview(user, chatId, message.message_id, draft);
    }
    await saveState(user.id, "rooms", draft);
    return send(chatId, "4/5 · <b>Mindestens wie viele Zimmer?</b>", {
      inline_keyboard: [
        [button("1+", "rooms:1"), button("2+", "rooms:2")],
        [button("3+", "rooms:3"), button("4+", "rooms:4")],
        backRow("rent"),
        cancelRow(),
      ],
    });
  }

  return send(
    chatId,
    "Bitte verwende die Befehle oder Buttons. Mit /hilfe siehst du alle Befehle.",
  );
}

async function handleCallback(query: any, user: any) {
  const chatId = Number(query.message?.chat.id);
  const messageId = Number(query.message?.message_id);
  const data = String(query.data || "");
  if (!chatId || !messageId) return acknowledge(query.id);

  if (data.startsWith("save:")) {
    const savedState = await toggleSave(user, data.slice(5));
    if (savedState === null) {
      await acknowledge(query.id);
      return premium(user, chatId, messageId);
    }
    return acknowledge(query.id, savedState ? "Gespeichert" : "Entfernt");
  }

  await acknowledge(query.id);

  if (data === "noop") return;
  if (data === "cancel") {
    await saveState(user.id, null, {});
    return home({ ...user, onboarding_step: null, onboarding_state: {} }, chatId, messageId);
  }
  if (data === "home") return home(user, chatId, messageId);
  if (data === "new") {
    const draft = emptyDraft();
    return renderTypes(user, chatId, messageId, draft);
  }
  if (data === "draft") {
    const draft = draftFor(user);
    const step = String(user.onboarding_step || "types") as OnboardingStep;
    return renderStep(
      user,
      chatId,
      messageId,
      draft,
      [
          "types",
          "location",
          "boroughs",
          "neighborhoods",
          "rent",
          "rent_custom",
          "rooms",
          "area",
          "review",
        ].includes(step)
        ? step
        : "types",
    );
  }
  if (data === "profile" || data === "profiles" || data === "p:view:1") {
    return profile(user, chatId, messageId);
  }
  if (data === "saved" || data.startsWith("saved:")) {
    return saved(user, chatId, messageId);
  }
  if (data === "settings") return settings(user, chatId, messageId);
  if (data === "help") {
    return edit(chatId, messageId, HELP_TEXT, {
      inline_keyboard: [[button("← Start", "home")]],
    });
  }
  if (data === "premium") return premium(user, chatId, messageId);
  if (data === "portal") {
    const url = await secret("stripe_portal_url").catch(() => null);
    const valid = url && /^https:\/\/billing\.stripe\.com\//.test(url);
    return edit(
      chatId,
      messageId,
      valid
        ? "💳 <b>Abo verwalten</b>"
        : "💳 Das Stripe Customer Portal ist aktuell noch nicht konfiguriert.",
      {
        inline_keyboard: [
          ...(valid ? [[{ text: "Stripe öffnen", url }]] : []),
          [button("← Premium", "premium")],
        ],
      },
    );
  }
  if (data === "pause") {
    await setPaused(user.id, true);
    return edit(
      chatId,
      messageId,
      "⏸ Dein Suchprofil ist pausiert.",
      homeKeyboard(user),
    );
  }
  if (data === "resume") {
    await setPaused(user.id, false);
    return edit(
      chatId,
      messageId,
      "▶️ Dein Suchprofil ist wieder aktiv.",
      homeKeyboard(user),
    );
  }
  if (data === "status") return renderStatus(user, chatId, messageId);

  const draft = draftFor(user);

  if (data === "types") return renderTypes(user, chatId, messageId, draft);
  if (data === "location") return renderLocation(user, chatId, messageId, draft);
  if (data === "boroughs") {
    return renderBoroughs(user, chatId, messageId, draft);
  }
  if (data === "neighborhoods") {
    return renderNeighborhoods(user, chatId, messageId, draft);
  }
  if (data === "rent") return renderRent(user, chatId, messageId, draft);
  if (data === "rooms") return renderRooms(user, chatId, messageId, draft);
  if (data === "area") return renderArea(user, chatId, messageId, draft);

  if (data.startsWith("edit:")) {
    draft.edit_return = true;
    const step = data.slice(5);
    if (step === "types") return renderTypes(user, chatId, messageId, draft);
    if (step === "location") {
      return renderLocation(user, chatId, messageId, draft);
    }
    if (step === "rent") return renderRent(user, chatId, messageId, draft);
    if (step === "rooms") return renderRooms(user, chatId, messageId, draft);
    if (step === "area") return renderArea(user, chatId, messageId, draft);
  }

  if (data.startsWith("type:")) {
    const value = data.slice(5);
    if (value === "all") draft.property_types = [...PROPERTY_TYPES];
    else if (value === "clear") draft.property_types = [];
    else if (value === "done") {
      if (!draft.property_types.length) {
        return renderTypes(user, chatId, messageId, draft);
      }
      return afterSelection(user, chatId, messageId, draft, "location");
    } else if (PROPERTY_TYPES.includes(value as PropertyType)) {
      const type = value as PropertyType;
      draft.property_types = draft.property_types.includes(type)
        ? draft.property_types.filter((entry) => entry !== type)
        : [...draft.property_types, type];
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
        draft.borough_ids = draft.borough_ids.includes(id)
          ? draft.borough_ids.filter((entry) => entry !== id)
          : [...draft.borough_ids, id];
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
      const pages = Math.max(
        1,
        Math.ceil(geo.neighborhoods.length / NEIGHBORHOODS_PER_PAGE),
      );
      draft.neighborhood_page = Math.min(
        pages - 1,
        draft.neighborhood_page + 1,
      );
    } else if (value === "done") {
      if (!draft.neighborhood_ids.length) {
        return renderNeighborhoods(user, chatId, messageId, draft);
      }
      return afterSelection(user, chatId, messageId, draft, "rent");
    } else {
      const id = Number(value);
      if (geo.neighborhoods.some((entry) => entry.id === id)) {
        draft.neighborhood_ids = draft.neighborhood_ids.includes(id)
          ? draft.neighborhood_ids.filter((entry) => entry !== id)
          : [...draft.neighborhood_ids, id];
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
      delete draft.edit_return;
      return renderReview(user, chatId, messageId, draft);
    }
    return renderArea(user, chatId, messageId, draft);
  }

  if (data === "profile:save" || data === "s:save") {
    const issue = validateDraft(draft);
    if (issue) return renderStep(user, chatId, messageId, draft, issue);
    await persistProfile(user, draft);
    return edit(
      chatId,
      messageId,
      "✅ Deine Suche ist aktiv. Neue passende Inserate werden automatisch zugestellt.",
      homeKeyboard({ ...user, onboarding_step: null }),
    );
  }
}

async function claimUpdate(payload: any) {
  const { error } = await db.from("bot_events").insert({
    telegram_update_id: payload.update_id,
    event_type: payload.callback_query
      ? "callback_query"
      : payload.message
      ? "message"
      : "other",
    telegram_user_id:
      payload.callback_query?.from?.id || payload.message?.from?.id || null,
    payload,
  });
  if (!error) return true;
  if (
    error.code === "23505" ||
    String(error.message).toLowerCase().includes("duplicate")
  ) {
    return false;
  }
  console.error("bot_event", error.message);
  return true;
}

Deno.serve(async (request: Request) => {
  try {
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    let expectedSecret = await secret("telegram_webhook_secret");
    const suppliedSecret =
      request.headers.get("x-telegram-bot-api-secret-token") || "";
    if (suppliedSecret !== expectedSecret) {
      secretCache.delete("telegram_webhook_secret");
      expectedSecret = await secret("telegram_webhook_secret", true);
      if (suppliedSecret !== expectedSecret) {
        return new Response("unauthorized", { status: 401 });
      }
    }

    const payload = await request.json().catch(() => ({}));
    const from = payload.callback_query?.from || payload.message?.from;
    const chatId =
      payload.callback_query?.message?.chat?.id || payload.message?.chat?.id;
    if (!from?.id || !chatId) return Response.json({ ok: true, ignored: true });
    if (!(await claimUpdate(payload))) {
      return Response.json({ ok: true, duplicate: true });
    }

    const user = await withPlan(await ensureUser(from, Number(chatId)));
    if (payload.callback_query) {
      await handleCallback(payload.callback_query, user);
    } else if (
      payload.message?.chat?.type === "private" &&
      payload.message?.text
    ) {
      await handleMessage(payload.message, user);
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("telegram_command_runtime", error);
    return Response.json(
      { ok: false, error: "command_runtime_failed" },
      { status: 500 },
    );
  }
});
