alter table public.coaching_participants
  add column if not exists public_id text;

update public.coaching_participants
set public_id='cp_'||encode(extensions.gen_random_bytes(12),'hex')
where public_id is null;

alter table public.coaching_participants
  alter column public_id set not null;

create unique index if not exists coaching_participants_public_id_key
  on public.coaching_participants(public_id);

create or replace function app_private.coaching_user_from_public_id(
  p_actor uuid,
  p_public_id text,
  p_admin_required boolean default false
)
returns uuid
language sql
stable
set search_path to ''
as $function$
  select cp.user_id
  from public.coaching_members m
  join public.coaching_workspaces w on w.id=m.workspace_id
  join public.coaching_participants cp on cp.workspace_id=m.workspace_id
  where m.id=p_actor
    and m.is_active
    and w.is_active
    and not w.operations_paused
    and cp.public_id=p_public_id
    and cp.status in ('active','archived','pending_deletion')
    and (m.role='admin' or (not p_admin_required and cp.coach_member_id=m.id))
  limit 1
$function$;

revoke all on function app_private.coaching_user_from_public_id(uuid,text,boolean)
  from public,anon,authenticated;
