import { button, edit, runtimeEnv, send } from "./runtime.js";
import { isAdmin } from "./admin.js";

function database() {
  const db = runtimeEnv()?.HOUSING_DB;
  if (!db?.prepare || !db?.batch) throw new Error("reset_database_unavailable");
  return db;
}

function berlinDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = kind => parts.find(item => item.type === kind)?.value;
  return part("year") + "-" + part("month") + "-" + part("day");
}

async function usageState(participantId) {
  return database().prepare(`
    SELECT p.status, p.auto_apply_quota_reset_at AS reset_at, pref.daily_limit,
      (SELECT COUNT(*) FROM usage_reset_credits c
       WHERE c.participant_id=p.id AND c.redeemed_at IS NULL) AS available,
      (SELECT COUNT(*) FROM applications a
       WHERE a.participant_id=p.id AND a.quota_local_date=?
         AND (p.auto_apply_quota_reset_at IS NULL
              OR datetime(a.submission_started_at)>=datetime(p.auto_apply_quota_reset_at))) AS used_today
    FROM participants p
    LEFT JOIN application_preferences pref ON pref.participant_id=p.id
    WHERE p.id=? AND p.status='active'
  `).bind(berlinDate(), participantId).first();
}

function render(chatId, messageId, text, rows) {
  const markup = { inline_keyboard: rows };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

export async function resetPage(user, chatId, messageId, note = "") {
  const state = await usageState(user.id);
  if (!state) return render(chatId, messageId, "Reset ist für dieses Konto nicht verfügbar.",
    [[button("← Einstellungen", "settings")]]);
  const available = Number(state.available || 0);
  const limit = state.daily_limit == null ? null : Number(state.daily_limit);
  const used = Number(state.used_today || 0);
  const eligible = Number.isInteger(limit) && limit > 0 && used >= limit && available > 0;
  const explanation = limit == null
    ? "Der automatische Bewerbungsversand hat aktuell kein Tageslimit. Deine gespeicherten Resets bleiben erhalten."
    : limit <= 0
    ? "Der Bewerbungsversand ist durch das Tageslimit gesperrt. Ein Reset ändert dieses Limit nicht."
    : "Heutiges Bewerbungs-Kontingent: <b>" + Math.min(used, limit) + " / " + limit + "</b>.";
  return render(chatId, messageId,
    "♻️ <b>Resets</b>\n\nGespeicherte Resets: <b>" + available + "</b>\n"
    + explanation + "\n\n"
    + (eligible
      ? "Du kannst einen Reset einlösen und dein heutiges Bewerbungs-Kontingent wieder auffüllen."
      : "Ein Reset wird nur verbraucht, wenn ein begrenztes Kontingent ausgeschöpft ist.")
    + (note ? "\n\n" + note : ""),
    [...(eligible ? [[button("♻️ 1 Reset einlösen", "reset:redeem")]] : []),
      [button("← Einstellungen", "settings")]]);
}

export async function redeemReset(user, chatId, messageId) {
  const state = await usageState(user.id);
  const limit = state?.daily_limit == null ? null : Number(state.daily_limit);
  if (!state || !Number.isInteger(limit) || limit <= 0
    || Number(state.used_today) < limit || Number(state.available) <= 0)
    return resetPage(user, chatId, messageId, "Kein Reset erforderlich. Dein Guthaben bleibt erhalten.");
  const db = database();
  const credit = await db.prepare(`
    SELECT id FROM usage_reset_credits
    WHERE participant_id=? AND redeemed_at IS NULL
    ORDER BY granted_at,id LIMIT 1
  `).bind(user.id).first();
  if (!credit) return resetPage(user, chatId, messageId, "Kein Reset verfügbar.");

  // D1 batch is transactional: consume only if the quota is exhausted.
  const timestamp = new Date().toISOString();
  const today = berlinDate();
  const [consumed, refreshed] = await db.batch([
    db.prepare(`
      UPDATE usage_reset_credits SET redeemed_at=?
      WHERE id=? AND participant_id=? AND redeemed_at IS NULL
        AND EXISTS (
          SELECT 1 FROM participants p JOIN application_preferences pref ON pref.participant_id=p.id
          WHERE p.id=? AND p.status='active' AND pref.daily_limit>0
            AND (SELECT COUNT(*) FROM applications a
              WHERE a.participant_id=p.id AND a.quota_local_date=?
                AND (p.auto_apply_quota_reset_at IS NULL
                  OR datetime(a.submission_started_at)>=datetime(p.auto_apply_quota_reset_at))
            )>=pref.daily_limit
        )
      RETURNING id
    `).bind(timestamp, credit.id, user.id, user.id, today),
    db.prepare(`
      UPDATE participants SET auto_apply_quota_reset_at=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND EXISTS (
        SELECT 1 FROM usage_reset_credits c
        WHERE c.id=? AND c.participant_id=? AND c.redeemed_at=?
      )
      RETURNING id
    `).bind(timestamp, user.id, credit.id, user.id, timestamp),
    db.prepare(`
      UPDATE applications SET next_attempt_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE participant_id=? AND status='pending' AND wait_reason='daily_limit'
        AND EXISTS (SELECT 1 FROM usage_reset_credits c WHERE c.id=? AND c.redeemed_at=?)
    `).bind(user.id, credit.id, timestamp),
  ]);
  const success = consumed?.results?.length === 1 && refreshed?.results?.length === 1;
  return resetPage(user, chatId, messageId,
    success ? "✅ Dein heutiges Bewerbungs-Kontingent wurde zurückgesetzt."
      : "Kein Reset verbraucht. Bitte prüfe den aktuellen Kontingentstand.");
}

export async function adminResetMenu(user, chatId, messageId) {
  if (!isAdmin(user)) return;
  const result = await database().prepare(
    "SELECT COUNT(*) AS count FROM participants WHERE status='active' AND telegram_user_id IS NOT NULL"
  ).first();
  return render(chatId, messageId,
    "♻️ <b>Admin · Resets</b>\n\n"
    + "Gespeicherte Resets stellen ein ausgeschöpftes Tageskontingent für Auto-Bewerbungen wieder her."
    + "\nAktive Telegram-Nutzer: <b>" + Number(result?.count || 0) + "</b>"
    + "\n\nDie Vergabe ändert keine Suchprofile, Abos oder bisherigen Bewerbungen.",
    [[button("👤 Nutzer auswählen", "admin:list")],
      [button("🎁 Allen 1 Reset geben", "reset:admin:all:preview")],
      [button("← Admin", "admin:list")]]);
}

export async function grantResetToUser(user, participantId, callbackId) {
  if (!isAdmin(user)) return { granted: false };
  const rows = await database().prepare(`
    INSERT OR IGNORE INTO usage_reset_credits
      (id,participant_id,grant_key,granted_by_telegram_user_id)
    SELECT lower(hex(randomblob(16))),id,?,?
    FROM participants WHERE id=? AND status='active' AND telegram_user_id IS NOT NULL
    RETURNING participant_id
  `).bind("user:" + String(callbackId).slice(0,120),
    Number(user.telegram_user_id), participantId).all();
  const granted = rows?.results?.length === 1;
  if (granted) {
    const target = await database().prepare(
      "SELECT telegram_chat_id FROM participants WHERE id=?"
    ).bind(participantId).first();
    if (target?.telegram_chat_id) {
      await send(Number(target.telegram_chat_id),
        "🎁 <b>1 Reset geschenkt!</b>\n\nDu findest deinen gespeicherten Reset unter Einstellungen → Reset. "
        + "Er wird erst verbraucht, wenn dein tägliches Bewerbungs-Kontingent ausgeschöpft ist.")
        .catch(error => console.error("reset_grant_notice", String(error)));
    }
  }
  return { granted };
}

export async function previewGlobalReset(user, chatId, messageId) {
  if (!isAdmin(user)) return;
  const row = await database().prepare(`
    SELECT COUNT(*) AS eligible FROM participants p
    WHERE p.status='active' AND p.telegram_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM usage_reset_credits c WHERE c.participant_id=p.id AND c.grant_key=?
      )
  `).bind("global:" + berlinDate()).first();
  const eligible = Number(row?.eligible || 0);
  return render(chatId, messageId,
    "🎁 <b>Globaler Reset · Bestätigung</b>\n\n"
    + "Aktive Nutzer ohne heutiges globales Geschenk: <b>" + eligible + "</b>\n"
    + "Jeder erhält genau 1 gespeicherten Reset. Wiederholte Bestätigungen vergeben heute keine doppelten Guthaben.",
    [...(eligible ? [[button("✅ " + eligible + " Resets vergeben", "reset:admin:all:confirm")]] : []),
      [button("← Resets", "reset:admin:menu")]]);
}

export async function grantGlobalReset(user, chatId, messageId) {
  if (!isAdmin(user)) return;
  const result = await database().prepare(`
    INSERT OR IGNORE INTO usage_reset_credits
      (id,participant_id,grant_key,granted_by_telegram_user_id)
    SELECT lower(hex(randomblob(16))),p.id,?,?
    FROM participants p
    WHERE p.status='active' AND p.telegram_user_id IS NOT NULL
    RETURNING participant_id
  `).bind("global:" + berlinDate(), Number(user.telegram_user_id)).all();
  return render(chatId, messageId,
    "✅ <b>Resets vergeben</b>\n\nNeu gutgeschrieben: <b>" + Number(result?.results?.length || 0)
    + "</b>\nAlle Guthaben bleiben bis zur Einlösung gespeichert.",
    [[button("← Resets", "reset:admin:menu")]]);
}
