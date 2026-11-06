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
    for (let offset = 0; offset < ids.length; offset += 400) {
      const chunk = ids.slice(offset, offset + 400);
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
