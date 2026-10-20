begin;

alter table app_private.telegram_link_tokens
  enable row level security;

alter table app_private.coach_bootstrap_tokens
  enable row level security;

alter table app_private.coaching_super_admin_allowlist
  enable row level security;

revoke all on table app_private.telegram_link_tokens from anon, authenticated, public;
revoke all on table app_private.coach_bootstrap_tokens from anon, authenticated, public;
revoke all on table app_private.coaching_super_admin_allowlist from anon, authenticated, public;

revoke usage on schema app_private from anon, authenticated, public;

commit;
