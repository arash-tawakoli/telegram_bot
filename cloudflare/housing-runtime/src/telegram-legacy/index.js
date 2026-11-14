import { configureLegacyRuntime, db, withPlan } from "./runtime.js";
import { handleMessage, handleCallback } from "./handlers.js";

export async function handleLegacyTelegramUpdate(env, payload) {
  configureLegacyRuntime(env, env.HOUSING_DB);
  const from = payload?.callback_query?.from || payload?.message?.from;
  const chatId = payload?.callback_query?.message?.chat?.id || payload?.message?.chat?.id;
  if (!from?.id || !chatId) return { ok: true, ignored: true };
  const prepared = await db.rpc("prepare_telegram_update", { p_payload: payload });
  if (prepared.error) throw prepared.error;
  const claim = Number(prepared.data?.claim || 0);
  if (claim === 0) return { ok: true, duplicate: true };
  if (claim < 0) return { ok: false, busy: true };
  const user = await withPlan(
    { ...(prepared.data?.user || {}), __is_new_user: prepared.data?.is_new_user === true },
    prepared.data?.subscription || null,
  );
  user.request_update_id = payload.update_id;
  user.request_attempt = claim;
  user.__callback_acked = false;
  if (!user.is_active) return { ok: true, blocked: true };
  if (payload.callback_query) await handleCallback(payload.callback_query, user);
  else if (payload.message?.chat?.type === "private" && (payload.message?.text || payload.message?.document || payload.message?.photo)) await handleMessage(payload.message, user);
  return { ok: true };
}
