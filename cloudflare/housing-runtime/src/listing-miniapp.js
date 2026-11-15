import { listingCaption, listingHeadline, listingKeyboard, listingImageUrl, resolveListingImage } from "./telegram-listing-preview.js";
const PUBLIC_ORIGIN = "https://traumwohnung-housing-runtime.arash-ce5.workers.dev";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CSS = "\n:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Arial,sans-serif}\n*{box-sizing:border-box}body{margin:0;background:var(--tg-theme-bg-color,#f3f4f6);color:var(--tg-theme-text-color,#1b2330)}\nmain{max-width:640px;margin:0 auto;padding:16px 16px 28px}\narticle{overflow:hidden;border-radius:18px;background:var(--tg-theme-secondary-bg-color,#fff);box-shadow:0 2px 18px #00000016}\nfigure{margin:0;background:#222}figure img{display:block;width:100%;height:auto;max-height:52vh;object-fit:contain}\nsection{padding:22px 18px}h1{font-size:1.25rem;line-height:1.35;margin:0 0 16px}\n.details{white-space:pre-line;line-height:1.65;font-size:1rem;overflow-wrap:anywhere}\na.action{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:12px;margin:9px 0;padding:12px 16px;text-decoration:none;background:var(--tg-theme-button-color,#2389dd);color:var(--tg-theme-button-text-color,#fff);font-weight:600;text-align:center}\na.action.secondary{color:var(--tg-theme-text-color,#1b2330);background:var(--tg-theme-bg-color,#e7ecf3)}\nsmall{display:block;text-align:center;opacity:.72;margin-top:16px}\n@media(prefers-color-scheme:dark){body{background:var(--tg-theme-bg-color,#17202a);color:var(--tg-theme-text-color,#f6f7f9)}article{background:var(--tg-theme-secondary-bg-color,#242f3a)}a.action.secondary{background:var(--tg-theme-bg-color,#17202a);color:var(--tg-theme-text-color,#f6f7f9)}}\n";
const APP_JS = "if (window.Telegram && window.Telegram.WebApp) { window.Telegram.WebApp.ready(); window.Telegram.WebApp.expand(); }";
function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
export function listingWebUrl(id) { if (!UUID.test(String(id))) throw new Error("listing_delivery_id_invalid"); return PUBLIC_ORIGIN + "/angebot/" + String(id).toLowerCase(); }
export function listingMessageRequest(chatId, photo, facts, listingUrl, sourceId, sourceName, deliveryId) {
  if (!listingImageUrl(photo)) throw new Error("listing_photo_missing");
  listingWebUrl(deliveryId); // Retain strict delivery identity validation.
  const buttons = listingKeyboard(facts, listingUrl, sourceId, sourceName).inline_keyboard;
  return {
    chat_id: Number(chatId),
    photo: listingImageUrl(photo),
    caption: listingCaption(facts),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons },
  };
}
/** One native, non-link photo; no gallery and no retry on ambiguous delivery. */
export async function sendListingMessage(token, payload, request = fetch) {
  const endpoint = "https://api.telegram.org/bot" + token + "/sendPhoto";
  const post = body => request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const response = await post(payload);
  const data = await response.json().catch(() => null);
  return { response, data };
}
/** Public listing details only. UUIDs are unguessable; no participant or application fields are rendered. */
export async function listingMiniAppResponse(sql, id) {
  if (!UUID.test(String(id || ""))) return new Response("Nicht gefunden", { status: 404 });
  const rows = await sql`SELECT oi.facts, oi.canonical_url, oi.source_id, s.name AS source_name
    FROM housing.deliveries d
    JOIN housing.offer_identities oi ON oi.id=d.offer_identity_id
    JOIN housing.source_registry s ON s.id=oi.source_id
    WHERE d.id=${id} AND d.status IN ('processing','sent') LIMIT 1`;
  const row = rows[0];
  if (!row) return new Response("Angebot nicht verfügbar", { status: 404, headers: { "cache-control": "no-store" } });
  let facts = row.facts;
  if (typeof facts === "string") { try { facts = JSON.parse(facts); } catch { facts = {}; } }
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) facts = {};
  const photo = await resolveListingImage(facts, row.canonical_url, row.source_id);
  if (!photo) return new Response("Angebot nicht verfügbar", { status: 404, headers: { "cache-control": "no-store" } });
  const actions = listingKeyboard(facts, row.canonical_url, row.source_id, row.source_name).inline_keyboard.map((r, i) =>
    '<a class="action' + (i ? ' secondary' : '') + '" href="' + escapeHtml(r[0].url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(r[0].text) + '</a>').join("");
  const title = listingHeadline(facts);
  const description = [facts.city, facts.district, facts.rooms != null ? String(facts.rooms) + " Zimmer" : "",
    facts.area_sqm != null ? String(facts.area_sqm) + " m²" : ""].filter(Boolean).join(" · ").slice(0, 220);
  const nonce = crypto.randomUUID();
  const page = [
    '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    '<meta name="robots" content="noindex,nofollow,noarchive">',
    '<meta property="og:type" content="website"><meta property="og:site_name" content="Traumwohnung Hamburg">',
    '<meta property="og:title" content="' + escapeHtml(title) + '">',
    '<meta property="og:description" content="' + escapeHtml(description) + '">',
    '<meta property="og:image" content="' + escapeHtml(photo) + '">',
    '<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#152433">',
    '<title>' + escapeHtml(title) + ' · Traumwohnung Hamburg</title>',
    '<style nonce="' + nonce + '">' + CSS + '</style>',
    '<script src="https://telegram.org/js/telegram-web-app.js?65"></script>',
    '</head><body><main><article><figure><img src="' + escapeHtml(photo) + '" alt="Foto des Wohnungsangebots" loading="eager"></figure>',
    '<section><div class="details">' + listingCaption(facts) + '</div><nav aria-label="Angebotsaktionen">' + actions + '</nav></section>',
    '</article><small>Einzelansicht · keine Galerie mit anderen Wohnungen</small></main>',
    '<script nonce="' + nonce + '">' + APP_JS + '</script></body></html>',
  ].join("");
  const csp = "default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'; " +
    "img-src https://pictures.immobilienscout24.de https://mms.immowelt.de https://s3.eu-central-1.amazonaws.com; " +
    "style-src 'nonce-" + nonce + "'; script-src 'nonce-" + nonce + "' https://telegram.org";
  return new Response(page, { status: 200, headers: { "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow",
    "x-content-type-options": "nosniff", "content-security-policy": csp } });
}
