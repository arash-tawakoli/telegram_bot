import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { LANGS, localizeMarkup, localizeText } from "./i18n.ts";

type PropertyType = "Wohnung" | "Haus" | "WG" | "Tauschwohnung";
type LocationMode = "all_hamburg" | "boroughs" | "neighborhoods";
type AdminGrant = "free" | "7d" | "30d" | "3m" | "life";
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
  profile_slot: number;
  edit_return?: boolean;
  profile_edit?: boolean;
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

const PREMIUM_LINK = "https://buy.stripe.com/dRm9AM7DSajfgYK2qVfYY01";
const PREMIUM_PREVIEW_B64 = "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";
const PROPERTY_TYPES: PropertyType[] = [
  "Wohnung",
  "Haus",
  "WG",
  "Tauschwohnung",
];
const RENT_PRESETS = new Set([800, 1000, 1250, 2000]);
const ROOM_PRESETS = new Set([1, 2, 3, 4]);
const AREA_PRESETS = new Set([20, 50, 70, 90]);
const NEIGHBORHOODS_PER_PAGE = 10;
const SAVED_PAGE_SIZE = 8;
const SECRET_TTL_MS = 5 * 60_000;
const GEO_TTL_MS = 30 * 60_000;
const ADMIN_TELEGRAM_USER_ID = 8538226539;

const secretCache = new Map<string, { value: string; expiresAt: number }>();
const chatLanguages = new Map<number, string>();
let geoCache: { value: Geography; expiresAt: number } | null = null;

function emptyDraft(profileSlot = 1): Draft {
  return {
    profile_slot: Math.max(1, Math.min(3, Number(profileSlot) || 1)),
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
    profile_slot: Math.max(1, Math.min(3, Number(raw?.profile_slot) || 1)),
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
    profile_edit: raw?.profile_edit === true,
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
    text: localizeText(text, chatLanguages.get(chatId)),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: localizeMarkup(replyMarkup, chatLanguages.get(chatId)),
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
      text: localizeText(text, chatLanguages.get(chatId)),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: localizeMarkup(replyMarkup, chatLanguages.get(chatId)),
    });
  } catch {
    return send(chatId, text, replyMarkup);
  }
}

async function sendPremiumPreview(chatId: number, caption: string, replyMarkup: any) {
  const language = chatLanguages.get(chatId);
  return telegram("sendPhoto", {
    chat_id: chatId,
    photo: `${SUPABASE_URL}/functions/v1/telegram-ui?asset=premium`,
    caption: localizeText(caption, language),
    parse_mode: "HTML",
    reply_markup: localizeMarkup(replyMarkup, language),
  });
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
    [
      button("🔎 Suchprofil", "profile"),
      button("⭐️ Gespeichert", "saved"),
    ],
    [
      button(
        user.is_premium ? "💎 Premium aktiv" : "💎 Premium",
        "premium",
      ),
      button("⚙️ Einstellungen", "settings"),
    ],
    [button("❓ Hilfe", "help")],
  );
  return { inline_keyboard: rows };
}

const HELP_TEXT =
  "❓ <b>Hilfe & Befehle</b>\n\n" +
  "🏠 /start – Startmenü\n" +
  "🔎 /suche – Suchprofil erstellen oder ersetzen\n" +
  "👤 /profile – Suchprofil anzeigen\n" +
  "⭐️ /gespeichert – gespeicherte Inserate\n" +
  "⚙️ /einstellungen – Einstellungen\n" +
  "⏸ /pause – Suche pausieren\n" +
  "▶️ /resume – Suche fortsetzen\n" +
  "📡 /status – Systemstatus\n" +
  "💎 /premium – Premium anzeigen\n" +
  "❓ /hilfe – Hilfe";

