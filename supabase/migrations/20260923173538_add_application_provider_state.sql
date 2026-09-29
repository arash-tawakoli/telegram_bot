alter table public.applications
  add column if not exists provider_state jsonb not null default '{}'::jsonb;

comment on column public.applications.provider_state is
  'Provider-specific non-secret application outcome details used for user-facing status rendering.';
