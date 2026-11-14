/**
 * Telegram listing cards use one photo, one caption and the three familiar
 * inline actions. Text/link-preview delivery is intentionally not a fallback.
 */
const IMAGE_HOSTS = new Set([
  "pictures.immobilienscout24.de", "mms.immowelt.de", "s3.eu-central-1.amazonaws.com",
]);

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function asNumber(value) {
  if (value == null || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function present(value) {
  return value != null && String(value).trim() !== "";
}

function euros(value) {
  const amount = asNumber(value);
  return amount == null ? null : new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(amount) + " €";
}

function quantity(value) {
  const n = asNumber(value);
  return n == null ? null : new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(n);
}

function safeUrl(raw, hostnames) {
  try {
    const url = new URL(String(raw || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (hostnames && !hostnames.has(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function listingImageUrl(raw) {
  return safeUrl(raw, IMAGE_HOSTS);
}

/** Immowelt sometimes omits a picture in its search card but publishes an OG image. */
export async function resolveListingImage(facts, listingUrl, sourceId, request = fetch) {
  const existing = listingImageUrl(facts?.image_url);
  if (existing) return existing;
  if (Number(sourceId) !== 3) return null;
  const expose = safeUrl(listingUrl, new Set(["www.immowelt.de"]));
  if (!expose || !new URL(expose).pathname.startsWith("/expose/")) return null;
  try {
    const response = await request(expose, {
      headers: { accept: "text/html", "user-agent": "TraumWohnungHamburg/1.0" },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok || Number(response.headers.get("content-length") || 0) > 2_000_000) return null;
    const html = (await response.text()).slice(0, 2_000_000);
    for (const tag of html.match(/<meta\b[^>]+>/gi) || []) {
      if (!/\b(?:property|name)=["'](?:og:image|twitter:image)["']/i.test(tag)) continue;
      const candidate = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/gi, "&");
      const image = listingImageUrl(candidate);
      if (image) return image;
    }
  } catch {
    // Inability to verify a genuine listing photograph must not produce a text preview.
  }
  return null;
}

export function listingCaption(facts) {
  const title = String(facts?.title || "Wohnung zur Miete").trim().slice(0, 170);
  const lines = ["🏠 <b>" + escapeHtml(title) + "</b>", ""];
  const row = (icon, label, value) => {
    if (present(value)) lines.push(icon + " <b>" + label + ":</b> " + escapeHtml(value));
  };
  row("💶", "Warmmiete", euros(facts?.warm_rent));
  row("❄️", "Kaltmiete", euros(facts?.cold_rent));
  row("🧾", "Nebenkosten", euros(facts?.additional_costs));
  row("🔥", "Heizkosten", euros(facts?.heating_costs));
  row("🚪", "Zimmer", quantity(facts?.rooms));
  row("📐", "Wohnfläche", quantity(facts?.area_sqm) == null ? null : quantity(facts.area_sqm) + " m²");
  row("🛗", "Etage", facts?.floor);
  row("🏘️", "Wohnungstyp", facts?.property_type);
  row("🧭", "Bezirk", facts?.borough);
  row("🌇", "Stadtteil", facts?.district);
  const address = [
    facts?.address,
    [facts?.postal_code, facts?.city].filter(present).join(" "),
  ].filter(present).join(", ");
  row("📍", "Adresse", address || facts?.city);
  // Telegram limits photo captions to 1,024 characters after entity parsing.
  while (lines.join("\n").length > 950 && lines.length > 3) lines.pop();
  return lines.join("\n").trim();
}

function sourceLabel(sourceId, sourceName) {
  if ([1, 69].includes(Number(sourceId))) return "ImmoScout24";
  if (Number(sourceId) === 3) return "Immowelt";
  return String(sourceName || "Angebot").replace(/\s+Hamburg$/i, "").trim().slice(0, 40) || "Angebot";
}

export function listingKeyboard(facts, listingUrl, sourceId, sourceName) {
  const destination = safeUrl(listingUrl);
  if (!destination) throw new Error("listing_destination_invalid");
  const location = (asNumber(facts?.latitude) != null && asNumber(facts?.longitude) != null)
    ? String(facts.latitude) + "," + String(facts.longitude)
    : [facts?.address, facts?.postal_code, facts?.district, facts?.city].filter(present).join(", ")
      || ([1, 3].includes(Number(sourceId)) ? "Hamburg" : "Schleswig-Holstein");
  return { inline_keyboard: [
    [{ text: "Zu " + sourceLabel(sourceId, sourceName), url: destination }],
    [{ text: "⭐ Speichern", url: "https://t.me/share/url?url=" + encodeURIComponent(destination) }],
    [{ text: "🗺️ Google Map", url: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(location) }],
  ] };
}

export function listingPhotoRequest(chatId, photo, facts, listingUrl, sourceId, sourceName) {
  if (!listingImageUrl(photo)) throw new Error("listing_photo_missing");
  return {
    chat_id: Number(chatId), photo,
    caption: listingCaption(facts), parse_mode: "HTML",
    reply_markup: listingKeyboard(facts, listingUrl, sourceId, sourceName),
  };
}

function unsupportedTelegramPhoto(response, data) {
  if (response.status !== 400) return false;
  const description = String(data?.description || "");
  return /failed to get http url content|wrong (?:file|type)|failed to get file|file.*invalid|photo.*invalid|unsupported image/i.test(description);
}

/** Validate downloaded bytes, not the remote Content-Type or file extension. */
async function uploadBody(photo, payload, request) {
  const response = await request(photo, { headers: { accept: "image/*" }, signal: AbortSignal.timeout(7000) });
  if (!response.ok || Number(response.headers.get("content-length") || 0) > 10_000_000) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 10_000_000) return null;
  const match = (offset, sig) => sig.every((n, i) => bytes[offset + i] === n);
  const mime = match(0, [255, 216, 255]) ? "image/jpeg"
    : match(0, [137, 80, 78, 71, 13, 10, 26, 10]) ? "image/png"
    : match(0, [82, 73, 70, 70]) && match(8, [87, 69, 66, 80]) ? "image/webp" : null;
  if (!mime) return null;
  const form = new FormData();
  form.set("chat_id", String(payload.chat_id));
  form.set("photo", new Blob([bytes], { type: mime }), "wohnung." + mime.split("/")[1]);
  form.set("caption", payload.caption);
  form.set("parse_mode", "HTML");
  form.set("reply_markup", JSON.stringify(payload.reply_markup));
  return form;
}

/**
 * A second Telegram request is allowed only after a definitive 400 image error.
 * Network failures propagate to the caller as unknown outcomes, preventing duplicates.
 */
export async function sendListingPhoto(token, payload, request = fetch) {
  const endpoint = "https://api.telegram.org/bot" + token + "/sendPhoto";
  let response = await request(endpoint, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
  });
  let data = await response.json().catch(() => null);
  if (response.ok && data?.ok === true) return { response, data };
  if (unsupportedTelegramPhoto(response, data)) {
    const form = await uploadBody(payload.photo, payload, request).catch(() => null);
    if (form) {
      response = await request(endpoint, { method: "POST", body: form, signal: AbortSignal.timeout(15000) });
      data = await response.json().catch(() => null);
    }
  }
  return { response, data };
}
