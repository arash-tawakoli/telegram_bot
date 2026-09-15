begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Minimal reusable applicant data. Keep this separate from the housing search profile.
create table public.applicant_profiles (
  user_id uuid primary key references public.bot_users(id) on delete cascade,
  salutation text,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  street text,
  house_number text,
  postcode text,
  city text not null default 'Hamburg',
  household_size smallint check (household_size between 1 and 20),
  employment_status text,
  monthly_net_income numeric(10,2) check (monthly_net_income is null or monthly_net_income >= 0),
  pets text,
  wbs_status text,
  move_in_date date,
  default_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(first_name)) between 1 and 120),
  check (length(trim(last_name)) between 1 and 120),
  check (length(trim(email)) between 3 and 320),
  check (length(trim(phone)) between 3 and 80),
  check (length(city) <= 120),
  check (default_message is null or length(default_message) <= 4000)
);
alter table public.applicant_profiles enable row level security;
revoke all on public.applicant_profiles from public,anon,authenticated;
grant select,insert,update,delete on public.applicant_profiles to service_role;

-- Long-lived platform credentials are encrypted by the Edge worker before storage.
create table public.platform_connections (
  user_id uuid not null references public.bot_users(id) on delete cascade,
  provider text not null check (provider in ('immoscout','kleinanzeigen','immomio')),
  status text not null default 'disconnected' check (status in ('disconnected','pending','connected','needs_login','error')),
  credential_ciphertext text,
  credential_iv text,
  key_version smallint not null default 1 check (key_version > 0),
  account_hint text,
  expires_at timestamptz,
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id,provider),
  check ((credential_ciphertext is null) = (credential_iv is null))
);
alter table public.platform_connections enable row level security;
revoke all on public.platform_connections from public,anon,authenticated;
grant select,insert,update,delete on public.platform_connections to service_role;
create index platform_connections_status_idx on public.platform_connections(provider,status);

-- Short-lived authorization state (for PKCE and future one-time platform handshakes).
create table public.platform_auth_flows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.bot_users(id) on delete cascade,
  provider text not null check (provider in ('immoscout','kleinanzeigen')),
  state text not null,
  code_verifier text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  consumed_at timestamptz,
  unique (provider,state),
  check (expires_at > created_at)
);
alter table public.platform_auth_flows enable row level security;
revoke all on public.platform_auth_flows from public,anon,authenticated;
grant select,insert,update,delete on public.platform_auth_flows to service_role;
create index platform_auth_flows_user_idx on public.platform_auth_flows(user_id,provider,expires_at desc);

-- Store the encryption key in Supabase Vault, never in application tables or source code.
do $vault$
begin
  if not exists (select 1 from vault.secrets where name='application_credential_key_v1') then
    perform vault.create_secret(encode(gen_random_bytes(32),'base64'),'application_credential_key_v1','Auto-apply credential encryption key v1');
  end if;
end $vault$;

create or replace function app_private.applicant_profile_complete(p_user uuid) returns boolean
language sql security definer set search_path='' stable as $$
  select exists(
    select 1 from public.applicant_profiles p
    where p.user_id=p_user
      and length(trim(p.first_name))>0
      and length(trim(p.last_name))>0
      and position('@' in p.email)>1
      and length(trim(p.phone))>=3
      and length(trim(p.city))>0
      and p.household_size is not null
  );
$$;
revoke all on function app_private.applicant_profile_complete(uuid) from public,anon,authenticated;
grant execute on function app_private.applicant_profile_complete(uuid) to service_role;

-- Any verified source may enqueue an application; provider-specific support remains
-- gated by app_private.application_platforms, which is intentionally empty until a
-- controlled authenticated submission test succeeds.
create or replace function app_private.enqueue_matched_application() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.applications(user_id,listing_id,source_id)
 select u.id,l.id,l.source_id
 from public.bot_users u
 join public.listings l on l.id=new.listing_id
 join app_private.application_platforms p on p.source_id=l.source_id and p.verified_at is not null
 where u.id=new.recipient_user_id
   and u.is_active
   and u.auto_apply_enabled
   and app_private.user_is_premium(u.id)
   and app_private.applicant_profile_complete(u.id)
   and l.is_active
   and app_private.current_listing_is_delivery_fresh(l.source_id,l.raw,l.fresh_delivery_eligible)
 on conflict(user_id,listing_id) do nothing;
 return new;
end $$;
revoke all on function app_private.enqueue_matched_application() from public,anon,authenticated;

-- Keep the durable remote-send boundary and add the applicant-profile guard.
create or replace function public.begin_application_submission(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare a public.applications%rowtype;
begin
  select * into a from public.applications where id=p_id for update;
  if not found or a.status<>'pending' or a.submission_started_at is not null then return false; end if;
  if not exists(
    select 1
    from public.bot_users u
    join public.listings l on l.id=a.listing_id
    join app_private.application_platforms p on p.source_id=l.source_id and p.verified_at is not null
    where u.id=a.user_id
      and u.is_active
      and u.auto_apply_enabled
      and app_private.user_is_premium(u.id)
      and app_private.applicant_profile_complete(u.id)
      and l.is_active
      and l.source_id=a.source_id
      and app_private.current_listing_is_delivery_fresh(l.source_id,l.raw,l.fresh_delivery_eligible)
      and exists(select 1 from public.delivery_events d where d.listing_id=l.id and d.recipient_user_id=u.id)
  ) then
    update public.applications set status='failed',last_error='not_eligible' where id=p_id;
    return false;
  end if;
  update public.applications
    set status='processing',attempts=attempts+1,submission_started_at=now()
    where id=p_id;
  return true;
end $$;
revoke all on function public.begin_application_submission(uuid) from public,anon,authenticated;
grant execute on function public.begin_application_submission(uuid) to service_role;

-- Bound short-lived auth-state growth without adding another cron invocation.
create or replace function app_private.cleanup_expired_platform_auth_flows() returns integer
language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
  with doomed as (
    select id from public.platform_auth_flows
    where expires_at < now() - interval '1 hour' or consumed_at < now() - interval '1 day'
    order by expires_at
    limit 500
  )
  delete from public.platform_auth_flows f using doomed d where f.id=d.id;
  get diagnostics removed = row_count;
  return removed;
end $$;
revoke all on function app_private.cleanup_expired_platform_auth_flows() from public,anon,authenticated;
grant execute on function app_private.cleanup_expired_platform_auth_flows() to service_role;

commit;
