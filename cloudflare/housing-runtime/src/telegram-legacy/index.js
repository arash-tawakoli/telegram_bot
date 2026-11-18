import { configureLegacyRuntime, db, send, withPlan } from "./runtime.js";
import { handleMessage, handleCallback } from "./handlers.js";
import { redeemTelegramLink } from "../telegram-link.js";

const LINK_ERRORS = {
  invalid: "Dieser Verbindungslink ist ungültig. Bitte deinen Coach um einen neuen Link.",
  expired: "Dieser Verbindungslink ist abgelaufen oder wurde schon benutzt. Bitte deinen Coach um einen neuen Link.",
  account_in_use: "Dieses Telegram-Konto ist bereits registriert und kann nicht mit einem weiteren Profil verbunden werden. Bitte wende dich an deinen Coach.",
};

async function prepareUser(payload) {
  const prepared = await db.rpc("prepare_telegram_update", { p_payload: payload });
  if (prepared.error) throw prepared.error;
  return prepared;
}

export async function handleLegacyTelegramUpdate(env, payload) {
  configureLegacyRuntime(env, env.HOUSING_DB);
  const from = payload?.callback_query?.from || payload?.message?.from;
  const chatId = payload?.callback_query?.message?.chat?.id || payload?.message?.chat?.id;
  if (!from?.id || !chatId) return { ok: true, ignored: true };
  let prepared = await prepareUser(payload);
  const claim = Number(prepared.data?.claim || 0);
  if (claim === 0) return { ok: true, duplicate: true };
  if (claim < 0) return { ok: false, busy: true };
  // "/start link_<token>" from a coach's one-time link (telegram-link.js).
  const link = payload.message?.chat?.type === "private" && String(payload.message?.text || "").match(/^\/start\s+link_(\S+)$/);
  if (link) {
    const linked = await redeemTelegramLink(env.HOUSING_DB, { ...prepared.data?.user, __is_new_user: prepared.data?.is_new_user === true }, link[1]);
    if (linked.participantId) {
      prepared = await prepareUser(payload);
      await send(chatId, "✅ Dein Telegram-Konto ist jetzt mit deinem Profil bei deinem Coach verbunden.");
    } else {
      await send(chatId, LINK_ERRORS[linked.error] || LINK_ERRORS.invalid);
    }
  }
  const user = await withPlan(
    { ...(prepared.data?.user || {}), __is_new_user: !link && prepared.data?.is_new_user === true },
    prepared.data?.subscription || null,
  );
  user.request_update_id = payload.update_id;
  user.request_attempt = claim;
  user.__callback_acked = payload.__earlyCallbackAck ? await payload.__earlyCallbackAck : false;
  if (!user.is_active) return { ok: true, blocked: true };
  if (payload.callback_query) await handleCallback(payload.callback_query, user);
  else if (payload.message?.chat?.type === "private" && (payload.message?.text || payload.message?.document || payload.message?.photo)) await handleMessage(payload.message, user);
  return { ok: true };
}
