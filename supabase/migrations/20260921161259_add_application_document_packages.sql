create table if not exists public.application_document_packages (
  application_id uuid primary key references public.applications(id) on delete cascade,
  user_id uuid not null references public.bot_users(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.application_document_packages enable row level security;
revoke all on table public.application_document_packages from anon, authenticated;
grant select,insert,update,delete on table public.application_document_packages to service_role;

comment on table public.application_document_packages is
  'Private expiring application-document package tokens used when a provider contact channel has no native attachment transport.';