function home(user: any, chatId: number, messageId?: number) {
  const text =
    "🏠 <b>Traumwohnung Hamburg</b>\n\n" +
    "Finde passende Mietangebote in Hamburg – automatisch und direkt per Telegram.\n\n" +
    "Wähle unten, was du machen möchtest.";
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
    backRow(
      draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "home",
      "type:done",
    ),
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
      [button(`${draft.location_mode === "all_hamburg" ? "✅ " : ""}🌐 Ganz Hamburg`, "loc:all")],
      [button(`${draft.location_mode === "boroughs" ? "✅ " : ""}🏙 Bezirke auswählen`, "loc:boroughs")],
      [button(`${draft.location_mode === "neighborhoods" ? "✅ " : ""}📍 Stadtteile auswählen`, "loc:neighborhoods")],
      backRow(draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "types"),
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
  const customSelected = draft.max_warm_rent != null &&
    !RENT_PRESETS.has(draft.max_warm_rent);
  return edit(chatId, messageId, "3/5 · <b>Maximale Warmmiete</b>", {
    inline_keyboard: [
      [
        button(`${draft.max_warm_rent === 800 ? "✅ " : ""}800 €`, "rent:800"),
        button(`${draft.max_warm_rent === 1000 ? "✅ " : ""}1.000 €`, "rent:1000"),
      ],
      [
        button(`${draft.max_warm_rent === 1250 ? "✅ " : ""}1.250 €`, "rent:1250"),
        button(`${draft.max_warm_rent === 2000 ? "✅ " : ""}2.000 €`, "rent:2000"),
      ],
      [button(
        customSelected
          ? `✅ Eigener Betrag · ${money(draft.max_warm_rent)}`
          : "✏️ Eigener Betrag",
        "rent:custom",
      )],
      backRow(draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "location"),
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
  const current = draft.max_warm_rent != null
    ? `\n\nAktuell gespeichert: <b>${esc(money(draft.max_warm_rent))}</b>`
    : "";
  return edit(
    chatId,
    messageId,
    `Gib die maximale Warmmiete als Zahl ein, z. B. <code>1250</code>.\n\n<b>Erlaubt: 100 bis 5.000 €</b>${current}`,
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
      [
        button(`${draft.min_rooms === 1 ? "✅ " : ""}1+`, "rooms:1"),
        button(`${draft.min_rooms === 2 ? "✅ " : ""}2+`, "rooms:2"),
      ],
      [
        button(`${draft.min_rooms === 3 ? "✅ " : ""}3+`, "rooms:3"),
        button(`${draft.min_rooms === 4 ? "✅ " : ""}4+`, "rooms:4"),
      ],
      backRow(draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "rent"),
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
      [
        button(`${draft.min_area_sqm === 20 ? "✅ " : ""}20 m²`, "area:20"),
        button(`${draft.min_area_sqm === 50 ? "✅ " : ""}50 m²`, "area:50"),
      ],
      [
        button(`${draft.min_area_sqm === 70 ? "✅ " : ""}70 m²`, "area:70"),
        button(`${draft.min_area_sqm === 90 ? "✅ " : ""}90 m²`, "area:90"),
      ],
      backRow(draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "rooms"),
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

async function persistProfile(user: any, draft: Draft) {
  const issue = validateDraft(draft);
  if (issue) throw new Error(`incomplete profile: ${issue}`);
  const places = await selectedPlaces(draft);
  const slot = Math.max(1, Math.min(profileLimit(user), Number(draft.profile_slot) || 1));
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
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,profile_slot" });
  if (error) throw error;
  await saveState(user.id, null, {});
}

function profileLimit(user: any) { return user.is_premium ? 3 : 1; }

function profileLocation(current: any) {
  return current.location_mode === "all_hamburg"
    ? "Ganz Hamburg"
    : current.location_mode === "boroughs"
    ? (current.boroughs || []).join(", ") || "Hamburg"
    : (current.neighborhoods || []).join(", ") ||
      (current.districts || []).join(", ") ||
      "Hamburg";
}

async function draftFromProfile(current: any): Promise<Draft> {
  const geo = await geography();
  const boroughNames = new Set(
    (Array.isArray(current.boroughs) ? current.boroughs : []).map(String),
  );
  const neighborhoodSource = Array.isArray(current.neighborhoods) &&
      current.neighborhoods.length
    ? current.neighborhoods
    : current.location_mode === "neighborhoods" && Array.isArray(current.districts)
    ? current.districts
    : [];
  const neighborhoodNames = new Set(neighborhoodSource.map(String));

  return normalizeDraft({
    profile_slot: current.profile_slot,
    property_types: current.property_types || [],
    location_mode: current.location_mode,
    borough_ids: geo.boroughs
      .filter((entry) => boroughNames.has(String(entry.name)))
      .map((entry) => entry.id),
    neighborhood_ids: geo.neighborhoods
      .filter((entry) => neighborhoodNames.has(String(entry.name)))
      .map((entry) => entry.id),
    neighborhood_page: 0,
    max_warm_rent: current.max_warm_rent,
    min_rooms: current.min_rooms,
    min_area_sqm: current.min_area_sqm,
    profile_edit: true,
  });
}

async function startNewProfile(user: any, chatId: number, messageId?: number, requestedSlot?: number) {
  const limit = profileLimit(user);
  const { data, error } = await db.from("search_profiles").select("profile_slot").eq("user_id", user.id).order("profile_slot");
  if (error) throw error;
  const used = new Set((data || []).map((row: any) => Number(row.profile_slot)));
  const slot = requestedSlot && requestedSlot >= 1 && requestedSlot <= limit
    ? requestedSlot
    : Array.from({ length: limit }, (_, i) => i + 1).find((value) => !used.has(value));
  if (!slot) return profile(user, chatId, messageId);
  const draft = emptyDraft(slot);
  return renderTypes({ ...user, onboarding_state: draft }, chatId, messageId, draft);
}

async function profileEditMenu(
  user: any,
  chatId: number,
  messageId: number,
  selectedSlot: number,
) {
  if (!Number.isInteger(selectedSlot) || selectedSlot < 1 || selectedSlot > profileLimit(user)) {
    return profile(user, chatId, messageId);
  }
  const { data: current, error } = await db
    .from("search_profiles")
    .select("*")
    .eq("user_id", user.id)
    .eq("profile_slot", selectedSlot)
    .maybeSingle();
  if (error) throw error;
  if (!current) return profile(user, chatId, messageId);
  await saveState(user.id, null, {});

  const text =
    "✏️ <b>Suchprofil ändern</b>\n\n" +
    "Wähle, was du ändern möchtest. Deine aktuell gespeicherten Werte bleiben vorausgewählt.\n\n" +
    `🏠 <b>Typ:</b> ${esc((current.property_types || []).join(", "))}\n` +
    `📍 <b>Gebiet:</b> ${esc(profileLocation(current))}\n` +
    `💶 <b>Warmmiete:</b> bis ${esc(money(current.max_warm_rent))}\n` +
    `🚪 <b>Zimmer:</b> ${esc(current.min_rooms ?? "–")}+\n` +
    `📐 <b>Fläche:</b> ${esc(current.min_area_sqm ?? "–")} m²+`;
  const markup = { inline_keyboard: [
    [button("🏠 Wohnungsart", `profile:edit-field:${selectedSlot}:types`)],
    [button("📍 Gebiet", `profile:edit-field:${selectedSlot}:location`)],
    [button("💶 Warmmiete", `profile:edit-field:${selectedSlot}:rent`)],
    [button("🚪 Zimmer", `profile:edit-field:${selectedSlot}:rooms`)],
    [button("📐 Fläche", `profile:edit-field:${selectedSlot}:area`)],
    [button("← Zurück", `profile:view:${selectedSlot}`)],
  ] };
  return edit(chatId, messageId, text, markup);
}

async function profile(user: any, chatId: number, messageId?: number, selectedSlot?: number) {
  const limit = profileLimit(user);
  const { data, error } = await db.from("search_profiles").select("*").eq("user_id", user.id).lte("profile_slot", limit).order("profile_slot");
  if (error) throw error;
  const profiles = data || [];
  if (selectedSlot) {
    const current: any = profiles.find((row: any) => Number(row.profile_slot) === selectedSlot);
    if (!current) return profile(user, chatId, messageId);
    const location = profileLocation(current);
    const text = `🔎 <b>${esc(current.name || `Meine Suche ${selectedSlot}`)}</b>\n\n` +
      `Status: ${current.is_active ? "aktiv" : "pausiert"}\n` +
      `Typ: ${esc((current.property_types || []).join(", "))}\n` +
      `Gebiet: ${esc(location)}\n` +
      `Warmmiete: bis ${esc(money(current.max_warm_rent))}\n` +
      `Zimmer: ${esc(current.min_rooms ?? "–")}+\n` +
      `Fläche: ${esc(current.min_area_sqm ?? "–")} m²+`;
    const markup = { inline_keyboard: [
      [button("✏️ Suchprofil ändern", `profile:edit:${selectedSlot}`)],
      [button(current.is_active ? "⏸ Pausieren" : "▶️ Fortsetzen", current.is_active ? `profile:pause:${selectedSlot}` : `profile:resume:${selectedSlot}`)],
      [button("🗑 Profil löschen", `profile:delete:${selectedSlot}`)],
      [button("← Zurück", "profile")],
    ]};
    return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
  }
  const rows: any[] = profiles.map((row: any) => [button(`🔎 ${row.name || `Meine Suche ${row.profile_slot}`} · ${row.is_active ? "aktiv" : "pausiert"}`, `profile:view:${row.profile_slot}`)]);
  if (profiles.length < limit) rows.push([button("➕ Suchprofil erstellen", "new")]);
  rows.push([button("← Zurück", "home")]);
  const text = profiles.length
    ? `🔎 <b>Meine Suchprofile</b>\n\n${profiles.length}/${limit} Suchprofile angelegt.`
    : "🔎 <b>Meine Suchprofile</b>\n\nNoch kein Suchprofil angelegt.";
  const markup = { inline_keyboard: rows };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

async function premium(user: any, chatId: number, _messageId?: number) {
  const rows: any[] = [];
  let text: string;
  if (user.is_premium) {
    text = "💎 <b>Traumwohnung Premium</b>\n\n✅ <b>Premium ist aktiv.</b>\n\n<b>Deine Vorteile:</b>\n⚡ Sofortige Zustellung\n🔎 Bis zu 3 Suchprofile\n🔓 Baugenossenschafts-Angebote öffnen\n⭐️ Inserate speichern";
    rows.push([button("💳 Abo verwalten", "portal")]);
  } else {
    text = "💎 <b>Traumwohnung Premium</b>\n\n<b>Deine Vorteile:</b>\n⚡ Sofortige Zustellung\n🔎 Bis zu 3 Suchprofile\n🔓 Baugenossenschafts-Angebote öffnen\n⭐️ Inserate speichern\n\n<s>1,99 €</s> <b>0,99 € / Monat</b>\nKeine Mindestlaufzeit · jederzeit kündbar";
    rows.push([{ text: "💎 Premium freischalten", url: `${PREMIUM_LINK}?client_reference_id=${encodeURIComponent(user.id)}` }]);
  }
  rows.push([button("← Zurück", "home")]);
  return sendPremiumPreview(chatId, text, { inline_keyboard: rows });
}

async function saved(user: any, chatId: number, messageId?: number, requestedPage = 0) {
  if (!user.is_premium) return premium(user, chatId, messageId);

  const { count, error: countError } = await db
    .from("saved_listings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (countError) throw countError;

  const total = count || 0;
  if (!total) {
    const text = "⭐️ <b>Gespeicherte Inserate</b>\n\nNoch keine Inserate gespeichert.";
    const markup = { inline_keyboard: [[button("← Zurück", "home")]] };
    return messageId
      ? edit(chatId, messageId, text, markup)
      : send(chatId, text, markup);
  }

  const pages = Math.max(1, Math.ceil(total / SAVED_PAGE_SIZE));
  const page = Math.max(0, Math.min(Number(requestedPage) || 0, pages - 1));
  const from = page * SAVED_PAGE_SIZE;
  const to = from + SAVED_PAGE_SIZE - 1;
  const { data, error } = await db
    .from("saved_listings")
    .select("listing_id,created_at,listings(title,canonical_url,is_active)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw error;

  const rows: any[] = [];
  for (const [index, row] of (data || []).entries()) {
    const listing: any = row.listings || {};
    const label = `🏠 ${from + index + 1}. ${short(listing.title, 42)}`;
    try {
      const url = new URL(listing.canonical_url);
      if (["http:", "https:"].includes(url.protocol)) {
        rows.push([{ text: label, url: url.href }]);
        continue;
      }
    } catch {
      // Historic listings can contain malformed URLs.
    }
    rows.push([button(label, "noop")]);
  }

  rows.push([
    button("← Zurück", `saved:${Math.max(0, page - 1)}`),
    button(`${page + 1}/${pages}`, "noop"),
    button("Weiter →", `saved:${Math.min(pages - 1, page + 1)}`),
  ]);
  rows.push([button("← Start", "home")]);
  const text = `⭐️ <b>Gespeicherte Inserate</b>\n\n${total} · Seite ${page + 1}/${pages}`;
  const markup = { inline_keyboard: rows };
  return messageId
    ? edit(chatId, messageId, text, markup)
    : send(chatId, text, markup);
}

async function renderStatus(user: any, chatId: number, messageId?: number) {
  const [profileResult, sourceResult, referralResult] = await Promise.all([
    db.from("search_profiles").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_active", true).lte("profile_slot", profileLimit(user)),
    db.from("sources").select("id", { count: "exact", head: true }),
    db.from("referrals").select("id", { count: "exact", head: true }).eq("referrer_user_id", user.id).eq("status", "rewarded"),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (sourceResult.error) throw sourceResult.error;
  if (referralResult.error) throw referralResult.error;
  const text = "📡 <b>Systemstatus</b>\n\n" +
    `🔎 Suchprofile aktiv: ${profileResult.count || 0}/${profileLimit(user)}\n` +
    `🌐 Quellen im System: ${sourceResult.count || 0}\n` +
    `🎁 Erfolgreiche Empfehlungen: ${referralResult.count || 0}\n` +
    "✅ System: online";
  const markup = { inline_keyboard: [[button("← Einstellungen", "settings")]] };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

async function setPaused(userId: string, paused: boolean, slot?: number) {
  let query: any = db.from("search_profiles").update({ is_active: !paused, updated_at: new Date().toISOString() }).eq("user_id", userId);
  if (slot) query = query.eq("profile_slot", slot);
  const { error } = await query;
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

function isAdmin(user: any) {
  return Number(user?.telegram_user_id) === ADMIN_TELEGRAM_USER_ID;
}

function effectivePremiumFor(user: any, subscription: any) {
  const now = Date.now();
  if (user?.plan_override === "free") return false;
  if (
    user?.plan_override === "premium" &&
    (!user.plan_override_expires_at ||
      new Date(user.plan_override_expires_at).getTime() > now)
  ) return true;
  if (
    user?.referral_bonus_until &&
    new Date(user.referral_bonus_until).getTime() > now
  ) return true;
  return !!subscription &&
    ["active", "trialing"].includes(String(subscription.status || "")) &&
    (!subscription.current_period_end ||
      new Date(subscription.current_period_end).getTime() > now);
}

function adminGrantLabel(grant: AdminGrant) {
  return grant === "7d"
    ? "7 Tage"
    : grant === "30d"
    ? "30 Tage"
    : grant === "3m"
    ? "3 Monate"
    : "lebenslang";
}

function adminGrantExpiry(grant: AdminGrant) {
  if (grant === "free" || grant === "life") return null;
  const date = new Date();
  if (grant === "7d") date.setUTCDate(date.getUTCDate() + 7);
  else if (grant === "30d") date.setUTCDate(date.getUTCDate() + 30);
  else date.setUTCMonth(date.getUTCMonth() + 3);
  return date.toISOString();
}

function adminOverrideLabel(user: any) {
  if (user.plan_override === "free") return "FREE";
  if (user.plan_override !== "premium") return "STRIPE";
  if (!user.plan_override_expires_at) return "PREMIUM · LEBENSLANG";
  const until = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(user.plan_override_expires_at));
  return `PREMIUM · bis ${until}`;
}

function adminPremiumNotice(grant: AdminGrant) {
  return grant === "life"
    ? "🎁 <b>Kostenloses Premium aktiviert</b>\n\nDu hast kostenlos Premium auf Lebenszeit bekommen. Premium ist ab sofort aktiv."
    : `🎁 <b>Kostenloses Premium aktiviert</b>\n\nDu hast ${adminGrantLabel(grant)} kostenlos Premium bekommen. Premium ist ab sofort aktiv.`;
}

async function adminUsers(user: any, chatId: number, messageId?: number) {
  if (!isAdmin(user)) return;
  const { data: users, error } = await db
    .from("bot_users")
    .select("id,telegram_user_id,first_name,last_name,username,plan_override,plan_override_expires_at,referral_bonus_until,created_at")
    .eq("is_active", true)
    .order("created_at");
  if (error) throw error;

  const ids = (users || []).map((entry: any) => entry.id);
  let subscriptions: any[] = [];
  if (ids.length) {
    const { data, error: subscriptionError } = await db
      .from("user_subscriptions")
      .select("user_id,status,current_period_end")
      .in("user_id", ids);
    if (subscriptionError) throw subscriptionError;
    subscriptions = data || [];
  }
  const subscriptionByUser = new Map(
    subscriptions.map((entry: any) => [String(entry.user_id), entry]),
  );
  const rows: any[] = (users || []).map((entry: any) => {
    const premium = effectivePremiumFor(
      entry,
      subscriptionByUser.get(String(entry.id)),
    );
    const name = short(
      [entry.first_name, entry.last_name].filter(Boolean).join(" ") ||
        entry.username ||
        String(entry.telegram_user_id),
      34,
    );
    return [
      button(
        `${premium ? "💎" : "▫️"} ${name} · ${premium ? "PREMIUM" : "FREE"}`,
        `admin:user:${entry.id}`,
      ),
    ];
  });
  if (!rows.length) rows.push([button("Keine aktiven Nutzer", "noop")]);
  const text = `🔒 <b>Admin</b>\n\nAktive Nutzer: ${users?.length || 0}`;
  const markup = { inline_keyboard: rows };
  return messageId
    ? edit(chatId, messageId, text, markup)
    : send(chatId, text, markup);
}

async function adminUser(
  user: any,
  chatId: number,
  messageId: number,
  userId: string,
) {
  if (!isAdmin(user)) return;
  const { data: target, error } = await db
    .from("bot_users")
    .select("id,telegram_user_id,chat_id,first_name,last_name,username,is_active,plan_override,plan_override_expires_at,referral_bonus_until")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!target?.is_active) return adminUsers(user, chatId, messageId);

  const { data: subscription, error: subscriptionError } = await db
    .from("user_subscriptions")
    .select("status,current_period_end,cancel_at_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (subscriptionError) throw subscriptionError;

  const premium = effectivePremiumFor(target, subscription);
  const name = [target.first_name, target.last_name].filter(Boolean).join(" ") ||
    target.username || String(target.telegram_user_id);
  const text =
    `🔒 <b>Admin · Nutzer</b>\n\n` +
    `<b>${esc(name)}</b>\n` +
    `Telegram: <code>${esc(target.telegram_user_id)}</code>\n` +
    `Status: <b>${premium ? "PREMIUM" : "FREE"}</b>\n` +
    `Override: ${esc(adminOverrideLabel(target))}\n` +
    `Stripe: ${esc(String(subscription?.status || "inactive").toUpperCase())}`;
  const markup = {
    inline_keyboard: [
      [
        button("7 Tage", `admin:set:${userId}:7d`),
        button("30 Tage", `admin:set:${userId}:30d`),
      ],
      [
        button("3 Monate", `admin:set:${userId}:3m`),
        button("♾ Lebenslang", `admin:set:${userId}:life`),
      ],
      [button("Free setzen", `admin:set:${userId}:free`)],
      [button("← Nutzer", "admin:list")],
    ],
  };
  return edit(chatId, messageId, text, markup);
}

async function setPlanOverride(userId: string, grant: AdminGrant) {
  const plan = grant === "free" ? "free" : "premium";
  const expiresAt = adminGrantExpiry(grant);
  const { data: target, error } = await db
    .from("bot_users")
    .update({
      plan_override: plan,
      plan_override_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .eq("is_active", true)
    .select("id,chat_id")
    .maybeSingle();
  if (error) throw error;
  if (!target) throw new Error("user unavailable");

  if (plan === "premium") {
    const { data: profiles, error: profileError } = await db
      .from("search_profiles")
      .select("id")
      .eq("user_id", userId);
    if (profileError) throw profileError;
    const profileIds = (profiles || []).map((profile: any) => profile.id);
    if (profileIds.length) {
      const { error: deliveryError } = await db
        .from("delivery_events")
        .update({ next_retry_at: null })
        .in("profile_id", profileIds)
        .eq("status", "pending");
      if (deliveryError) throw deliveryError;
    }
  }
  return target;
}

async function referralPage(user: any, chatId: number, messageId?: number) {
  let { data: code, error } = await db.from("referral_codes").select("code").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!code) {
    const value = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
    const result = await db.from("referral_codes").insert({ user_id: user.id, code: value }).select("code").single();
    if (result.error) throw result.error;
    code = result.data;
  }
  const { count, error: countError } = await db.from("referrals").select("id", { count: "exact", head: true }).eq("referrer_user_id", user.id).eq("status", "rewarded");
  if (countError) throw countError;
  const text = `🎁 <b>Freunde empfehlen</b>\n\nEmpfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos 💎\n\nErfolgreiche Empfehlungen: ${count || 0}`;
  const markup = { inline_keyboard: [[button("← Einstellungen", "settings")]] };
  if (messageId) await edit(chatId, messageId, text, markup); else await send(chatId, text, markup);
  return send(chatId, `https://t.me/traumwohnunghamburgbot?start=ref_${code.code}`);
}

async function languagePage(user: any, chatId: number, messageId?: number) {
  const codes = ["de", "en", "ckb", "ku", "prs", "fa", "ru", "tr", "ar"];
  const rows = codes.map((code) => [button(`${user.ui_language === code ? "✅ " : ""}${LANGS[code]}`, `lang:${code}`)]);
  rows.push([button("← Einstellungen", "settings")]);
  const markup = { inline_keyboard: rows };
  const text = "🌐 <b>Sprachen</b>\n\nWähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.";
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

async function settings(user: any, chatId: number, messageId?: number) {
  const text = "⚙️ <b>Einstellungen</b>\n\nVerwalte hier deine Suche, Premium, Sprache und Empfehlungen.";
  const markup = { inline_keyboard: [
    [button("💎 Premium", "premium"), button("🎁 Freunde empfehlen", "referral")],
    [button("🌐 Sprachen", "language"), button("📡 Systemstatus", "status")],
    [button("← Zurück", "home")],
  ]};
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

async function handleMessage(message: any, user: any) {
  const chatId = Number(message.chat.id);
  const text = String(message.text || "").trim();
  const [rawCommand, argument = ""] = text.split(/\s+/, 2);
  const command = rawCommand
    .toLowerCase()
    .replace(/@traumwohnunghamburgbot$/i, "");

  if (command === "/admin") {
    if (!isAdmin(user)) return;
    return adminUsers(user, chatId);
  }

  if (command === "/start") {
    if (argument.startsWith("ref_")) {
      const { data: referralResult, error } = await db.rpc("redeem_referral_code", { p_referred_user_id: user.id, p_code: argument.slice(4) });
      if (error) console.error("referral", error.message);
      else if (referralResult?.status === "granted" && referralResult?.referrer_user_id) {
        const referrerId = String(referralResult.referrer_user_id);
        const { data: referrer } = await db.from("bot_users").select("referral_bonus_until,referral_bonus_days").eq("id", referrerId).maybeSingle();
        const base = Math.max(Date.now(), referrer?.referral_bonus_until ? new Date(referrer.referral_bonus_until).getTime() : 0);
        await db.from("bot_users").update({ referral_bonus_until: new Date(base + 7 * 86400000).toISOString(), referral_bonus_days: Number(referrer?.referral_bonus_days || 0) + 7, updated_at: new Date().toISOString() }).eq("id", referrerId);
      }
    }
    telegram("setChatMenuButton", {
      chat_id: chatId,
      menu_button: { type: "commands" },
    }).catch(() => {});
    return home(user, chatId);
  }

  if (command === "/suche") return startNewProfile(user, chatId);
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
    if (draft.profile_edit) {
      const slot = draft.profile_slot;
      delete draft.profile_edit;
      delete draft.edit_return;
      await persistProfile(user, draft);
      return profile(user, chatId, undefined, slot);
    }
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

  if (data.startsWith("admin:")) {
  if (!isAdmin(user)) return acknowledge(query.id);
  if (data === "admin:list") {
    await acknowledge(query.id);
    return adminUsers(user, chatId, messageId);
  }
  if (data.startsWith("admin:user:")) {
    await acknowledge(query.id);
    return adminUser(
      user,
      chatId,
      messageId,
      data.slice("admin:user:".length),
    );
  }
  if (data.startsWith("admin:set:")) {
    const parts = data.split(":");
    const userId = parts[2];
    const grant = parts[3] as AdminGrant;
    if (!userId || !["free", "7d", "30d", "3m", "life"].includes(grant)) {
      return acknowledge(query.id);
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
    await acknowledge(
      query.id,
      grant === "free"
        ? "Free gesetzt"
        : noticeFailed
        ? "Premium gesetzt · Nachricht fehlgeschlagen"
        : `${adminGrantLabel(grant)} Premium gesetzt`,
    );
    return adminUser(user, chatId, messageId, userId);
  }
  return acknowledge(query.id);
}

  if (data.startsWith("save:")) {
    const savedState = await toggleSave(user, data.slice(5));
    if (savedState === null) {
      await acknowledge(query.id);
      return premium(user, chatId, messageId);
    }
    return acknowledge(query.id, savedState ? "⭐️ Gespeichert" : "Entfernt");
  }

  await acknowledge(query.id);

  if (data === "noop") return;
  if (data === "cancel") {
    await saveState(user.id, null, {});
    return home({ ...user, onboarding_step: null, onboarding_state: {} }, chatId, messageId);
  }
  if (data === "home") {
    if (query.message?.photo) { await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {}); return home(user, chatId); }
    return home(user, chatId, messageId);
  }
  if (data === "new") return startNewProfile(user, chatId, messageId);
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
  if (data === "profile" || data === "profiles") return profile(user, chatId, messageId);
  if (data === "p:view:1") return profile(user, chatId, messageId, 1);
  if (data.startsWith("profile:view:")) return profile(user, chatId, messageId, Number(data.split(":")[2]));
  if (data.startsWith("profile:edit-field:")) {
    const parts = data.split(":");
    const slot = Number(parts[2]);
    const field = parts[3];
    if (!Number.isInteger(slot) || slot < 1 || slot > profileLimit(user)) return;
    const { data: current, error } = await db
      .from("search_profiles")
      .select("*")
      .eq("user_id", user.id)
      .eq("profile_slot", slot)
      .maybeSingle();
    if (error) throw error;
    if (!current) return profile(user, chatId, messageId);
    const draft = await draftFromProfile(current);
    if (field === "types") return renderTypes(user, chatId, messageId, draft);
    if (field === "location") return renderLocation(user, chatId, messageId, draft);
    if (field === "rent") return renderRent(user, chatId, messageId, draft);
    if (field === "rooms") return renderRooms(user, chatId, messageId, draft);
    if (field === "area") return renderArea(user, chatId, messageId, draft);
    return profileEditMenu(user, chatId, messageId, slot);
  }
  if (data.startsWith("profile:edit:")) {
    return profileEditMenu(user, chatId, messageId, Number(data.split(":")[2]));
  }
  if (data.startsWith("profile:delete-confirm:")) {
    const slot = Number(data.split(":")[2]);
    if (!Number.isInteger(slot) || slot < 1 || slot > profileLimit(user)) return;
    const { error } = await db
      .from("search_profiles")
      .delete()
      .eq("user_id", user.id)
      .eq("profile_slot", slot);
    if (error) throw error;
    return profile(user, chatId, messageId);
  }
  if (data.startsWith("profile:delete:")) {
    const slot = Number(data.split(":")[2]);
    if (!Number.isInteger(slot) || slot < 1 || slot > profileLimit(user)) return;
    return edit(
      chatId,
      messageId,
      "🗑 <b>Suchprofil löschen?</b>\n\nDiese Aktion kann nicht rückgängig gemacht werden.",
      { inline_keyboard: [
        [button("🗑 Ja, löschen", `profile:delete-confirm:${slot}`)],
        [button("← Abbrechen", `profile:view:${slot}`)],
      ] },
    );
  }
  if (data.startsWith("profile:pause:") || data.startsWith("profile:resume:")) {
    const slot = Number(data.split(":")[2]);
    await setPaused(user.id, data.startsWith("profile:pause:"), slot);
    return profile(user, chatId, messageId, slot);
  }
  if (data === "saved") return saved(user, chatId, messageId, 0);
  if (data.startsWith("saved:")) {
    return saved(user, chatId, messageId, Number(data.slice(6)) || 0);
  }
  if (data === "settings") return settings(user, chatId, messageId);
  if (data === "referral") return referralPage(user, chatId, messageId);
  if (data === "language") return languagePage(user, chatId, messageId);
  if (data.startsWith("lang:")) {
    const code = data.slice(5);
    if (!["de","en","ckb","ku","prs","fa","ru","tr","ar"].includes(code)) return;
    const { error } = await db.from("bot_users").update({ ui_language: code, updated_at: new Date().toISOString() }).eq("id", user.id);
    if (error) throw error;
    chatLanguages.set(chatId, code);
    return settings({ ...user, ui_language: code }, chatId, messageId);
  }
  if (data === "help") {
    return edit(chatId, messageId, HELP_TEXT, {
      inline_keyboard: [[button("← Zurück", "home")]],
    });
  }
  if (data === "premium") return premium(user, chatId, messageId);
  if (data === "portal") {
    if (query.message?.photo) await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {});
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
      return afterSelection(user, chatId, messageId, draft, "review");
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
    if (request.method === "GET" || request.method === "HEAD") {
      const url = new URL(request.url);
      if (url.searchParams.get("asset") === "premium") {
        const raw = atob(PREMIUM_PREVIEW_B64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return new Response(request.method === "HEAD" ? null : bytes, {
          headers: {
            "content-type": "image/jpeg",
            "cache-control": "public, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
          },
        });
      }
    }
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
    chatLanguages.set(Number(chatId), String(user.ui_language || "de"));
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
