import { issueProviderAuthFlow } from "./provider-facade.js";
import { premiumParticipant, timestampMillis } from "./application-policy.js";
import { refreshImmoScoutSession } from "./immoscout-application.js";
import { refreshImmomioSession } from "./immomio-application.js";
import { refreshImmoweltSession } from "./immowelt-application.js";

const LABELS = { immoscout24: "ImmoScout24", immowelt: "Immowelt", immomio: "Immomio" };
const enabled = value => value === true || value === 1;

async function scanExpiringSessions(sql, env, now, centralOnly = false) {
  const rows = centralOnly ? await sql`
    SELECT pc.participant_id, pc.provider, pc.ciphertext, pc.iv, pc.key_version, pc.expires_at, pc.updated_at
    FROM housing.provider_connections pc
    JOIN housing.participants p ON p.id = pc.participant_id
    WHERE pc.status = 'connected' AND p.status = 'active' AND p.telegram_user_id = ${8538226539}
      AND pc.provider IN ('immowelt','immomio')
      AND (pc.expires_at IS NOT NULL OR pc.provider = 'immowelt')
  ` : await sql`
    SELECT pc.participant_id, pc.provider, pc.ciphertext, pc.iv, pc.key_version, pc.expires_at, pc.updated_at
    FROM housing.provider_connections pc
    JOIN housing.participants p ON p.id = pc.participant_id
    WHERE pc.status = 'connected' AND p.status = 'active'
      AND (p.auto_apply_enabled = 1 OR p.telegram_user_id = ${8538226539})
      AND pc.provider IN ('immoscout24','immowelt','immomio')
      AND (pc.expires_at IS NOT NULL OR pc.provider = 'immowelt')
  `;
  let checked = 0, marked = 0;
  for (const connection of rows) {
    const expiresAt = timestampMillis(connection.expires_at);
    const updatedAt = timestampMillis(connection.updated_at);
    const hourlyRefresh = ["immowelt", "immomio"].includes(connection.provider) &&
      Number.isFinite(updatedAt) && updatedAt <= now.getTime() - 55 * 60_000;
    if (!hourlyRefresh && (!Number.isFinite(expiresAt) || expiresAt > now.getTime() + 10 * 60_000)) continue;
    checked++;
    try {
      if (connection.provider === "immoscout24") await refreshImmoScoutSession(sql, env, connection);
      else if (connection.provider === "immowelt") await refreshImmoweltSession(sql, env, connection, hourlyRefresh);
      else await refreshImmomioSession(sql, env, connection, hourlyRefresh);
    } catch (error) {
      if (String(error?.message || error) !== "needs_login") continue;
      await sql`
        UPDATE housing.provider_connections SET status = 'needs_login', updated_at = ${now.toISOString()}
        WHERE participant_id = ${connection.participant_id} AND provider = ${connection.provider} AND status = 'connected'
      `;
      marked++;
    }
  }
  return { checked, marked };
}

export async function runCentralProviderSessionRefresh(sql, env, now = new Date()) {
  return scanExpiringSessions(sql, env, now, true);
}

async function sendReminder(sql, env, row, now, fetchImpl) {
  const provider = row.provider === "immoscout" ? "immoscout24" : String(row.provider);
  const label = LABELS[provider];
  if (!label) throw new Error("provider_unsupported");
  const flow = await issueProviderAuthFlow(sql, row.participant_id, provider, "telegram", "telegram", { channel: "telegram", reconnect_reminder: true });
  const response = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: Number(row.telegram_chat_id),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      text: `🔐 <b>${label} erneut verbinden</b>\n\nDeine ${label}-Sitzung ist abgelaufen oder nicht mehr gültig. Damit automatische Bewerbungen weiterlaufen, melde dich bitte erneut an.`,
      reply_markup: { inline_keyboard: [
        [{ text: `🔐 ${label} verbinden`, url: `https://login.traumwohnunghamburg.de/connect?ticket=${encodeURIComponent(flow.state)}` }],
        [{ text: "⚡ Automatische Bewerbungen", callback_data: "platforms" }],
      ] },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) throw new Error(`telegram_${data?.error_code || response.status}`);
  return now;
}

