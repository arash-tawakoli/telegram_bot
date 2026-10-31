export const ADMIN_TELEGRAM_USER_IDS = new Set([8538226539, 414638980]);

export function isTelegramAdminId(value: unknown): boolean {
  return ADMIN_TELEGRAM_USER_IDS.has(Number(value));
}

export async function isTelegramAdminUser(db: any, userId: string): Promise<boolean> {
  const { data, error } = await db
    .from('bot_users')
    .select('telegram_user_id,is_active')
    .eq('id', userId)
    .maybeSingle();
  return !error && data?.is_active === true && isTelegramAdminId(data?.telegram_user_id);
}
