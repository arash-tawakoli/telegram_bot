alter table public.bot_users
  add column if not exists plan_override_expires_at timestamptz;

select cron.schedule(
  'expire-admin-premium-overrides',
  '* * * * *',
  $$
    update public.bot_users
    set plan_override = null,
        plan_override_expires_at = null,
        updated_at = now()
    where plan_override = 'premium'
      and plan_override_expires_at is not null
      and plan_override_expires_at <= now();
  $$
);
