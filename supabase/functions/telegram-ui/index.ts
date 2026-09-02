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

function premiumPreviewUrl() {
  return `${SUPABASE_URL}/functions/v1/telegram-ui?asset=premium&v=20260903b`;
}

async function sendPremiumPreview(chatId: number, caption: string, replyMarkup: any) {
  const language = chatLanguages.get(chatId);
  return telegram("sendPhoto", {
    chat_id: chatId,
    photo: premiumPreviewUrl(),
    caption: localizeText(caption, language),
    parse_mode: "HTML",
    reply_markup: localizeMarkup(replyMarkup, language),
  });
}

async function editPremiumPreview(chatId: number, messageId: number, caption: string, replyMarkup: any) {
  const language = chatLanguages.get(chatId);
  return telegram("editMessageMedia", {
    chat_id: chatId,
    message_id: messageId,
    media: {
      type: "photo",
      media: premiumPreviewUrl(),
      caption: localizeText(caption, language),
      parse_mode: "HTML",
    },
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

async function premium(user: any, chatId: number, messageId?: number, messageHasPhoto = false) {
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
  const markup = { inline_keyboard: rows };
  if (messageId && messageHasPhoto) return editPremiumPreview(chatId, messageId, text, markup);
  return sendPremiumPreview(chatId, text, markup);
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
  if (data === "premium") {
  if (query.message?.photo) return premium(user, chatId, messageId, true);
  await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {});
  return premium(user, chatId);
}
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
