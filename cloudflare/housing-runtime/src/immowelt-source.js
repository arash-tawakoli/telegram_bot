function absolute(base, href) {
  try { return new URL(href, base).href.split("#")[0]; } catch { return null; }
}

function strip(value) {
  return String(value || "").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function number(text, pattern) {
  const value = String(text || "").match(pattern)?.[1];
  if (!value) return null;
  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value.replace(/\s/g, "");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function cards(html, base, sourceId) {
  const output = [];
  const seen = new Set();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*\/expose\/[^"']+)["'][^>]*>([\s\S]{0,12000})<\/a>/gi)) {
    const url = absolute(base, match[1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const text = strip(match[2]).slice(0, 8000);
    const title = (match[0].match(/\btitle=["']([^"']+)["']/i)?.[1] || text.match(/.{8,180}/)?.[0] || "Wohnungsangebot").trim().slice(0, 240);
    output.push({
      source_id: sourceId,
      identity: url,
      canonical_url: url,
      facts: {
        title,
        warm_rent: number(text, /(?:Warmmiete|Bruttowarmmiete|Gesamtmiete)\s*(?:[:=]|beträgt|ist)?\s*(?:€|EUR)?\s*([\d.,]+)/i),
        cold_rent: number(text, /(?:Kaltmiete|Nettokaltmiete)\s*(?:[:=]|beträgt|ist)?\s*(?:€|EUR)?\s*([\d.,]+)/i),
        rooms: number(text, /([\d]+(?:[.,][\d]+)?)\s*(?:Zimmer|Zi\.)/i),
        area_sqm: number(text, /([\d]+(?:[.,][\d]+)?)\s*m²/i),
        postal_code: text.match(/\b(20\d{3}|21\d{3}|22\d{3}|23\d{3})\b/)?.[1] || null,
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
    if (rows.length) inserted++;
  }
  return { fetched: result.fetched, valid: result.nodes.length, inserted, verified_empty: result.verified_empty };
}
