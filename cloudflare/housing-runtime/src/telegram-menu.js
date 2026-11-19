// The chat menu button shows the bot's command list; the Wohnungs-App stays reachable
// via the BotFather main Mini App ("Open"), the start menu button and /app.
export const MENU_BUTTON = Object.freeze({ type: "commands" });
const MARKER = "telegram_menu_commands_v1";

// One-shot: chats that already got the old per-chat web_app button keep it until reset.
export async function migrateMenuButtons(sql, env, fetchImpl = fetch) {
  const token = String(env?.TELEGRAM_BOT_TOKEN || "");
  if (!token) return { skipped: "no_token" };
  if ((await sql`SELECT 1 FROM housing.audit_events WHERE event_type = ${MARKER} LIMIT 1`).length) return { skipped: "done" };
  const call = (body) => fetchImpl(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }).then((response) => response.ok).catch(() => false);
  if (!await call({ menu_button: MENU_BUTTON })) return { skipped: "default_failed" };
  const chats = await sql`SELECT DISTINCT telegram_user_id FROM housing.participants WHERE telegram_user_id IS NOT NULL`;
  let updated = 0;
  // Blocked or deleted chats fail individually; the marker is still written so this never repeats.
  for (const { telegram_user_id } of chats) if (await call({ chat_id: Number(telegram_user_id), menu_button: MENU_BUTTON })) updated++;
  await sql`INSERT INTO housing.audit_events (event_type, metadata) VALUES (${MARKER}, ${JSON.stringify({ chats: chats.length, updated })})`;
  return { chats: chats.length, updated };
}
