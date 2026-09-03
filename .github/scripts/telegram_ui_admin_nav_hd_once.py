from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import base64
import math
import re

index_path = Path("supabase/functions/telegram-ui/index.ts")
i18n_path = Path("supabase/functions/telegram-ui/i18n.ts")
source = index_path.read_text()
i18n = i18n_path.read_text()

# Rebuild the existing simple Premium visual at HD resolution.
size = 1200
img = Image.new("RGB", (size, size))
px = img.load()
for y in range(size):
    fy = y / (size - 1)
    for x in range(size):
        fx = x / (size - 1)
        t = 0.58 * fx + 0.42 * fy
        c1, c2 = (249, 20, 154), (255, 227, 199)
        r = int(c1[0] * (1 - t) + c2[0] * t)
        g = int(c1[1] * (1 - t) + c2[1] * t)
        b = int(c1[2] * (1 - t) + c2[2] * t)
        dx = (x - size * 0.76) / (size * 0.55)
        dy = (y - size * 0.72) / (size * 0.55)
        bloom = max(0.0, 1.0 - math.sqrt(dx * dx + dy * dy)) * 0.17
        px[x, y] = (
            int(r * (1 - bloom) + 255 * bloom),
            int(g * (1 - bloom) + 245 * bloom),
            int(b * (1 - bloom) + 229 * bloom),
        )

draw = ImageDraw.Draw(img)
font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
draw.text((145, 245), "50", font=ImageFont.truetype(font_path, 515), fill="white")
draw.text((690, 225), "%", font=ImageFont.truetype(font_path, 245), fill="white")
draw.text((700, 570), "OFF", font=ImageFont.truetype(font_path, 210), fill="white")
asset = Path("/tmp/premium-hd.jpg")
img.save(asset, "JPEG", quality=88, optimize=True, progressive=True, subsampling=0)
raw = asset.read_bytes()
if len(raw) < 40000 or not raw.startswith(b"\xff\xd8"):
    raise SystemExit("HD Premium image generation failed")

