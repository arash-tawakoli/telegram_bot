const SOURCES = new Map([
  [1, "ImmoScout24 Hamburg"], [3, "Immowelt Hamburg"], [23, "Hamburger Wohnen"],
  [29, "VHW"], [34, "Bauverein Reiherstieg"], [35, "Walddörfer"],
  [37, "Finkenwärder-Hoffnung"], [66, "GEWOBA Nord"], [69, "ImmoScout24 Schleswig-Holstein"],
  [71, "Immowelt Schleswig-Holstein"],
]);
const PROVIDERS = new Set(["immoscout24", "immowelt", "immomio"]);

const clean = (value, max = 500) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const esc = (value) => clean(value, 500).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (value) => value == null || value === "" ? "–" : `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(Number(value))} €`;

function buttons(rows) {
  return { inline_keyboard: rows.map((row) => row.map(([text, callback_data]) => ({ text, callback_data }))) };
}

async function telegram(env, method, body) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "");
  if (!token) throw new Error("telegram_token_missing");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) throw new Error(String(data?.description || `telegram_${response.status}`));
  return data.result;
}

async function answer(env, callbackId) {
  if (!callbackId) return;
  await telegram(env, "answerCallbackQuery", { callback_query_id: callbackId }).catch(() => {});
}

async function send(env, chatId, text, reply_markup = undefined) {
  return telegram(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(reply_markup ? { reply_markup } : {}),
  });
}

function nameFromTelegram(from) {
  return {
    first_name: clean(from?.first_name, 120) || "Teilnehmer",
    last_name: clean(from?.last_name, 120) || "Unbekannt",
  };
}

async function participant(sql, from, chatId) {
  const telegramId = Number(from?.id);
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0 || !Number.isSafeInteger(Number(chatId))) throw new Error("telegram_identity_invalid");
  const existing = await sql`SELECT * FROM housing.participants WHERE telegram_user_id = ${telegramId} LIMIT 1`;
  if (existing[0]) {
    await sql`UPDATE housing.participants SET telegram_chat_id = ${Number(chatId)}, updated_at = now() WHERE id = ${existing[0].id}`;
    return existing[0];
  }
  const names = nameFromTelegram(from);
  const id = crypto.randomUUID();
  const rows = await sql`
    INSERT INTO housing.participants (id, first_name, last_name, telegram_user_id, telegram_chat_id)
    VALUES (${id}, ${names.first_name}, ${names.last_name}, ${telegramId}, ${Number(chatId)})
    RETURNING *
  `;
  await sql`INSERT INTO housing.application_preferences (participant_id) VALUES (${id}) ON CONFLICT DO NOTHING`;
  return rows[0];
}

function menu() {
  return buttons([
    [["🔎 Suchprofil", "housing:search"], ["👤 Bewerberprofil", "housing:profile"]],
    [["🏠 Angebote", "housing:offers"], ["📨 Bewerbungen", "housing:applications"]],
    [["📄 Unterlagen im Portal", "housing:documents"]],
  ]);
}

async function setState(sql, id, state) {
  await sql`UPDATE housing.participants SET telegram_state = ${JSON.stringify(state || {})}::jsonb, updated_at = now() WHERE id = ${id}`;
}

async function profileView(sql, participantRow) {
  const rows = await sql`SELECT profile FROM housing.applicant_profiles WHERE participant_id = ${participantRow.id}`;
  const profile = rows[0]?.profile || {};
  const name = [participantRow.first_name, participantRow.last_name].filter(Boolean).join(" ");
  return [
    `<b>Bewerberprofil</b>`,
    `Name: ${esc(name)}`,
    `E-Mail: ${esc(participantRow.email || profile.email || "–")}`,
    `Telefon: ${esc(profile.phone || "–")}`,
    `Ort: ${esc(profile.city || "–")} ${esc(profile.postcode || "")}`,
    `Weitere Angaben: ${Object.keys(profile).filter((key) => !["email", "phone", "city", "postcode"].includes(key)).length ? "vorhanden" : "–"}`,
  ].join("\n");
}

