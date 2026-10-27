create table if not exists public.coach_resume_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.coaching_workspaces(id) on delete cascade,
  owner_member_id uuid not null references public.coaching_members(id) on delete cascade,
  title text not null default 'Mein Lebenslauf',
  resume_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_resume_drafts_title_length check (char_length(title) between 1 and 120),
  constraint coach_resume_drafts_data_object check (jsonb_typeof(resume_data) = 'object')
);

create index if not exists coach_resume_drafts_owner_updated_idx
  on public.coach_resume_drafts(workspace_id, owner_member_id, updated_at desc);

alter table public.coach_resume_drafts enable row level security;

revoke all on table public.coach_resume_drafts from public, anon, authenticated;
grant all on table public.coach_resume_drafts to service_role;

drop policy if exists coach_resume_drafts_service_role_only on public.coach_resume_drafts;
create policy coach_resume_drafts_service_role_only
  on public.coach_resume_drafts
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.coach_resume_drafts is
  'Private, coach-owned resume drafts; all access is mediated by the authenticated coach-api.';
