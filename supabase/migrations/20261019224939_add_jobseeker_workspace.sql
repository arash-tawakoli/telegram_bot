-- RECONSTRUCTED EQUIVALENT from the live catalog captured 2026-10-21.
-- Original historical SQL bytes were not recoverable; this migration restores the observed contract.

create table if not exists public.jobseeker_profiles (
  user_id uuid primary key references public.bot_users(id) on delete cascade,
  target_roles text[] not null default '{}'::text[],
  skills text[] not null default '{}'::text[],
  education text,
  experience_level text check (experience_level is null or experience_level = any(array['entry','mid','senior']::text[])),
  preferred_locations text[] not null default '{}'::text[],
  remote_preference text not null default 'any' check (remote_preference = any(array['any','remote_only','onsite_only']::text[])),
  min_salary numeric,
  salary_period text not null default 'YEARLY' check (salary_period = any(array['HOURLY','MONTHLY','YEARLY']::text[])),
  cv_text text,
  default_cover_letter text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.job_search_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.bot_users(id) on delete cascade,
  name text not null default 'Meine Jobsuche',
  search text not null,
  location text not null default 'Hamburg',
  country_code char(2) not null default 'DE',
  education text,
  experience_level text check (experience_level is null or experience_level = any(array['entry','mid','senior']::text[])),
  job_type text check (job_type is null or job_type = any(array['fulltime','parttime','contract','internship','temporary']::text[])),
  remote_only boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists job_search_profiles_user_idx on public.job_search_profiles(user_id,updated_at desc);
create table if not exists public.job_application_preferences (
  user_id uuid primary key references public.bot_users(id) on delete cascade,
  enabled boolean not null default false,
  daily_limit integer check (daily_limit is null or (daily_limit > 0 and daily_limit <= 100)),
  timezone text not null default 'Europe/Berlin',
  allowed_weekdays smallint[] not null default array[1,2,3,4,5,6,7]::smallint[],
  send_window_start time,
  send_window_end time,
  updated_at timestamptz not null default now()
);
create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.bot_users(id) on delete cascade,
  search_profile_id uuid references public.job_search_profiles(id) on delete set null,
  source text not null default 'indeed' check (source='indeed'),
  external_id text,
  title text not null,
  company text,
  location text,
  url text not null,
  status text not null default 'saved' check (status = any(array['saved','queued','applying','applied','manual_required','failed','cancelled']::text[])),
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists job_applications_source_external_idx
  on public.job_applications(user_id,source,external_id) where external_id is not null;
create index if not exists job_applications_user_idx on public.job_applications(user_id,updated_at desc);
alter table public.jobseeker_profiles enable row level security;
alter table public.job_search_profiles enable row level security;
alter table public.job_application_preferences enable row level security;
alter table public.job_applications enable row level security;
revoke all on table public.jobseeker_profiles,public.job_search_profiles,public.job_application_preferences,public.job_applications from public,anon,authenticated;
grant all on table public.jobseeker_profiles,public.job_search_profiles,public.job_application_preferences,public.job_applications to service_role;
