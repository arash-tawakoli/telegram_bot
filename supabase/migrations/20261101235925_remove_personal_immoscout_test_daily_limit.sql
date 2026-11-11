alter table public.bot_users
  alter column test_auto_apply_daily_limit drop not null;

comment on column public.bot_users.test_auto_apply_daily_limit is
  'NULL means unlimited daily applications for the explicitly allowlisted personal ImmoScout test account.';
