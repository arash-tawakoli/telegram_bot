/** Shared listing facts and action links for isolated Telegram Mini App cards. */
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
  // Keep previews compact while preserving the available property facts.
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
