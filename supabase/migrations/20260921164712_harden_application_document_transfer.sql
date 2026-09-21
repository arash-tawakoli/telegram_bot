create table if not exists public.application_document_package_items (
  application_id uuid not null references public.application_document_packages(application_id) on delete cascade,
  document_id uuid not null references public.applicant_documents(id) on delete cascade,
  ordinal smallint not null,
  original_filename text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  primary key(application_id,document_id),
  unique(application_id,ordinal),
  constraint application_document_package_items_ordinal_check check (ordinal between 0 and 99),
  constraint application_document_package_items_mime_check check (
    mime_type = any(array['application/pdf','image/jpeg','image/png']::text[])
  ),
  constraint application_document_package_items_size_check check (size_bytes between 1 and 6291456)
);

alter table public.application_document_package_items enable row level security;
revoke all on table public.application_document_package_items from anon, authenticated;
grant select,insert,update,delete on table public.application_document_package_items to service_role;

comment on table public.application_document_package_items is
  'Immutable-at-send document selection snapshot for an application package. Selection changes after package creation do not alter the package.';

alter table public.application_document_transfers
  drop constraint if exists application_document_transfers_document_id_fkey;

alter table public.application_document_transfers
  alter column document_id drop not null;

alter table public.application_document_transfers
  add constraint application_document_transfers_document_id_fkey
  foreign key (document_id)
  references public.applicant_documents(id)
  on delete set null;