export async function runPlatformSessionReminders(sql, env, now = new Date(), fetchImpl = fetch) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("telegram_token_missing");
  const scan = await scanExpiringSessions(sql, env, now);

  const connections = await sql`
    SELECT pc.participant_id, pc.provider, pc.updated_at AS connection_updated_at,
      pc.account_hint, p.telegram_chat_id, p.status AS participant_status,
      p.auto_apply_enabled, p.plan_override, p.plan_override_expires_at, p.referral_bonus_until,
      pref.enabled AS preferences_enabled,
      CASE pc.provider WHEN 'immoscout24' THEN pref.immoscout_enabled
        WHEN 'immowelt' THEN pref.immowelt_enabled WHEN 'immomio' THEN pref.immomio_enabled ELSE 0 END AS provider_enabled,
      sub.status AS subscription_status, sub.current_period_end AS subscription_period_end,
      (SELECT MAX(n.created_at) FROM housing.platform_reauth_notifications n
        WHERE n.participant_id = pc.participant_id AND n.provider IN (pc.provider, CASE pc.provider WHEN 'immoscout24' THEN 'immoscout' ELSE pc.provider END)) AS latest_notification_at
    FROM housing.provider_connections pc
    JOIN housing.participants p ON p.id = pc.participant_id
    LEFT JOIN housing.application_preferences pref ON pref.participant_id = pc.participant_id
    LEFT JOIN housing.user_subscriptions sub ON sub.participant_id = pc.participant_id AND sub.provider = 'stripe'
    WHERE pc.status = 'needs_login' AND p.status = 'active' AND p.auto_apply_enabled = 1
  `;
  for (const row of connections) {
    const provider = row.provider === "immoscout" ? "immoscout24" : String(row.provider);
    if (!LABELS[provider] || !row.telegram_chat_id || !enabled(row.preferences_enabled) || !enabled(row.provider_enabled)
      || !premiumParticipant(row, now.getTime())) continue;
    if (row.latest_notification_at && timestampMillis(row.latest_notification_at) >= timestampMillis(row.connection_updated_at)) continue;
    await sql`
      INSERT INTO housing.platform_reauth_notifications (id, participant_id, provider, reason, available_at)
      VALUES (${crypto.randomUUID()}, ${row.participant_id}, ${provider}, 'needs_login', ${now.toISOString()})
      ON CONFLICT DO NOTHING
    `;
  }

  const stale = await sql`
    SELECT id, updated_at FROM housing.platform_reauth_notifications
    WHERE status = 'sending'
  `;
  for (const row of stale) {
    if (timestampMillis(row.updated_at) < now.getTime() - 15 * 60_000) {
      await sql`UPDATE housing.platform_reauth_notifications SET status = 'pending', updated_at = ${now.toISOString()} WHERE id = ${row.id} AND status = 'sending'`;
    }
  }
  await sql`
    UPDATE housing.platform_reauth_notifications SET status = 'resolved', updated_at = ${now.toISOString()}
    WHERE status IN ('pending','sending') AND EXISTS (
      SELECT 1 FROM housing.provider_connections pc
      WHERE pc.participant_id = housing.platform_reauth_notifications.participant_id
        AND (pc.provider = housing.platform_reauth_notifications.provider
          OR (pc.provider = 'immoscout24' AND housing.platform_reauth_notifications.provider = 'immoscout'))
        AND pc.status = 'connected'
    )
  `;

  const rows = await sql`
    SELECT n.id, n.participant_id, n.provider, n.attempts, n.reminder_stage, p.telegram_chat_id
    FROM housing.platform_reauth_notifications n
    JOIN housing.participants p ON p.id = n.participant_id
    WHERE n.status = 'pending' AND n.available_at <= ${now.toISOString()}
      AND p.status = 'active' AND p.telegram_chat_id IS NOT NULL
    ORDER BY n.created_at LIMIT 20
  `;
  let sent = 0;
  for (const row of rows) {
    const attempts = Number(row.attempts || 0) + 1;
    const claimed = await sql`
      UPDATE housing.platform_reauth_notifications
      SET status = 'sending', attempts = ${attempts}, updated_at = ${now.toISOString()}, last_error = NULL
      WHERE id = ${row.id} AND status = 'pending' RETURNING id
    `;
    if (!claimed.length) continue;
    try {
      await sendReminder(sql, env, row, now, fetchImpl);
      const stage = Number(row.reminder_stage || 0);
      const delayDays = [3, 4, 23][stage];
      const nextStage = stage + 1;
      const status = nextStage < 4 ? "pending" : "sent";
      const availableAt = delayDays ? new Date(now.getTime() + delayDays * 86_400_000).toISOString() : now.toISOString();
      await sql`
        UPDATE housing.platform_reauth_notifications
        SET status = ${status}, reminder_stage = ${Math.min(nextStage, 3)}, available_at = ${availableAt},
          last_sent_at = ${now.toISOString()}, updated_at = ${now.toISOString()}, last_error = NULL
        WHERE id = ${row.id}
      `;
      sent++;
    } catch (error) {
      const message = String(error?.message || error).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 240);
      const terminal = attempts >= 5 || /telegram_(400|403)\b/.test(message);
      const availableAt = new Date(now.getTime() + Math.min(attempts * 5, 30) * 60_000).toISOString();
      await sql`
        UPDATE housing.platform_reauth_notifications
        SET status = ${terminal ? "failed" : "pending"}, available_at = ${availableAt}, updated_at = ${now.toISOString()}, last_error = ${message}
        WHERE id = ${row.id}
      `;
    }
  }
  return { ...scan, queued: rows.length, sent };
}
