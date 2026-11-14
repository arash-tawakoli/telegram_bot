import { applicationIdempotencyHash } from "./application-dedupe.js";

export async function deleteExpiredListings(sql, limit = 5000) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new RangeError("retention_limit_invalid");
  }

  const deleted = await sql.begin(async (tx) => {
    const expired = await tx`
      SELECT id
      FROM housing.offer_identities
      WHERE expires_at IS NOT NULL AND expires_at <= now()
      ORDER BY expires_at, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
    if (!expired.length) return 0;
    const ids = expired.map((row) => row.id);
    let deletedCount = 0;
    // D1's SQLite variable limit is lower than PostgreSQL's; keep each mutation small.
    for (let offset = 0; offset < ids.length; offset += 50) {
      const chunk = ids.slice(offset, offset + 50);
      const placeholders = chunk.map((_, index) => `$${index + 1}`).join(",");
      await tx.unsafe(`
      UPDATE housing.applications
      SET offer_identity_id = NULL,
          listing_expired_at = COALESCE(listing_expired_at, now()),
          status = CASE WHEN status IN ('pending', 'processing') THEN 'failed' ELSE status END,
          last_error = CASE WHEN status IN ('pending', 'processing') THEN 'listing_expired' ELSE last_error END,
          updated_at = now()
      WHERE offer_identity_id IN (${placeholders})
      `, chunk);
      await tx.unsafe(`
      UPDATE housing.deliveries
      SET offer_identity_id = NULL,
          listing_expired_at = COALESCE(listing_expired_at, now()),
          status = CASE WHEN status IN ('pending', 'processing') THEN 'skipped' ELSE status END,
          error_message = CASE WHEN status IN ('pending', 'processing') THEN 'listing_expired' ELSE error_message END
      WHERE offer_identity_id IN (${placeholders})
      `, chunk);
      const result = await tx.unsafe(`DELETE FROM housing.offer_identities WHERE id IN (${placeholders})`, chunk);
      deletedCount += Number(result.count ?? result.length ?? 0);
    }
    return deletedCount;
  });

  if (!Number.isSafeInteger(deleted) || deleted < 0 || deleted > limit) {
    throw new Error("retention_result_invalid");
  }

  return deleted;
}

export async function deleteExpiredApplicationRecords(sql, limit = 5000, now = new Date()) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new RangeError("application_retention_limit_invalid");
  }
  const nowIso = now.toISOString();
  const timestamp = (column) => `CASE WHEN substr(${column}, -3) = '+00' THEN substr(${column}, 1, length(${column}) - 3) || 'Z' ELSE ${column} END`;
  const appTime = timestamp("a.created_at");
  const eventTime = timestamp("e.created_at");
  const expiredTime = timestamp("created_at");
  const result = await sql.begin(async (tx) => {
    const expiredApplications = await tx.unsafe(`
      SELECT a.id, a.idempotency_key
      FROM housing.applications a
      WHERE julianday(${appTime}) IS NOT NULL
        AND julianday(${appTime}) <= julianday($1, '-24 hours')
        AND a.status <> 'processing'
        AND NOT EXISTS (
          SELECT 1 FROM housing.application_events e
          WHERE e.application_id = a.id
            AND (julianday(${eventTime}) IS NULL
              OR julianday(${eventTime}) > julianday($1, '-24 hours'))
        )
      ORDER BY julianday(${appTime}), a.id
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    `, [nowIso, limit]);

    const metadataRows = [];
    for (const row of expiredApplications) {
      metadataRows.push([await applicationIdempotencyHash(row.idempotency_key), nowIso]);
    }
    for (let offset = 0; offset < metadataRows.length; offset += 40) {
      const chunk = metadataRows.slice(offset, offset + 40);
      const values = [];
      const tuples = chunk.map((row, index) => {
        values.push(...row);
        return `($${index * 2 + 1}, $${index * 2 + 2})`;
      }).join(",");
      await tx.unsafe(`
        INSERT OR IGNORE INTO housing.application_dedupe_keys (key_hash, created_at)
        VALUES ${tuples}
      `, values);
    }

    const expiredEvents = await tx.unsafe(`
      SELECT id FROM housing.application_events
      WHERE julianday(${expiredTime}) IS NOT NULL
        AND julianday(${expiredTime}) <= julianday($1, '-24 hours')
      ORDER BY julianday(${expiredTime}), id
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    `, [nowIso, limit]);
    for (let offset = 0; offset < expiredEvents.length; offset += 50) {
      const ids = expiredEvents.slice(offset, offset + 50).map((row) => row.id);
      const placeholders = ids.map((_, index) => `$${index + 1}`).join(",");
      await tx.unsafe(`DELETE FROM housing.application_events WHERE id IN (${placeholders})`, ids);
    }

    let deletedApplications = 0;
    for (let offset = 0; offset < expiredApplications.length; offset += 50) {
      const ids = expiredApplications.slice(offset, offset + 50).map((row) => row.id);
      const placeholders = ids.map((_, index) => `$${index + 1}`).join(",");
      const deleted = await tx.unsafe(`DELETE FROM housing.applications WHERE id IN (${placeholders})`, ids);
      deletedApplications += Number(deleted.count ?? deleted.length ?? 0);
    }
    return { applications: deletedApplications, events: expiredEvents.length, metadata: metadataRows.length };
  });

  for (const value of Object.values(result)) {
    if (!Number.isSafeInteger(value) || value < 0 || value > limit) throw new Error("application_retention_result_invalid");
  }
  return result;
}

export async function expireAdminPremiumOverrides(sql) {
  const expired = await sql`
    UPDATE housing.participants
    SET plan_override = NULL,
        plan_override_expires_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE plan_override = 'premium'
      AND plan_override_expires_at IS NOT NULL
      AND julianday(plan_override_expires_at) <= julianday('now')
    RETURNING id
  `;
  if (!Array.isArray(expired)) throw new Error("premium_override_expiry_result_invalid");
  return expired.length;
}
