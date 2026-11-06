function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export async function queueMatches(sql, offerId, sourceId, identityHash, facts) {
  const rows = await sql`
    SELECT DISTINCT sp.participant_id, sp.criteria
    FROM housing.search_profiles sp
    JOIN housing.source_links sl ON sl.search_profile_id = sp.id AND sl.source_id = ${sourceId}
    JOIN housing.participants p ON p.id = sp.participant_id AND p.status = 'active'
    WHERE sp.active = true
  `;
  let queued = 0;
  for (const row of rows) {
    const criteria = row.criteria || {};
    const warm = number(facts?.warm_rent);
    const maxRent = number(criteria.max_warm_rent ?? criteria.maxWarmRent);
    const rooms = number(facts?.rooms);
    const minRooms = number(criteria.min_rooms ?? criteria.minRooms);
    const area = number(facts?.area_sqm);
    const minArea = number(criteria.min_area_sqm ?? criteria.minAreaSqm);
    if (maxRent != null && warm != null && warm > maxRent) continue;
    if (minRooms != null && rooms != null && rooms < minRooms) continue;
    if (minArea != null && area != null && area < minArea) continue;
    const key = `${row.participant_id}:${identityHash}`;
    const inserted = await sql`
      INSERT INTO housing.deliveries (id, participant_id, offer_identity_id, idempotency_key, status)
      VALUES (gen_random_uuid(), ${row.participant_id}, ${offerId}, ${key}, 'pending')
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `;
    if (inserted.length) {
      queued++;
      await sql`INSERT INTO housing.jobs (id, kind, payload, status) VALUES (gen_random_uuid(), 'delivery', ${JSON.stringify({ delivery_id: inserted[0].id })}::jsonb, 'queued')`;
    }
  }
  return queued;
}

function html(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function telegramText(facts) {
  const rows = [facts?.title, facts?.city, facts?.district, facts?.postal_code, facts?.warm_rent != null ? `${facts.warm_rent} € warm` : null, facts?.rooms != null ? `${facts.rooms} Zimmer` : null, facts?.area_sqm != null ? `${facts.area_sqm} m²` : null].filter(Boolean);
  return `<b>${html(rows.shift() || "Wohnungsangebot")}</b>\n${rows.map(html).join(" · ")}\n<a href="${html(facts?.canonical_url || facts?.url || "")}">Originalangebot öffnen</a>`;
}
