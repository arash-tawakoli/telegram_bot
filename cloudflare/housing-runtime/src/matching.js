function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function object(value) {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try { return JSON.parse(value || "{}") || {}; } catch { return {}; }
  }
  return {};
}

function berlinDayStartISO(now = new Date()) {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type) => dateParts.find((entry) => entry.type === type)?.value;
  const year = Number(part("year")), month = Number(part("month")), day = Number(part("day"));
  const utcMidnight = new Date(Date.UTC(year, month - 1, day));
  const offsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin", timeZoneName: "shortOffset", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(utcMidnight);
  const offsetLabel = offsetParts.find((entry) => entry.type === "timeZoneName")?.value || "GMT+0";
  const match = offsetLabel.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  const offsetMinutes = match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] || 0)) : 0;
  return new Date(utcMidnight.getTime() - offsetMinutes * 60_000).toISOString().replace("T", " ").replace("Z", "").slice(0, 19);
}

export async function queueMatches(sql, offerId, sourceId, identityHash, facts) {
  const rows = await sql`
    SELECT DISTINCT sp.participant_id, sp.criteria,
      p.test_auto_apply_allowed, p.test_auto_apply_enabled,
      p.test_auto_apply_daily_limit, p.auto_apply_enabled
    FROM housing.search_profiles sp
    JOIN housing.source_links sl ON sl.search_profile_id = sp.id AND sl.source_id = ${sourceId}
    JOIN housing.participants p ON p.id = sp.participant_id AND p.status = 'active'
    WHERE sp.active = true
  `;
  let queued = 0;
  for (const row of rows) {
    const criteria = object(row.criteria);
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

    // The personal test path is deliberately separate from participant plugin connections.
    if ([1, 69].includes(Number(sourceId))
      && (row.test_auto_apply_allowed === true || row.test_auto_apply_allowed === 1)
      && (row.test_auto_apply_enabled === true || row.test_auto_apply_enabled === 1)
      && !(row.auto_apply_enabled === true || row.auto_apply_enabled === 1)) {
      const dailyLimit = Math.min(5, Math.max(1, Number(row.test_auto_apply_daily_limit || 1)));
      const dayStart = berlinDayStartISO();
      const testKey = `test:${row.participant_id}:${identityHash}`;
      const testApplication = await sql`
        INSERT INTO housing.applications
          (id, participant_id, offer_identity_id, provider, idempotency_key, status, test_mode)
        SELECT
          gen_random_uuid(), ${row.participant_id}, ${offerId}, 'immoscout24', ${testKey}, 'pending', true
        WHERE EXISTS (
          SELECT 1 FROM housing.participants p
          WHERE p.id = ${row.participant_id}
            AND p.status = 'active'
            AND p.test_auto_apply_allowed = true
            AND p.test_auto_apply_enabled = true
            AND p.auto_apply_enabled = false
        )
          AND NOT EXISTS (
            SELECT 1 FROM housing.applications a
            WHERE a.participant_id = ${row.participant_id}
              AND a.test_mode = true
              AND a.status IN ('pending','processing')
          )
          AND (
            SELECT COUNT(*) FROM housing.applications a
            WHERE a.participant_id = ${row.participant_id}
              AND a.test_mode = true
              AND a.submission_started_at >= ${dayStart}
          ) < ${dailyLimit}
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `;
      if (testApplication.length) {
        await sql`INSERT INTO housing.jobs (id, kind, payload, status)
          VALUES (gen_random_uuid(), 'application',
            ${JSON.stringify({ application_id: testApplication[0].id, participant_id: row.participant_id })}::jsonb,
            'queued')`;
      }
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
