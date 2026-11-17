import { button, edit, runtimeEnv, send } from "./runtime.js";
import { effectivePremiumFor, isAdmin } from "./admin.js";

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
    SELECT p.status, p.plan_override, p.plan_override_expires_at, p.referral_bonus_until,
      (SELECT COUNT(*) FROM usage_reset_credits c
       WHERE c.participant_id=p.id AND c.redeemed_at IS NULL) AS available,
      EXISTS (
        SELECT 1 FROM user_subscriptions s
        WHERE s.participant_id=p.id AND s.provider='stripe'
          AND s.status IN ('active','trialing')
          AND (s.current_period_end IS NULL OR julianday(s.current_period_end)>julianday('now'))
      ) AS paid_active
    FROM participants p WHERE p.id=? AND p.status='active'
  `).bind(participantId).first();
}

function canRedeem(state) {
  return !!state && Number(state.available) > 0 && !Number(state.paid_active)
    && !effectivePremiumFor(state, null);
}

function render(chatId, messageId, text, rows) {
  const markup = { inline_keyboard: rows };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

export async function resetPage(user, chatId, messageId, note = "") {
  const state = await usageState(user.id);
  if (!state) return render(chatId, messageId,
    "Reset ist für dieses Konto nicht verfügbar.", [[button("← Einstellungen", "settings")]]);
  const available = Number(state.available || 0);
  const activePremium = Number(state.paid_active) || effectivePremiumFor(state, null);
  const info = available === 0
    ? "Du hast derzeit keinen Reset. Ein Admin kann dir weitere Resets schenken."
    : activePremium
      ? "Dein Premium-Zugang ist bereits aktiv. Deine Resets bleiben gespeichert und können später als Free-Nutzer eingelöst werden."
      : "Du nutzt Free. Aktiviere mit einem Reset 7 Tage Premium kostenlos.";
  return render(chatId, messageId,
    "♻️ <b>Premium-Reset</b>\n\nGespeicherte Resets: <b>" + available + "</b>\n\n"
    + "1 Reset = <b>7 Tage Premium</b>.\n"
    + info + (note ? "\n\n" + note : ""),
    [...(canRedeem(state) ? [[button("🎁 7 Tage Premium aktivieren", "reset:redeem")]] : []),
      [button("← Einstellungen", "settings")]]);
}

export async function redeemReset(user, chatId, messageId) {
  const state = await usageState(user.id);
  if (!canRedeem(state))
    return resetPage(user, chatId, messageId,
      "Kein Reset eingelöst: Premium ist bereits aktiv oder es ist kein Guthaben verfügbar.");

  const db = database();
  const credit = await db.prepare(`
    SELECT id FROM usage_reset_credits
    WHERE participant_id=? AND redeemed_at IS NULL
    ORDER BY granted_at,id LIMIT 1
  `).bind(user.id).first();
  if (!credit) return resetPage(user, chatId, messageId, "Kein Reset verfügbar.");

  // Transactionally redeem only for active Free accounts. Check again inside
  // the UPDATE to prevent double redemption or extending an existing Premium
  // subscription, referral bonus, or admin grant on concurrent callbacks.
  const now = new Date();
  const timestamp = now.toISOString();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const [consumed, upgraded] = await db.batch([
    db.prepare(`
      UPDATE usage_reset_credits SET redeemed_at=?
      WHERE id=? AND participant_id=? AND redeemed_at IS NULL
        AND EXISTS (
          SELECT 1 FROM participants p
          WHERE p.id=? AND p.status='active'
            AND NOT (COALESCE(p.plan_override,'')='premium'
              AND (p.plan_override_expires_at IS NULL OR julianday(p.plan_override_expires_at)>julianday(?)))
            AND NOT (p.referral_bonus_until IS NOT NULL
              AND julianday(p.referral_bonus_until)>julianday(?))
            AND NOT EXISTS (
              SELECT 1 FROM user_subscriptions s
              WHERE s.participant_id=p.id AND s.provider='stripe'
                AND s.status IN ('active','trialing')
                AND (s.current_period_end IS NULL OR julianday(s.current_period_end)>julianday(?))
            )
        )
      RETURNING id
    `).bind(timestamp, credit.id, user.id, user.id, timestamp, timestamp, timestamp),
    db.prepare(`
      UPDATE participants
      SET plan_override='premium', plan_override_expires_at=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='active'
        AND EXISTS (
          SELECT 1 FROM usage_reset_credits c
          WHERE c.id=? AND c.participant_id=? AND c.redeemed_at=?
        )
      RETURNING id
    `).bind(expires, user.id, credit.id, user.id, timestamp),
  ]);
  const success = consumed?.results?.length === 1 && upgraded?.results?.length === 1;
  return resetPage(user, chatId, messageId,
    success ? "✅ Premium ist für 7 Tage aktiviert." : "Kein Reset eingelöst. Bitte versuche es erneut.");
}

export async function adminResetMenu(user, chatId, messageId) {
  if (!isAdmin(user)) return;
  const result = await database().prepare(
    "SELECT COUNT(*) AS count FROM participants WHERE status='active' AND telegram_user_id IS NOT NULL"
  ).first();
  return render(chatId, messageId,
    "♻️ <b>Admin · Premium-Resets</b>\n\n"
    + "1 Reset = 7 Tage Premium für einen Free-Nutzer.\n"
    + "Resets können allen Nutzern gutgeschrieben werden, auch wenn Premium bereits aktiv ist."
    + "\nAktive Telegram-Nutzer: <b>" + Number(result?.count || 0) + "</b>"
    + "\n\nDie Einlösung erfolgt erst durch einen Free-Nutzer. Bestehende Abos bleiben unverändert.",
    [[button("👤 Nutzer auswählen", "reset:admin:users")],
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
        "🎁 <b>1 Premium-Reset geschenkt!</b>\n\nDu findest deinen Reset unter Einstellungen → Reset. "
        + "Sobald dein Konto Free ist, kannst du damit 7 Tage Premium aktivieren.")
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
    "🎁 <b>Globaler Premium-Reset · Bestätigung</b>\n\n"
    + "Aktive Nutzer ohne heutiges globales Geschenk: <b>" + eligible + "</b>\n"
    + "Jeder erhält 1 gespeicherten Reset für 7 Tage Premium."
    + "\nAktivieren können ihn nur Free-Nutzer; bestehendes Premium wird nicht verlängert.",
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
    "✅ <b>Premium-Resets vergeben</b>\n\nNeu gutgeschrieben: <b>" + Number(result?.results?.length || 0)
    + "</b>\nEin Reset kann als Free-Nutzer für 7 Tage Premium eingelöst werden.",
    [[button("← Resets", "reset:admin:menu")]]);
}
