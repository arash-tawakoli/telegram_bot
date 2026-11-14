import { queueMatches } from "./matching.js";

function absolute(base, href) {
  try { return new URL(href, base).href.split("#")[0]; } catch { return null; }
}

function strip(value) {
  return String(value || "").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;|&#x0*a0;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function number(text, pattern) {
  const value = String(text || "").match(pattern)?.[1];
  if (!value) return null;
  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(?:\.\d{3})+$/.test(value) ? value.replace(/\./g, "") : value.replace(/\s/g, "");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}


function listingPhoto(chunk, base) {
  // Search-result photos are served by mms.immowelt.de; provider logos use
  // much smaller sizes and must not be selected as listing photographs.
  for (const tag of chunk.match(/<img\b[^>]*>/gi) || []) {
    const src = tag.match(/\b(?:src|data-src)=["']([^"']+)["']/i)?.[1];
    if (!src) continue;
    const image = absolute(base, src.replace(/&amp;/gi, "&"));
    if (!image) continue;
    const url = new URL(image);
    if (url.protocol === "https:" && url.hostname === "mms.immowelt.de"
      && /\.(?:jpe?g|png|webp)$/i.test(url.pathname)
      && (Number(url.searchParams.get("w") || 0) >= 300 || /(?:image|photo|thumbnail)/i.test(tag))) {
      return image;
    }
  }
  return null;
}

function cards(html, base, sourceId) {
  const output = [];
  const seen = new Set();
  const parts = html.split(/<div\s+id=["']classified-card-/i);
  const chunks = parts.length > 1 ? parts.slice(1) : [...html.matchAll(/<a\b[^>]*href=["'][^"']*\/expose\/[^"']+["'][^>]*>[\s\S]{0,12000}?<\/a>/gi)].map(match => match[0]);
  for (const chunk of chunks) {
    const match = chunk.match(/<a\b[^>]*href=["']([^"']*\/expose\/[^"']+)["'][^>]*>/i);
    if (!match) continue;
    const url = absolute(base, match[1]);
    if (!url || seen.has(url)) continue;
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "www.immowelt.de" || parsed.username || parsed.password || parsed.port) continue;
    seen.add(url);
    const text = strip(chunk.slice(0, 30000)).slice(0, 8000);
    const title = strip(match[0].match(/\btitle=["']([^"']+)["']/i)?.[1] || text.match(/.{8,180}/)?.[0] || "Wohnungsangebot").slice(0, 240);
    const titleParts = title.split(/\s+-\s+/), priceIndex = titleParts.findIndex(part => /[\d.,]+\s*(?:€|EUR)/i.test(part));
    const city = priceIndex > 0 ? titleParts[priceIndex - 1].trim() : "";
    output.push({
      source_id: sourceId,
      identity: url,
      canonical_url: url,
      facts: {
        title,
        city,
        search_text: text,
        warm_rent: number(text, /([\d.,]+)\s*(?:€|EUR)\s*(?:Warmmiete|Bruttowarmmiete|Gesamtmiete)/i) ?? number(text, /(?:Warmmiete|Bruttowarmmiete|Gesamtmiete)\s*(?:[:=]|beträgt|ist)\s*(?:€|EUR)?\s*([\d.,]+)/i),
        cold_rent: number(text, /([\d.,]+)\s*(?:€|EUR)\s*(?:Kaltmiete|Nettokaltmiete)/i) ?? number(text, /(?:Kaltmiete|Nettokaltmiete)\s*(?:[:=]|beträgt|ist)\s*(?:€|EUR)?\s*([\d.,]+)/i),
        rooms: number(text, /([\d]+(?:[.,][\d]+)?)\s*(?:Zimmer|Zi\.)/i),
        area_sqm: number(text, /([\d]+(?:[.,][\d]+)?)\s*m²/i),
        postal_code: text.match(/\b(20\d{3}|21\d{3}|22\d{3}|23\d{3})\b/)?.[1] || null,
        image_url: listingPhoto(chunk, base),
        provider: "immowelt",
      },
    });
  }
  return output;
}

export async function fetchImmoweltSource(source, config = {}) {
  const url = String(config.url || source.search_url || "");
  if (!/^https:\/\/www\.immowelt\.de\//i.test(url)) throw new Error("immowelt_url_invalid");
  const response = await fetch(url, { headers: { accept: "text/html", "user-agent": "TraumWohnungHamburg/1.0" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`immowelt_http_${response.status}`);
  const html = await response.text();
  const nodes = cards(html, response.url, source.id);
  const empty = /keine (?:passenden )?(?:angebote|immobilien)|0 (?:angebote|treffer)/i.test(strip(html));
  if (!nodes.length && !empty) throw new Error("immowelt_inventory_unrecognized");
  return { nodes, fetched: nodes.length, verified_empty: !nodes.length && empty };
}

export async function ingestImmoweltSource(sql, source, config = {}) {
  const result = await fetchImmoweltSource(source, config);
  let inserted = 0;
  for (const node of result.nodes) {
    const rows = await sql`
      INSERT INTO housing.offer_identities (id, source_id, identity_hash, external_id, canonical_url, facts, last_seen_at, expires_at)
      VALUES (gen_random_uuid(), ${node.source_id}, ${node.source_id + ":url:" + node.identity}, NULL, ${node.canonical_url}, ${JSON.stringify(node.facts)}::jsonb, now(), now() + interval '24 hours')
      ON CONFLICT (identity_hash) DO UPDATE SET facts = EXCLUDED.facts, last_seen_at = now(), expires_at = EXCLUDED.expires_at
      RETURNING id
    `;
    if (rows.length) {
      inserted++;
      if (config.queue_matches !== false) await queueMatches(sql, rows[0].id, node.source_id, node.source_id + ":url:" + node.identity, { ...node.facts, canonical_url: node.canonical_url });
    }
  }
  return { fetched: result.fetched, valid: result.nodes.length, inserted, verified_empty: result.verified_empty };
}