async function searchView(sql, participantRow) {
  const rows = await sql`
    SELECT sp.id, sp.criteria, sp.active,
      COALESCE(array_agg(sl.source_id ORDER BY sl.source_id) FILTER (WHERE sl.source_id IS NOT NULL), '{}') AS source_ids
    FROM housing.search_profiles sp
    LEFT JOIN housing.source_links sl ON sl.search_profile_id = sp.id
    WHERE sp.participant_id = ${participantRow.id}
    GROUP BY sp.id
    ORDER BY sp.created_at
  `;
  if (!rows.length) return "<b>Suchprofil</b>\nNoch kein Suchprofil vorhanden.";
  return ["<b>Suchprofil</b>", ...rows.map((row, i) => {
    const criteria = row.criteria || {};
    const sourceNames = (row.source_ids || []).map((id) => SOURCES.get(Number(id)) || `Quelle ${id}`).join(", ");
    return `${i + 1}. ${row.active ? "aktiv" : "pausiert"} · ${esc(criteria.city || criteria.location || "Hamburg")} · bis ${money(criteria.max_rent || criteria.maxRent)}\nQuellen: ${esc(sourceNames || "keine")}`;
  })].join("\n");
}

function parseSearchText(value) {
  const criteria = {};
  const sourceIds = [];
  for (const part of String(value || "").split(/[;\n]+/)) {
    const [rawKey, ...rest] = part.split("=");
    const key = clean(rawKey, 50).toLowerCase();
    const raw = clean(rest.join("="), 180);
    if (!key || !raw) continue;
    if (["quellen", "sources", "source_ids"].includes(key)) {
      for (const id of raw.split(/[, ]+/).map(Number).filter((id) => SOURCES.has(id))) if (!sourceIds.includes(id)) sourceIds.push(id);
    } else if (["max_rent", "max_miete", "maxmiete", "miete", "max_rent_eur"].includes(key)) {
      const numeric = raw.replace(/[^0-9,.-]/g, "");
      const normalized = numeric.includes(",") ? numeric.replace(/\./g, "").replace(",", ".") : numeric.replace(/\.(?=\d{3}(?:$|[^0-9]))/g, "");
      const amount = Number(normalized);
      if (Number.isFinite(amount) && amount >= 0 && amount <= 100_000) criteria.max_rent = amount;
    } else if (["rooms", "zimmer"].includes(key)) {
      const rooms = Number(raw.replace(",", ".").replace(/[^0-9.]/g, ""));
      if (Number.isFinite(rooms) && rooms > 0 && rooms <= 20) criteria.rooms = rooms;
    } else if (["area", "flaeche", "fläche"].includes(key)) {
      const area = Number(raw.replace(",", ".").replace(/[^0-9.]/g, ""));
      if (Number.isFinite(area) && area > 0 && area <= 1000) criteria.area_sqm = area;
    } else if (["city", "stadt", "ort", "location"].includes(key)) criteria.city = raw;
    else criteria[key] = raw;
  }
  return { criteria, sourceIds: sourceIds.length ? sourceIds : [1, 3, 23, 29, 34, 35, 37, 66, 69, 71] };
}

async function saveSearch(sql, participantRow, value) {
  const { criteria, sourceIds } = parseSearchText(value);
  const id = crypto.randomUUID();
  await sql.begin(async (tx) => {
    await tx`INSERT INTO housing.search_profiles (id, participant_id, criteria, active) VALUES (${id}, ${participantRow.id}, ${JSON.stringify(criteria)}::jsonb, true)`;
    for (const sourceId of sourceIds) await tx`INSERT INTO housing.source_links (search_profile_id, source_id) VALUES (${id}, ${sourceId}) ON CONFLICT DO NOTHING`;
  });
  return { criteria, sourceIds };
}

