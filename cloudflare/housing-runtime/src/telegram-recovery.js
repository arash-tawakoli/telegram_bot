export async function recordTelegramActivity(sql, update, activityAt = new Date().toISOString()) {
  const telegramUserId = Number(update?.callback_query?.from?.id || update?.message?.from?.id);
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId < 1) return;
  await sql`UPDATE participants SET last_activity_at=${activityAt} WHERE telegram_user_id=${telegramUserId} AND (last_activity_at IS NULL OR julianday(last_activity_at)<julianday(${activityAt}))`;
}

function clean(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export async function recoverTelegramUpdates(sql, env, handleUpdate, now = new Date(), limit = 10) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RangeError("telegram_recovery_limit_invalid");
  if (typeof handleUpdate !== "function") throw new TypeError("telegram_recovery_handler_missing");
  const time = new Date(now).toISOString();
  const rows = await sql`
    SELECT update_id
    FROM telegram_updates
    WHERE payload_json IS NOT NULL AND attempts<5
      AND ((status='failed' AND processing_at IS NOT NULL AND julianday(processing_at)<=julianday(${time},'-1 minute'))
        OR (status='processing' AND processing_at IS NOT NULL AND julianday(processing_at)<=julianday(${time},'-10 minutes')))
    ORDER BY update_id
    LIMIT ${limit}`;
  let completed=0,failed=0;
  for (const row of rows) {
    const claimed=await sql`
      UPDATE telegram_updates
      SET status='processing',attempts=attempts+1,processing_at=${time},last_error=NULL
      WHERE update_id=${row.update_id} AND payload_json IS NOT NULL AND attempts<5
        AND ((status='failed' AND processing_at IS NOT NULL AND julianday(processing_at)<=julianday(${time},'-1 minute'))
          OR (status='processing' AND processing_at IS NOT NULL AND julianday(processing_at)<=julianday(${time},'-10 minutes')))
      RETURNING payload_json`;
    if (!claimed.length) continue;
    let update;
    try { update=JSON.parse(claimed[0].payload_json); }
    catch {
      await sql`UPDATE telegram_updates SET status='failed',last_error='telegram_payload_invalid',processing_at=${time} WHERE update_id=${row.update_id}`;
      failed++;
      continue;
    }
    try {
      await recordTelegramActivity(sql,update,time);
      await handleUpdate(env,update);
      await sql`UPDATE telegram_updates SET status='completed',completed_at=${time},processing_at=NULL,payload_json=NULL,last_error=NULL WHERE update_id=${row.update_id}`;
      completed++;
    } catch (error) {
      await sql`UPDATE telegram_updates SET status='failed',processing_at=${time},last_error=${clean(error?.message||error)} WHERE update_id=${row.update_id}`;
      failed++;
    }
  }
  return { scanned: rows.length,completed,failed };
}
