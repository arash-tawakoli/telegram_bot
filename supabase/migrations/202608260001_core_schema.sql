create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.bot_users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  chat_id bigint not null unique,
  username text,
  first_name text,
  last_name text,
  language_code text,
  onboarding_step text,
  onboarding_state jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.search_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.bot_users(id) on delete cascade,
  name text not null default 'Meine Suche',
  max_warm_rent numeric(10,2),
  min_rooms numeric(4,1),
  min_area_sqm numeric(8,2),
  districts text[] not null default array['Ganz Hamburg']::text[],
  property_types text[] not null default array['Wohnung']::text[],
  furnished_preference text not null default 'any' check (furnished_preference in ('any','yes','no')),
  wbs_only boolean not null default false,
  move_in_from date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists search_profiles_user_idx on public.search_profiles(user_id);
create index if not exists search_profiles_active_idx on public.search_profiles(is_active) where is_active=true;

create table if not exists public.sources (
  id smallint primary key,
  source_type text not null,
  name text not null unique,
  tier text not null check (tier in ('K1','K2','K3')),
  homepage_url text,
  search_url text,
  poll_interval_minutes integer not null check (poll_interval_minutes >= 5),
  enabled boolean not null default true,
  notes text,
  warmed_up boolean not null default false,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  consecutive_failures integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sources_due_idx on public.sources(enabled,last_checked_at);

create table if not exists public.source_connectors (
  id bigint generated always as identity primary key,
  source_id smallint not null references public.sources(id) on delete cascade,
  priority smallint not null check (priority between 1 and 3),
  label text not null,
  connector_kind text not null,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_id,priority)
);
create index if not exists source_connectors_source_idx on public.source_connectors(source_id,priority);

create table if not exists public.crawl_runs (
  id uuid primary key default gen_random_uuid(),
  source_id smallint not null references public.sources(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  success boolean,
  connector_priority smallint,
  connector_label text,
  fetched_count integer not null default 0,
  inserted_count integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists crawl_runs_source_started_idx on public.crawl_runs(source_id,started_at desc);

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  source_id smallint not null references public.sources(id) on delete cascade,
  source_listing_key text not null,
  external_id text,
  canonical_url text not null,
  title text,
  address text,
  district text,
  postal_code text,
  city text not null default 'Hamburg',
  warm_rent numeric(10,2),
  cold_rent numeric(10,2),
  rooms numeric(4,1),
  area_sqm numeric(8,2),
  available_from date,
  property_type text,
  furnished boolean,
  wbs_required boolean,
  image_url text,
  cross_source_hash text,
  raw jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique(source_id,source_listing_key)
);
create index if not exists listings_seen_idx on public.listings(first_seen_at desc);
create index if not exists listings_active_idx on public.listings(is_active,last_seen_at desc);
create index if not exists listings_match_idx on public.listings(warm_rent,rooms,area_sqm);
create index if not exists listings_cross_hash_idx on public.listings(cross_source_hash) where cross_source_hash is not null;

create table if not exists public.delivery_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.search_profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  dedupe_key text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  telegram_message_id bigint,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(profile_id,dedupe_key)
);
create index if not exists delivery_events_profile_idx on public.delivery_events(profile_id,created_at desc);

create table if not exists public.bot_events (
  id bigint generated always as identity primary key,
  telegram_update_id bigint unique,
  event_type text not null,
  telegram_user_id bigint,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings(key,value) values
  ('source_dispatch','{"max_sources_per_run":4,"worker_concurrency":4}'::jsonb),
  ('telegram','{"max_profiles_per_user":3}'::jsonb)
on conflict (key) do update set value=excluded.value,updated_at=now();

alter table public.bot_users enable row level security;
alter table public.search_profiles enable row level security;
alter table public.sources enable row level security;
alter table public.source_connectors enable row level security;
alter table public.crawl_runs enable row level security;
alter table public.listings enable row level security;
alter table public.delivery_events enable row level security;
alter table public.bot_events enable row level security;
alter table public.app_settings enable row level security;

revoke all on table public.bot_users from anon,authenticated;
revoke all on table public.search_profiles from anon,authenticated;
revoke all on table public.sources from anon,authenticated;
revoke all on table public.source_connectors from anon,authenticated;
revoke all on table public.crawl_runs from anon,authenticated;
revoke all on table public.listings from anon,authenticated;
revoke all on table public.delivery_events from anon,authenticated;
revoke all on table public.bot_events from anon,authenticated;
revoke all on table public.app_settings from anon,authenticated;

create or replace function public.get_bot_secret(secret_name text)
returns text
language sql
security definer
set search_path=''
as $$
  select decrypted_secret from vault.decrypted_secrets where name=secret_name limit 1;
$$;
revoke all on function public.get_bot_secret(text) from public,anon,authenticated;
grant execute on function public.get_bot_secret(text) to service_role;

-- Runtime secrets are provisioned in Supabase Vault and are intentionally not stored here.
-- Required names: telegram_bot_token, telegram_webhook_secret, internal_worker_secret.
