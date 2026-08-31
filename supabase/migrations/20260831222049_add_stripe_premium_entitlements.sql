drop index if exists public.search_profiles_one_per_user_idx;

alter table public.search_profiles
  add column if not exists profile_slot smallint not null default 1;

alter table public.search_profiles
  drop constraint if exists search_profiles_profile_slot_check;
alter table public.search_profiles
  add constraint search_profiles_profile_slot_check
  check (profile_slot between 1 and 3);

create unique index if not exists search_profiles_user_slot_uidx
  on public.search_profiles (user_id, profile_slot);

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.bot_users(id) on delete cascade,
  provider text not null default 'stripe' check (provider = 'stripe'),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'inactive'
    check (status in ('inactive','active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  last_event_created bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_subscriptions_status_idx
  on public.user_subscriptions (status, current_period_end);

alter table public.user_subscriptions enable row level security;
revoke all on public.user_subscriptions from anon, authenticated;
grant all on public.user_subscriptions to service_role;

create or replace function app_private.user_is_premium(p_user uuid)
returns boolean language sql stable set search_path=''
as $function$
  select exists (
    select 1
    from public.user_subscriptions s
    where s.user_id = p_user
      and s.status in ('active','trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$function$;

create or replace function app_private.enforce_search_profile_limit()
returns trigger language plpgsql set search_path=''
as $function$
begin
  if new.profile_slot < 1 or new.profile_slot > 3 then
    raise exception 'invalid_profile_slot' using errcode='23514';
  end if;
  if new.profile_slot > 1 and not app_private.user_is_premium(new.user_id) then
    raise exception 'premium_required_for_profile_slot' using errcode='23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists search_profiles_enforce_plan_limit on public.search_profiles;
create trigger search_profiles_enforce_plan_limit
before insert or update on public.search_profiles
for each row execute function app_private.enforce_search_profile_limit();
