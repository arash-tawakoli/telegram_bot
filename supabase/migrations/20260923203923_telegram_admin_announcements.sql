create table if not exists public.telegram_announcements (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.bot_users(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 3500),
  status text not null default 'draft' check (status in ('draft','sending','sent','partial','cancelled')),
  recipient_count integer not null default 0 check (recipient_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.telegram_announcements enable row level security;

create index if not exists telegram_announcements_created_at_idx
  on public.telegram_announcements(created_at desc);

revoke all on table public.telegram_announcements from anon, authenticated;
