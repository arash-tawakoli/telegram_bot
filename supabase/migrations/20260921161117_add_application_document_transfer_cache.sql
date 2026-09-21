create table if not exists public.application_document_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.bot_users(id) on delete cascade,
  document_id uuid not null references public.applicant_documents(id) on delete cascade,
  provider text not null,
  source_updated_at timestamptz not null,
  remote_identifier text,
  remote_payload jsonb not null default '{}'::jsonb,
  adopted_existing boolean not null default false,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_document_transfers_document_provider_key unique(document_id,provider),
  constraint application_document_transfers_provider_check check(provider='immomio')
);

alter table public.application_document_transfers enable row level security;
revoke all on table public.application_document_transfers from anon, authenticated;
grant select,insert,update,delete on table public.application_document_transfers to service_role;

comment on table public.application_document_transfers is
  'Provider-side document transfer cache for applicant documents; currently restricted to Immomio.';
