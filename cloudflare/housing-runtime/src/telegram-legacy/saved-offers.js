import { createD1Client } from "../d1-database.js";
import { listingHeadline } from "../telegram-listing-preview.js";
import { runtimeEnv, button, esc, short, send, edit } from "./runtime.js";

const DELIVERY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 6;

function sql() {
  const database = runtimeEnv()?.HOUSING_DB;
  if (!database?.prepare) throw new Error("saved_offers_database_unavailable");
  return createD1Client(database);
}

function safeUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : null;
  } catch {
    return null;
  }
}

function factsObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const decoded = JSON.parse(String(value || "{}"));
    return decoded && typeof decoded === "object" && !Array.isArray(decoded) ? decoded : {};
  } catch {
    return {};
  }
}

/** Accept only an actually delivered offer belonging to this Telegram participant. */
export async function saveDeliveredOffer(user, deliveryId) {
  if (!DELIVERY_ID.test(String(deliveryId || ""))) return false;
  const query = sql();
  const rows = await query`
    SELECT d.offer_identity_id, oi.canonical_url, oi.facts, s.name AS source_name
    FROM deliveries d
    JOIN offer_identities oi ON oi.id = d.offer_identity_id
    JOIN source_registry s ON s.id = oi.source_id
    WHERE d.id = ${deliveryId} AND d.participant_id = ${user.id}
      AND d.status = 'sent'
    LIMIT 1
  `;
  const offer = rows[0];
  const destination = safeUrl(offer?.canonical_url);
  if (!offer?.offer_identity_id || !destination) return false;
  const facts = factsObject(offer.facts);
  const title = listingHeadline(facts).slice(0, 170);
  const sourceName = String(offer.source_name || "Angebot").slice(0, 70);
  await query`
    INSERT OR IGNORE INTO saved_offers
      (participant_id, offer_identity_id, canonical_url, title, source_name, facts)
    VALUES (${user.id}, ${offer.offer_identity_id}, ${destination},
      ${title}, ${sourceName}, ${JSON.stringify(facts).slice(0, 15000)})
  `;
  return true;
}

export async function removeSavedOffer(user, savedId) {
  const id = Number(savedId);
  if (!Number.isSafeInteger(id) || id < 1) return false;
  const query = sql();
  const result = await query`DELETE FROM saved_offers WHERE id = ${id} AND participant_id = ${user.id}`;
  return result.count > 0;
}

export async function savedOffers(user, chatId, messageId, requestedPage = 0) {
  const query = sql();
  const requested = Number(requestedPage);
  const page = Number.isSafeInteger(requested) ? Math.min(Math.max(requested, 0), 10000) : 0;
  const totals = await query`SELECT COUNT(*) AS total FROM saved_offers WHERE participant_id = ${user.id}`;
  const total = Number(totals[0]?.total || 0);
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const current = Math.min(page, maxPage);
  const items = await query`
    SELECT id, canonical_url, title, source_name, facts
    FROM saved_offers WHERE participant_id = ${user.id}
    ORDER BY saved_at DESC, id DESC
    LIMIT ${PAGE_SIZE} OFFSET ${current * PAGE_SIZE}
  `;
  let text = "⭐ <b>Gespeicherte Inserate</b>\n\n";
  const rows = [];
  if (!items.length) text += "Du hast noch keine Angebote gespeichert.";
  for (const [index, item] of items.entries()) {
    const facts = factsObject(item.facts);
    const price = Number(facts.warm_rent);
    const displayPrice = Number.isFinite(price) && price > 0
      ? " · " + new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(price) + " €" : "";
    text += `${current * PAGE_SIZE + index + 1}. <b>${esc(short(item.title, 75))}</b>\n${esc(item.source_name)}${displayPrice}\n\n`;
    const destination = safeUrl(item.canonical_url);
    rows.push([
      ...(destination ? [{ text: "🔗 Angebot öffnen", url: destination }] : []),
      button("🗑 Entfernen", "saved:delete:" + item.id),
    ]);
  }
  if (total > PAGE_SIZE) {
    const nav = [];
    if (current > 0) nav.push(button("← Vorherige", "saved:list:" + (current - 1)));
    if (current < maxPage) nav.push(button("Nächste →", "saved:list:" + (current + 1)));
    rows.push(nav);
    text += `Seite ${current + 1} von ${maxPage + 1}\n`;
  }
  rows.push([button("← Start", "home")]);
  const markup = { inline_keyboard: rows };
  return messageId ? edit(chatId, messageId, text.trim(), markup) : send(chatId, text.trim(), markup);
}