b64 = base64.b64encode(raw).decode()
chunks = [b64[i:i + 6000] for i in range(0, len(b64), 6000)]
replacement = "const PREMIUM_PREVIEW_B64 = [\n" + "".join(
    f'  "{chunk}",\n' for chunk in chunks
) + '].join("");'
source, count = re.subn(
    r'const PREMIUM_PREVIEW_B64 = (?:"[^"]+"|\[.*?\]\.join\(""\));',
    replacement,
    source,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("Premium image constant anchor missing")

# Existing owner + Khan.
if "const ADMIN_TELEGRAM_USER_ID = 8538226539;" not in source:
    raise SystemExit("admin constant anchor missing")
source = source.replace(
    "const ADMIN_TELEGRAM_USER_ID = 8538226539;",
    "const ADMIN_TELEGRAM_USER_IDS = new Set([8538226539, 414638980]);",
    1,
)
if "return Number(user?.telegram_user_id) === ADMIN_TELEGRAM_USER_ID;" not in source:
    raise SystemExit("isAdmin anchor missing")
source = source.replace(
    "return Number(user?.telegram_user_id) === ADMIN_TELEGRAM_USER_ID;",
    "return ADMIN_TELEGRAM_USER_IDS.has(Number(user?.telegram_user_id));",
    1,
)

# Keep a banned existing user banned on the next message.
if "    is_active: true,\n" not in source:
    raise SystemExit("ensureUser active anchor missing")
source = source.replace(
    "    is_active: true,\n",
    "    is_active: existing?.is_active ?? true,\n",
    1,
)

home = '''function homeKeyboard(user: any) {
  const rows: any[] = [];
  if (user.onboarding_step) {
    rows.push([button("▶️ Entwurf fortsetzen", "draft")]);
  }
  rows.push(
    [
      button("🔎 Suchprofil", "profile"),
      button("⭐️ Gespeichert", "saved"),
    ],
    [
      button("⚙️ Einstellungen", "settings"),
      button("❓ Hilfe", "help"),
    ],
    [button("🎁 30 Tage Premium für 0 €", "referral")],
  );
  return { inline_keyboard: rows };
}'''
source, count = re.subn(
    r'function homeKeyboard\(user: any\) \{.*?\n\}\n\nconst HELP_TEXT',
    home + "\n\nconst HELP_TEXT",
    source,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("homeKeyboard anchor missing")

if 'rows.push([button("← Start", "home")]);' not in source:
    raise SystemExit("saved Start button anchor missing")
source = source.replace(
    'rows.push([button("← Start", "home")]);',
    'rows.push([button("✖️ Abbrechen", "home")]);',
    1,
)

if "asset=premium&v=20260903b" not in source:
    raise SystemExit("premium cache key anchor missing")
source = source.replace(
    "asset=premium&v=20260903b",
    "asset=premium&v=20260903hd",
    1,
)

old_referral = 'const text = `🎁 <b>Freunde empfehlen</b>\\n\\nEmpfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos 💎\\n\\nErfolgreiche Empfehlungen: ${count || 0}`;\n  const markup = { inline_keyboard: [[button("← Einstellungen", "settings")]] };'
new_referral = 'const text = `🎁 <b>30 Tage Premium für 0 €</b>\\n\\nEmpfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎\\n\\nErfolgreiche Empfehlungen: ${count || 0}`;\n  const markup = { inline_keyboard: [[button("← Zurück", "home")]] };'
if old_referral not in source:
    raise SystemExit("referral page anchor missing")
source = source.replace(old_referral, new_referral, 1)

if "base + 7 * 86400000" not in source:
    raise SystemExit("referrer bonus anchor missing")
source = source.replace("base + 7 * 86400000", "base + 30 * 86400000", 1)
if "Number(referrer?.referral_bonus_days || 0) + 7" not in source:
    raise SystemExit("referrer days anchor missing")
source = source.replace(
    "Number(referrer?.referral_bonus_days || 0) + 7",
    "Number(referrer?.referral_bonus_days || 0) + 30",
    1,
)

settings = '''async function settings(user: any, chatId: number, messageId?: number) {
  const text = "⚙️ <b>Einstellungen</b>\\n\\nVerwalte hier Premium, Sprache und Systemstatus.";
  const markup = { inline_keyboard: [
    [button(user.is_premium ? "💎 Premium aktiv" : "💎 Premium", "premium")],
    [button("🌐 Sprachen", "language"), button("📡 Systemstatus", "status")],
    [button("← Zurück", "home")],
  ]};
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}'''
source, count = re.subn(
    r'async function settings\(user: any, chatId: number, messageId\?: number\) \{.*?\n\}\n\nasync function handleMessage',
    settings + "\n\nasync function handleMessage",
    source,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("settings anchor missing")

old = '.select("id,telegram_user_id,first_name,last_name,username,plan_override,plan_override_expires_at,referral_bonus_until,created_at")\n    .eq("is_active", true)\n    .order("created_at");'
new = '.select("id,telegram_user_id,first_name,last_name,username,is_active,plan_override,plan_override_expires_at,referral_bonus_until,created_at")\n    .order("created_at");'
if old not in source:
    raise SystemExit("admin users query anchor missing")
source = source.replace(old, new, 1)

old = '`${premium ? "💎" : "▫️"} ${name} · ${premium ? "PREMIUM" : "FREE"}`'
new = '`${entry.is_active ? (premium ? "💎" : "▫️") : "🚫"} ${name} · ${entry.is_active ? (premium ? "PREMIUM" : "FREE") : "GESPERRT"}`'
if old not in source:
    raise SystemExit("admin list label anchor missing")
source = source.replace(old, new, 1)

old = '  if (!rows.length) rows.push([button("Keine aktiven Nutzer", "noop")]);\n  const text = `🔒 <b>Admin</b>\\n\\nAktive Nutzer: ${users?.length || 0}`;'
new = '  if (!rows.length) rows.push([button("Keine Nutzer", "noop")]);\n  const blocked = (users || []).filter((entry: any) => !entry.is_active).length;\n  const text = `🔒 <b>Admin</b>\\n\\nNutzer: ${users?.length || 0} · gesperrt: ${blocked}`;'
if old not in source:
    raise SystemExit("admin summary anchor missing")
source = source.replace(old, new, 1)

old = '  if (error) throw error;\n  if (!target?.is_active) return adminUsers(user, chatId, messageId);\n\n  const { data: subscription'
new = '  if (error) throw error;\n  if (!target) return adminUsers(user, chatId, messageId);\n\n  const { data: subscription'
if old not in source:
    raise SystemExit("admin target anchor missing")
source = source.replace(old, new, 1)

old = '`Stripe: ${esc(String(subscription?.status || "inactive").toUpperCase())}`;'
new = '`Stripe: ${esc(String(subscription?.status || "inactive").toUpperCase())}\\n` +\n    `Zugriff: <b>${target.is_active ? "AKTIV" : "GESPERRT"}</b>`;'
if old not in source:
    raise SystemExit("admin detail text anchor missing")
source = source.replace(old, new, 1)

old_markup = '''      [button("Free setzen", `admin:set:${userId}:free`)],
      [button("← Nutzer", "admin:list")],'''
new_markup = '''      [button("Free setzen", `admin:set:${userId}:free`)],
      ...(isAdmin(target)
        ? [[button("🔒 Admin-Konto", "noop")]]
        : [
            [button(target.is_active ? "🚫 Nutzer sperren" : "✅ Nutzer entsperren", target.is_active ? `admin:block:${userId}` : `admin:unblock:${userId}`)],
            [button("🗑 Nutzer löschen", `admin:delete:${userId}`)],
          ]),
      [button("← Nutzer", "admin:list")],'''
if old_markup not in source:
    raise SystemExit("admin controls anchor missing")
source = source.replace(old_markup, new_markup, 1)

admin_helpers = '''
async function setUserBlocked(userId: string, blocked: boolean) {
  const { data: target, error: targetError } = await db
    .from("bot_users")
    .select("id,telegram_user_id,is_active")
    .eq("id", userId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new Error("user unavailable");
  if (isAdmin(target)) throw new Error("admin accounts cannot be blocked");

  const { error } = await db
    .from("bot_users")
    .update({ is_active: !blocked, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;

  if (blocked) {
    const { error: profileError } = await db
      .from("search_profiles")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (profileError) throw profileError;
  }
}

async function deleteUser(userId: string) {
  const { data: target, error: targetError } = await db
    .from("bot_users")
    .select("id,telegram_user_id")
    .eq("id", userId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) return;
  if (isAdmin(target)) throw new Error("admin accounts cannot be deleted");

  const { error } = await db.from("bot_users").delete().eq("id", userId);
  if (error) throw error;
}

'''
anchor = "async function setPlanOverride(userId: string, grant: AdminGrant) {"
if anchor not in source:
    raise SystemExit("setPlanOverride anchor missing")
source = source.replace(anchor, admin_helpers + anchor, 1)

source = source.replace(
    '    .eq("id", userId)\n    .eq("is_active", true)\n    .select("id,chat_id")',
    '    .eq("id", userId)\n    .select("id,chat_id")',
    1,
)

admin_callbacks = '''  if (data.startsWith("admin:block:")) {
    const userId = data.slice("admin:block:".length);
    try {
      await setUserBlocked(userId, true);
      await acknowledge(query.id, "Nutzer gesperrt");
    } catch (error) {
      await acknowledge(query.id, String(error).includes("admin accounts") ? "Admin-Konto geschützt" : "Sperren fehlgeschlagen");
    }
    return adminUser(user, chatId, messageId, userId);
  }
  if (data.startsWith("admin:unblock:")) {
    const userId = data.slice("admin:unblock:".length);
    try {
      await setUserBlocked(userId, false);
      await acknowledge(query.id, "Nutzer entsperrt");
    } catch (error) {
      await acknowledge(query.id, String(error).includes("admin accounts") ? "Admin-Konto geschützt" : "Entsperren fehlgeschlagen");
    }
    return adminUser(user, chatId, messageId, userId);
  }
  if (data.startsWith("admin:delete-confirm:")) {
    const userId = data.slice("admin:delete-confirm:".length);
    try {
      await deleteUser(userId);
      await acknowledge(query.id, "Nutzer gelöscht");
    } catch (error) {
      await acknowledge(query.id, String(error).includes("admin accounts") ? "Admin-Konto geschützt" : "Löschen fehlgeschlagen");
    }
    return adminUsers(user, chatId, messageId);
  }
  if (data.startsWith("admin:delete:")) {
    const userId = data.slice("admin:delete:".length);
    await acknowledge(query.id);
    return edit(
      chatId,
      messageId,
      "🗑 <b>Nutzer wirklich löschen?</b>\\n\\nSuchprofile, gespeicherte Inserate, Referral- und Abo-Zuordnungen werden dauerhaft gelöscht.",
      { inline_keyboard: [
        [button("🗑 Ja, endgültig löschen", `admin:delete-confirm:${userId}`)],
        [button("← Abbrechen", `admin:user:${userId}`)],
      ] },
    );
  }
'''
anchor = '  if (data.startsWith("admin:set:")) {'
if anchor not in source:
    raise SystemExit("admin callback anchor missing")
source = source.replace(anchor, admin_callbacks + anchor, 1)

anchor = '    const user = await withPlan(await ensureUser(from, Number(chatId)));\n    chatLanguages.set(Number(chatId), String(user.ui_language || "de"));'
replacement_gate = '    const user = await withPlan(await ensureUser(from, Number(chatId)));\n    if (!user.is_active && !isAdmin(user)) {\n      return Response.json({ ok: true, blocked: true });\n    }\n    chatLanguages.set(Number(chatId), String(user.ui_language || "de"));'
if anchor not in source:
    raise SystemExit("runtime gate anchor missing")
source = source.replace(anchor, replacement_gate, 1)

additions = '''
Object.assign(EXTRA.en, {"30 Tage Premium für 0 €":"30 days Premium for €0","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎":"Recommend Traumwohnung Hamburg and you both receive 30 days Premium for free 💎","Abbrechen":"Cancel"});
Object.assign(EXTRA.tr, {"30 Tage Premium für 0 €":"0 €'ya 30 Gün Premium","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎":"Traumwohnung Hamburg'u önerin; ikiniz de 30 gün Premium'u ücretsiz alın 💎","Abbrechen":"İptal"});
Object.assign(EXTRA.ru, {"30 Tage Premium für 0 €":"30 дней Premium за 0 €","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎":"Порекомендуйте Traumwohnung Hamburg — вы оба получите 30 дней Premium бесплатно 💎","Abbrechen":"Отмена"});
Object.assign(EXTRA.ar, {"30 Tage Premium für 0 €":"30 يوم Premium مقابل 0 €","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎":"رشّح Traumwohnung Hamburg وسيحصل كلاكما على 30 يومًا من Premium مجانًا 💎","Abbrechen":"إلغاء"});
Object.assign(EXTRA.fa, {"30 Tage Premium für 0 €":"۳۰ روز Premium با ۰ €","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎":"Traumwohnung Hamburg را معرفی کنید و هر دوی شما ۳۰ روز Premium رایگان دریافت می‌کنید 💎","Abbrechen":"لغو"});
Object.assign(EXTRA.prs, {"30 Tage Premium für 0 €":"۳۰ روز Premium با ۰ €","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎":"Traumwohnung Hamburg را معرفی کنید و هر دوی شما ۳۰ روز Premium رایگان دریافت می‌کنید 💎","Abbrechen":"لغو"});
Object.assign(EXTRA.ckb, {"30 Tage Premium für 0 €":"٣٠ ڕۆژ Premium بە ٠ €","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎":"Traumwohnung Hamburg پێشنیار بکە و هەردووکتان ٣٠ ڕۆژ Premium بەخۆڕایی وەردەگرن 💎","Abbrechen":"هەڵوەشاندنەوە"});
Object.assign(EXTRA.ku, {"30 Tage Premium für 0 €":"30 roj Premium bi 0 €","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎":"Traumwohnung Hamburg pêşniyar bike û hûn herdu 30 roj Premium belaş bistînin 💎","Abbrechen":"Betal bike"});
'''
if "const CURRENT_ALIASES:" not in i18n:
    raise SystemExit("i18n alias anchor missing")
i18n = i18n.replace("const CURRENT_ALIASES:", additions + "\nconst CURRENT_ALIASES:", 1)

migration = '''create or replace function public.redeem_referral_code(
  p_referred_user_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referrer_user_id uuid;
  v_referral_id uuid;
  v_premium_until timestamptz;
begin
  if p_referred_user_id is null or nullif(trim(p_code), '') is null then
    return jsonb_build_object('status', 'invalid_code');
  end if;

  select rc.user_id into v_referrer_user_id
  from public.referral_codes rc
  where lower(rc.code) = lower(trim(p_code))
  limit 1;

  if v_referrer_user_id is null then
    return jsonb_build_object('status', 'invalid_code');
  end if;
  if v_referrer_user_id = p_referred_user_id then
    return jsonb_build_object('status', 'self_referral');
  end if;

  select r.id, r.premium_granted_until into v_referral_id, v_premium_until
  from public.referrals r
  where r.referred_user_id = p_referred_user_id
  limit 1;

  if v_referral_id is not null then
    return jsonb_build_object('status', 'already_redeemed', 'premium_until', v_premium_until);
  end if;

  select greatest(now(), coalesce(u.referral_bonus_until, now())) + interval '30 days'
    into v_premium_until
  from public.bot_users u
  where u.id = p_referred_user_id
  for update;

  if v_premium_until is null then
    return jsonb_build_object('status', 'user_not_found');
  end if;

  insert into public.referrals(
    referrer_user_id,
    referred_user_id,
    status,
    qualified_at,
    rewarded_at,
    premium_granted_until
  ) values (
    v_referrer_user_id,
    p_referred_user_id,
    'rewarded',
    now(),
    now(),
    v_premium_until
  )
  on conflict (referred_user_id) do nothing
  returning id into v_referral_id;

  if v_referral_id is null then
    select r.premium_granted_until into v_premium_until
    from public.referrals r
    where r.referred_user_id = p_referred_user_id;
    return jsonb_build_object('status', 'already_redeemed', 'premium_until', v_premium_until);
  end if;

  update public.bot_users
  set referral_bonus_until = v_premium_until,
      referral_bonus_days = referral_bonus_days + 30,
      updated_at = now()
  where id = p_referred_user_id;

  return jsonb_build_object(
    'status', 'granted',
    'premium_until', v_premium_until,
    'referrer_user_id', v_referrer_user_id
  );
end
$$;
'''

checks = [
    "🎁 30 Tage Premium für 0 €",
    "ADMIN_TELEGRAM_USER_IDS",
    "414638980",
    "admin:block:",
    "admin:unblock:",
    "admin:delete-confirm:",
    "is_active: existing?.is_active ?? true",
    "asset=premium&v=20260903hd",
    "base + 30 * 86400000",
]
for check in checks:
    if check not in source:
        raise SystemExit(f"missing expected patch: {check}")

index_path.write_text(source)
i18n_path.write_text(i18n)
Path("supabase/migrations/202609030001_referral_bonus_30_days.sql").write_text(migration)
print("HD premium bytes:", len(raw))
