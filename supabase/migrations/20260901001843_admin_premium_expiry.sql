alter table public.bot_users
  add column if not exists plan_override_expires_at timestamptz;
