create table if not exists public.immomio_object_resolution_shadow (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  source_id smallint not null references public.sources(id) on delete cascade,
  status text not null check (status in ('resolved','missing','conflict','error','skipped')),
  source_identifier uuid,
  apply_url text,
  method text not null,
  evidence_url text,
  checked_at timestamptz not null default now(),
  next_check_at timestamptz not null default now(),
  error text,
  evidence jsonb not null default '{}'::jsonb,
  constraint immomio_object_resolution_shadow_resolved_ck check (
    (status = 'resolved'
      and source_identifier is not null
      and apply_url is not null
      and apply_url ~ '^https://tenant[.]immomio[.]com/(de/)?apply/[0-9a-fA-F-]{36}$')
    or
    (status <> 'resolved' and source_identifier is null and apply_url is null)
  )
);

alter table public.immomio_object_resolution_shadow enable row level security;

revoke all on table public.immomio_object_resolution_shadow from public, anon, authenticated;
grant select, insert, update, delete on table public.immomio_object_resolution_shadow to service_role;

create index if not exists immomio_object_resolution_shadow_due_idx
  on public.immomio_object_resolution_shadow(next_check_at, source_id)
  where status <> 'resolved';

create index if not exists immomio_object_resolution_shadow_source_status_idx
  on public.immomio_object_resolution_shadow(source_id, status);

comment on table public.immomio_object_resolution_shadow is
  'Read-only/shadow evidence for exact tenant.immomio.com/apply object resolution. Never changes listings or delivery routing.';