function offerText(row) {
  const facts = row.facts || {};
  const title = facts.title || "Wohnungsangebot";
  const rent = facts.warm_rent ?? facts.cold_rent;
  const details = [facts.city || facts.district || facts.address, rent != null ? money(rent) : null, facts.rooms ? `${facts.rooms} Zi.` : null, facts.area_sqm ? `${facts.area_sqm} m²` : null].filter(Boolean).join(" · ");
  return `<b>${esc(title)}</b>\n${esc(details)}\n${esc(row.source_name || "Quelle")}\n<a href="${esc(row.canonical_url)}">Angebot öffnen</a>`;
}

async function offersView(sql, participantRow) {
  const rows = await sql`
    SELECT d.id, oi.id AS offer_id, oi.facts, oi.canonical_url, sr.name AS source_name
    FROM housing.deliveries d
    JOIN housing.offer_identities oi ON oi.id = d.offer_identity_id
    JOIN housing.source_registry sr ON sr.id = oi.source_id
    WHERE d.participant_id = ${participantRow.id} AND d.status IN ('sent', 'pending')
    ORDER BY d.created_at DESC LIMIT 8
  `;
  if (!rows.length) return { text: "<b>Angebote</b>\nNoch keine passenden Angebote.", markup: menu() };
  const markup = buttons([
    ...rows.map((row, index) => [[`Bewerben ${index + 1}`, `housing:apply:${row.offer_id}`]]),
    [["← Menü", "housing:menu"]],
  ]);
  return { text: `<b>Angebote</b>\n\n${rows.map(offerText).join("\n\n")}`, markup };
}

async function applicationsView(sql, participantRow) {
  const rows = await sql`
    SELECT a.status, a.provider, a.created_at, oi.canonical_url, oi.facts
    FROM housing.applications a
    LEFT JOIN housing.offer_identities oi ON oi.id = a.offer_identity_id
    WHERE a.participant_id = ${participantRow.id}
    ORDER BY a.created_at DESC LIMIT 8
  `;
  if (!rows.length) return "<b>Bewerbungen</b>\nNoch keine Bewerbung angelegt.";
  return `<b>Bewerbungen</b>\n\n${rows.map((row) => `${esc(row.provider)} · ${esc(row.status)}\n${esc(row.facts?.title || row.canonical_url || "Angebot")}`).join("\n\n")}`;
}

async function createApplication(sql, participantRow, offerId) {
  const rows = await sql`
    SELECT oi.id, oi.source_id, sr.family
    FROM housing.offer_identities oi JOIN housing.source_registry sr ON sr.id = oi.source_id
    WHERE oi.id = ${offerId}
  `;
  const offer = rows[0];
  if (!offer || !PROVIDERS.has(offer.family)) throw new Error("offer_not_found");
  const key = `${participantRow.id}:${offer.family}:${offer.id}`;
  const inserted = await sql`
    INSERT INTO housing.applications (id, participant_id, offer_identity_id, provider, idempotency_key, status)
    VALUES (${crypto.randomUUID()}, ${participantRow.id}, ${offer.id}, ${offer.family}, ${key}, 'pending')
    ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
  `;
  if (inserted[0]) await sql`INSERT INTO housing.jobs (id, kind, payload, status) VALUES (${crypto.randomUUID()}, 'application', ${JSON.stringify({ application_id: inserted[0].id })}::jsonb, 'queued')`;
  return Boolean(inserted[0]);
}

async function handleText(sql, env, participantRow, message) {
  const text = clean(message?.text, 1000);
  const state = participantRow.telegram_state || {};
  if (state.kind === "profile") {
    const profile = (await sql`SELECT profile FROM housing.applicant_profiles WHERE participant_id = ${participantRow.id}`)[0]?.profile || {};
    profile[state.field] = text;
    await sql`
      INSERT INTO housing.applicant_profiles (participant_id, profile) VALUES (${participantRow.id}, ${JSON.stringify(profile)}::jsonb)
      ON CONFLICT (participant_id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = now()
    `;
    await setState(sql, participantRow.id, {});
    await send(env, participantRow.telegram_chat_id, "Gespeichert.", menu());
    return;
  }
  if (state.kind === "search") {
    const saved = await saveSearch(sql, participantRow, text);
    await setState(sql, participantRow.id, {});
    await send(env, participantRow.telegram_chat_id, `Suchprofil gespeichert.\nQuellen: ${saved.sourceIds.map((id) => SOURCES.get(id)).join(", ")}`, menu());
    return;
  }
  if (/^\/(start|menu|hilfe)(?:@\w+)?$/i.test(text) || !text) {
    await send(env, participantRow.telegram_chat_id, "<b>TraumWohnungHamburg</b>\nWohnungssuche, Suchprofil und Bewerbungen", menu());
    return;
  }
  await send(env, participantRow.telegram_chat_id, "Nutze /menu oder wähle eine Funktion:", menu());
}

