// One-time Telegram links for participants a coach created in the portal.
// The coach gets t.me/<bot>?start=link_<token>; the bot redeems it on /start.
import { sha256 } from "./auth.js";
import { sqlTime } from "./application-policy.js";

const BOT_USERNAME = "traumwohnunghamburgbot";
const TTL_MS = 20 * 60_000;
const TOKEN = /^[A-Za-z0-9_-]{32,60}$/;

function randomToken() {
  let text = "";
  for (const byte of crypto.getRandomValues(new Uint8Array(32))) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createTelegramLink(d1, participantId, memberId, now = Date.now()) {
  const participant = await d1.prepare("SELECT telegram_user_id FROM participants WHERE id=?").bind(participantId).first();
  if (!participant) throw new Error("participant_unavailable");
  if (participant.telegram_user_id) throw new Error("invalid_participant");
  const token = randomToken();
  const expiresAt = sqlTime(new Date(now + TTL_MS));
  await d1.prepare("INSERT INTO telegram_link_tokens(token_hash,participant_id,created_by_member_id,expires_at) VALUES(?,?,?,?)")
    .bind(await sha256(token), participantId, memberId || null, expiresAt).run();
  return { url: `https://t.me/${BOT_USERNAME}?start=link_${token}`, expiresAt };
}

// Moves a brand-new Telegram account onto the coach-created participant.
// Returns the linked participant id, or an error code for the bot to explain.
export async function redeemTelegramLink(d1, user, token) {
  if (!TOKEN.test(token)) return { error: "invalid" };
  const hash = await sha256(token);
  const target = await d1.prepare(
    "SELECT t.participant_id FROM telegram_link_tokens t JOIN participants p ON p.id=t.participant_id "
    + "WHERE t.token_hash=? AND t.consumed_at IS NULL AND t.expires_at>CURRENT_TIMESTAMP AND p.telegram_user_id IS NULL",
  ).bind(hash).first();
  if (!target) return { error: "expired" };
  // Never merge an account that already has its own data into another participant.
  if (user.__is_new_user !== true || user.id === target.participant_id) return { error: "account_in_use" };
  // One transaction: drop the empty auto-created participant (telegram_user_id is UNIQUE), then move the account.
  const results = await d1.batch([
    d1.prepare("DELETE FROM participants WHERE id=? AND origin='telegram'").bind(user.id),
    d1.prepare(
      "UPDATE participants SET telegram_user_id=?,telegram_chat_id=?,username=?,language_code=COALESCE(?,language_code),"
      + "last_start_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND telegram_user_id IS NULL "
      + "AND EXISTS (SELECT 1 FROM telegram_link_tokens WHERE token_hash=? AND participant_id=? AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP)",
    ).bind(user.telegram_user_id, user.telegram_chat_id, user.username || null, user.language_code || null, target.participant_id, hash, target.participant_id),
    d1.prepare("UPDATE telegram_link_tokens SET consumed_at=CURRENT_TIMESTAMP WHERE token_hash=? AND consumed_at IS NULL").bind(hash),
  ]);
  if (Number(results[1]?.meta?.changes || 0) !== 1) return { error: "expired" };
  return { participantId: target.participant_id };
}
