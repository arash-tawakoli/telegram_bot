insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'applicant-documents',
  'applicant-documents',
  false,
  6291456,
  array['application/pdf','image/jpeg','image/png']::text[]
)
on conflict (id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types,
    updated_at=now();

create table if not exists public.applicant_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.bot_users(id) on delete cascade,
  document_type text not null,
  original_filename text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null,
  send_with_auto_apply boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint applicant_documents_type_check check (
    document_type = any(array[
      'wbs',
      'urgency_certificate',
      'guarantee',
      'schufa',
      'income_proof',
      'rent_clearance',
      'other'
    ]::text[])
  ),
  constraint applicant_documents_mime_check check (
    mime_type = any(array[
      'application/pdf',
      'image/jpeg',
      'image/png'
    ]::text[])
  ),
  constraint applicant_documents_size_check check (
    size_bytes between 1 and 6291456
  ),
  constraint applicant_documents_filename_check check (
    char_length(original_filename) between 1 and 180
  ),
  constraint applicant_documents_path_owner_check check (
    storage_path like user_id::text || '/%'
  )
);

create index if not exists applicant_documents_user_idx
  on public.applicant_documents(user_id, created_at desc);

create index if not exists applicant_documents_selected_idx
  on public.applicant_documents(user_id, document_type)
  where send_with_auto_apply=true;

alter table public.applicant_documents enable row level security;

revoke all on table public.applicant_documents from anon, authenticated;
grant select, insert, update, delete on table public.applicant_documents to service_role;

comment on table public.applicant_documents is
  'Private applicant document metadata. File bytes live in the private applicant-documents Storage bucket.';
comment on column public.applicant_documents.send_with_auto_apply is
  'Explicit user opt-in. A provider worker may use the file only when its verified transport supports applicant attachments.';
