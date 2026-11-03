export async function deleteExpiredListings(sql, limit = 1000) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new RangeError("retention_limit_invalid");
  }

  const rows = await sql`
    SELECT app_private.delete_expired_listings(${limit})::integer AS deleted
  `;
  const deleted = Number(rows?.[0]?.deleted ?? 0);

  if (!Number.isSafeInteger(deleted) || deleted < 0 || deleted > limit) {
    throw new Error("retention_result_invalid");
  }

  return deleted;
}
