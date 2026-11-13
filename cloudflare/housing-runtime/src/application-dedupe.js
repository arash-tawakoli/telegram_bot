const encoder = new TextEncoder();

export async function applicationIdempotencyHash(key) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(key)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hasRetainedApplicationKey(sql, key) {
  const keyHash = await applicationIdempotencyHash(key);
  const rows = await sql`
    SELECT 1 FROM housing.application_dedupe_keys WHERE key_hash = ${keyHash} LIMIT 1
  `;
  return rows.length > 0;
}

export async function rememberApplicationKey(sql, key, createdAt = new Date().toISOString()) {
  const keyHash = await applicationIdempotencyHash(key);
  await sql`
    INSERT INTO housing.application_dedupe_keys (key_hash, created_at)
    VALUES (${keyHash}, ${createdAt})
    ON CONFLICT (key_hash) DO NOTHING
  `;
  return keyHash;
}
