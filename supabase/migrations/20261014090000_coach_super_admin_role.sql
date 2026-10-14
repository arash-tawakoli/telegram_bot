-- Coach Portal Super Admin role marker and admin-member management guard.
-- The stored role stays `admin` so all existing admin RPCs remain compatible.
-- `is_super_admin` is the externally visible elevated role and is allowlisted to Arash.

alter table public.coaching_members
  add column if not exists is_super_admin boolean not null default false;

alter table public.coaching_members
  drop constraint if exists coaching_members_super_admin_role_check;

alter table public.coaching_members
  add constraint coaching_members_super_admin_role_check
  check (not is_super_admin or role='admin');

create table if not exists app_private.coaching_super_admin_allowlist (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

revoke all on table app_private.coaching_super_admin_allowlist
  from public, anon, authenticated;

create unique index if not exists coaching_members_one_super_admin_per_workspace_idx
  on public.coaching_members(workspace_id)
  where is_super_admin;

create or replace function app_private.coaching_super_admin_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.is_super_admin
     and (new.role<>'admin' or not exists(
       select 1
       from app_private.coaching_super_admin_allowlist
       where auth_user_id=new.auth_user_id
     ))
  then
    raise exception 'super_admin_not_allowed';
  end if;

  if tg_op='UPDATE'
     and old.is_super_admin
     and (
       not new.is_super_admin
       or not new.is_active
       or new.auth_user_id is distinct from old.auth_user_id
     )
  then
    raise exception 'super_admin_protected';
  end if;

  return new;
end
$function$;

revoke all on function app_private.coaching_super_admin_guard()
  from public, anon, authenticated;

drop trigger if exists coaching_super_admin_guard
  on public.coaching_members;

create trigger coaching_super_admin_guard
before insert or update of auth_user_id, role, is_active, is_super_admin
on public.coaching_members
for each row
execute function app_private.coaching_super_admin_guard();

-- Resolve the one existing active admin named Arash. Fail closed if the
-- production identity is ambiguous or missing.
do $$
declare
  v_count integer;
  v_auth_user uuid;
begin
  select count(*) into v_count
  from public.coaching_members
  where role='admin'
    and is_active
    and lower(btrim(display_name))='arash';

  if v_count<>1 then
    raise exception 'super_admin_assignment_target_not_found';
  end if;

  select auth_user_id into v_auth_user
  from public.coaching_members
  where role='admin'
    and is_active
    and lower(btrim(display_name))='arash'
  limit 1;

  insert into app_private.coaching_super_admin_allowlist(auth_user_id)
  values(v_auth_user)
  on conflict(auth_user_id) do nothing;

  update public.coaching_members
  set is_super_admin=true,
      updated_at=now()
  where auth_user_id=v_auth_user;
end
$$;

-- Super Admin may manage regular Admin members. Regular Admins may still
-- manage Managers only; Super Admin itself remains protected.
create or replace function public.coach_prepare_member_deletion(
  p_actor uuid,
  p_member uuid,
  p_target uuid default null
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_actor public.coaching_members%rowtype;
  v_member public.coaching_members%rowtype;
  v_count integer;
begin
  select * into v_actor
  from public.coaching_members
  where id=p_actor and is_active
  for share;

  if not found or v_actor.role<>'admin' then
    raise exception 'admin_required';
  end if;

  if not exists(
    select 1
    from public.coaching_workspaces
    where id=v_actor.workspace_id and is_active and not operations_paused
  )
  then
    raise exception 'workspace_unavailable';
  end if;

  if p_actor=p_member or p_target=p_member then
    raise exception 'coach_unavailable';
  end if;

  select * into v_member
  from public.coaching_members
  where id=p_member
    and workspace_id=v_actor.workspace_id
    and (
      role='coach'
      or (role='admin' and v_actor.is_super_admin)
    )
  for update;

  if not found or v_member.is_super_admin then
    raise exception 'super_admin_protected';
  end if;

  if p_target is not null then
    perform 1
    from public.coaching_members
    where id=p_target
      and workspace_id=v_actor.workspace_id
      and role='coach'
      and is_active
    for share;

    if not found then
      raise exception 'coach_unavailable';
    end if;
  end if;

  update public.coaching_members
  set is_active=false,
      updated_at=now()
  where id=p_member;

  update public.coaching_participants
  set coach_member_id=p_target,
      assignment_version=assignment_version+1,
      updated_at=now()
  where workspace_id=v_actor.workspace_id
    and coach_member_id=p_member;

  get diagnostics v_count=row_count;

  update public.platform_auth_flows
  set consumed_at=coalesce(consumed_at,now())
  where issued_by=v_member.auth_user_id
    and consumed_at is null;

  update app_private.telegram_link_tokens
  set invalidated_at=coalesce(invalidated_at,now())
  where created_by=v_member.auth_user_id
    and consumed_at is null;

  update storage.objects
  set owner=v_actor.auth_user_id,
      owner_id=v_actor.auth_user_id::text
  where owner=v_member.auth_user_id
     or owner_id=v_member.auth_user_id::text;

  insert into public.coaching_audit_events(
    workspace_id,actor_member_id,action,changes
  )
  values(
    v_actor.workspace_id,
    p_actor,
    'coach_deletion_prepared',
    jsonb_build_object(
      'member_id',p_member,
      'target_member_id',p_target,
      'participants_preserved',v_count
    )
  );

  return jsonb_build_object(
    'auth_user_id',v_member.auth_user_id,
    'participants_preserved',v_count
  );
end
$function$;

revoke all on function public.coach_prepare_member_deletion(uuid,uuid,uuid)
  from public, anon, authenticated;

grant execute on function public.coach_prepare_member_deletion(uuid,uuid,uuid)
  to service_role;
