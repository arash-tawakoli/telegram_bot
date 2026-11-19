import { pbkdf2Sync } from "node:crypto";
import bcrypt from "./bcrypt.js";

const PASSWORD_ITERATIONS = 210_000;
const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)), (character) => character.charCodeAt(0));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function derivePassword(password, salt, iterations = PASSWORD_ITERATIONS) {
  return new Uint8Array(pbkdf2Sync(password, salt, iterations, 32, "sha256"));
}

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 512) throw new Error("password_invalid");
  return `bcrypt_sha256$${await bcrypt.hash(await sha256(password), 12)}`;
}

export async function verifyPassword(password, encoded) {
  if (String(encoded || "").startsWith("bcrypt_sha256$")) {
    try { return await bcrypt.compare(await sha256(password), String(encoded).slice("bcrypt_sha256$".length)); }
    catch { return false; }
  }
  const [algorithm, iterationText, saltText, digestText] = String(encoded || "").split("$");
  const iterations = Number(iterationText);
  if (algorithm !== "pbkdf2_sha256" || !Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false;
  let actual;
  try {
    actual = await derivePassword(password, base64UrlToBytes(saltText), iterations);
  } catch {
    return false;
  }
  const expected = base64UrlToBytes(digestText);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

function token() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function isoAfter(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export async function createSession(sql, memberId) {
  const accessToken = token();
  const refreshToken = token();
  const accessExpiresAt = isoAfter(ACCESS_TTL_SECONDS);
  const refreshExpiresAt = isoAfter(REFRESH_TTL_SECONDS);
  await sql`
    INSERT INTO housing.portal_sessions
      (id, member_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at)
    VALUES
      (gen_random_uuid(), ${memberId}, ${await sha256(accessToken)}, ${await sha256(refreshToken)}, ${accessExpiresAt}::timestamptz, ${refreshExpiresAt}::timestamptz)
  `;
  return { access_token: accessToken, refresh_token: refreshToken, expires_in: ACCESS_TTL_SECONDS };
}

// `defer` (e.g. ctx.waitUntil) takes the last_seen_at write off the response path.
export async function memberForAccess(sql, accessToken, defer) {
  if (!accessToken) return null;
  const hash = await sha256(accessToken);
  const rows = await sql`
    SELECT m.id, m.email, m.display_name, m.role, m.active
    FROM housing.portal_sessions s
    JOIN housing.portal_members m ON m.id = s.member_id
    WHERE s.access_token_hash = ${hash}
      AND s.revoked_at IS NULL
      AND s.access_expires_at > ${new Date().toISOString()}
      AND m.active = true
  `;
  if (!rows[0]) return null;
  const touch = sql`UPDATE housing.portal_sessions SET last_seen_at = now() WHERE access_token_hash = ${hash}`;
  if (defer) defer(touch.catch(() => {})); else await touch;
  return rows[0];
}

export async function refreshSession(sql, refreshToken) {
  if (!refreshToken) return null;
  const rows = await sql`
    SELECT id, member_id
    FROM housing.portal_sessions
    WHERE refresh_token_hash = ${await sha256(refreshToken)}
      AND revoked_at IS NULL
      AND refresh_expires_at > ${new Date().toISOString()}
  `;
  if (!rows[0]) return null;
  const accessToken = token();
  const accessExpiresAt = isoAfter(ACCESS_TTL_SECONDS);
  await sql`
    UPDATE housing.portal_sessions
    SET access_token_hash = ${await sha256(accessToken)}, access_expires_at = ${accessExpiresAt}::timestamptz, last_seen_at = now()
    WHERE id = ${rows[0].id}
  `;
  return { access_token: accessToken, refresh_token: refreshToken, expires_in: ACCESS_TTL_SECONDS };
}

export async function revokeSession(sql, tokenValue) {
  if (!tokenValue) return;
  const digest = await sha256(tokenValue);
  await sql`UPDATE housing.portal_sessions SET revoked_at = now() WHERE access_token_hash = ${digest} OR refresh_token_hash = ${digest}`;
}

export { sha256 };