async function handleCallback(sql, env, participantRow, callback) {
  const data = String(callback?.data || "");
  await answer(env, callback?.id);
  if (data === "housing:menu") return send(env, participantRow.telegram_chat_id, "<b>TraumWohnungHamburg</b>", menu());
  if (data === "housing:profile") return send(env, participantRow.telegram_chat_id, await profileView(sql, participantRow), buttons([[ ["E-Mail ändern", "housing:profile:email"], ["Telefon ändern", "housing:profile:phone"] ], [["Ort ändern", "housing:profile:city"], ["← Menü", "housing:menu"]]]));
  if (data.startsWith("housing:profile:")) {
    const field = data.split(":")[2];
    if (!["email", "phone", "city", "postcode", "street"].includes(field)) throw new Error("profile_field_invalid");
    await setState(sql, participantRow.id, { kind: "profile", field });
    return send(env, participantRow.telegram_chat_id, `Bitte sende ${field === "email" ? "die E-Mail-Adresse" : field === "phone" ? "die Telefonnummer" : "den Wert"}.`);
  }
  if (data === "housing:search") return send(env, participantRow.telegram_chat_id, `${await searchView(sql, participantRow)}\n\nBeispiel: <code>stadt=Hamburg;max_miete=1200;zimmer=2;quellen=1,3,23</code>`, buttons([[ ["Neues Suchprofil", "housing:search:new"] ], [["← Menü", "housing:menu"]]]));
  if (data === "housing:search:new") {
    await setState(sql, participantRow.id, { kind: "search" });
    return send(env, participantRow.telegram_chat_id, "Sende dein Suchprofil als Zeile, z. B.\n<code>stadt=Hamburg;max_miete=1200;zimmer=2;quellen=1,3,23</code>");
  }
  if (data === "housing:offers") { const view = await offersView(sql, participantRow); return send(env, participantRow.telegram_chat_id, view.text, view.markup); }
  if (data === "housing:applications") return send(env, participantRow.telegram_chat_id, await applicationsView(sql, participantRow), menu());
  if (data === "housing:documents") return send(env, participantRow.telegram_chat_id, "Unterlagen verwaltest du im internen Portal. Öffne dort den Teilnehmer und lade die Dokumente hoch.", menu());
  if (data.startsWith("housing:apply:")) {
    const created = await createApplication(sql, participantRow, data.slice("housing:apply:".length));
    return send(env, participantRow.telegram_chat_id, created ? "Bewerbung vorgemerkt. Sie wird vor dem Versand geprüft." : "Dieses Angebot ist bereits vorgemerkt.", menu());
  }
  return send(env, participantRow.telegram_chat_id, "Funktion nicht gefunden.", menu());
}

export async function handleTelegramHousingUpdate(sql, env, update) {
  const message = update?.message;
  const callback = update?.callback_query;
  const from = callback?.from || message?.from;
  const chatId = callback?.message?.chat?.id || message?.chat?.id;
  if (!from?.id || !chatId) return { ignored: true };
  const row = await participant(sql, from, chatId);
  if (callback) await handleCallback(sql, env, row, callback);
  else if (message?.chat?.type === "private") await handleText(sql, env, row, message);
  return { ok: true, participant_id: row.id };
}

export { parseSearchText, offerText };
