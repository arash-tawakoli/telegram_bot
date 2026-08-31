alter table public.bot_users
  add column if not exists plan_override text;

alter table public.bot_users
  drop constraint if exists bot_users_plan_override_check;

alter table public.bot_users
  add constraint bot_users_plan_override_check
  check (plan_override is null or plan_override in ('free', 'premium'));
