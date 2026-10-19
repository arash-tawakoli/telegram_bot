-- Keep participant permissions in the API and SQL boundary, not only in the UI.
-- New portal-created identities receive Premium; Telegram identities retain their existing plan.

create or replace function app_private.coaching_participant_premium_default()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.origin='coaching' and new.telegram_user_id is null then
    new.plan_override='premium';
    new.plan_override_expires_at=null;
  end if;
  return new;
end
$function$;

revoke all on function app_private.coaching_participant_premium_default()
  from public,anon,authenticated;

drop trigger if exists coaching_participant_premium_default on public.bot_users;
create trigger coaching_participant_premium_default
before insert on public.bot_users
for each row
when (new.origin='coaching' and new.telegram_user_id is null)
execute function app_private.coaching_participant_premium_default();

-- Admins and Super Admins may be assignment targets. The API still authorizes who may assign.
create or replace function app_private.coaching_manager_assignment_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_member public.coaching_members%rowtype;
begin
  if new.coach_member_id is null then return new; end if;
  if tg_op='UPDATE'
     and new.coach_member_id is not distinct from old.coach_member_id
     and new.workspace_id is not distinct from old.workspace_id then
    return new;
  end if;
  select * into v_member
  from public.coaching_members
  where id=new.coach_member_id
    and workspace_id=new.workspace_id
    and role in ('coach','admin')
    and is_active
  for share;
  if not found then raise exception 'coach_unavailable'; end if;
  return new;
end
$function$;

revoke all on function app_private.coaching_manager_assignment_guard()
  from public,anon,authenticated;

create or replace function public.coach_adopt_participant(p_actor uuid,p_user uuid,p_coach uuid)
returns text
language plpgsql
set search_path to ''
as $function$
declare
  v_actor public.coaching_members%rowtype;
  v_public_id text;
begin
  select * into v_actor
  from public.coaching_members
  where id=p_actor and is_active
  for share;
  if not found or v_actor.role<>'admin' then raise exception 'admin_required'; end if;
  if not exists(
    select 1 from public.coaching_workspaces
    where id=v_actor.workspace_id and is_active and not operations_paused
  ) then raise exception 'workspace_unavailable'; end if;
  if p_coach is null or not exists(
    select 1 from public.coaching_members
    where id=p_coach and workspace_id=v_actor.workspace_id
      and is_active and role in ('coach','admin')
    for share
  ) then raise exception 'coach_unavailable'; end if;
  if not exists(select 1 from public.bot_users where id=p_user) then
    raise exception 'participant_unavailable';
  end if;
  if exists(select 1 from public.coaching_participants where user_id=p_user) then
    raise exception 'participant_already_assigned';
  end if;
  v_public_id := 'cp_'||encode(extensions.gen_random_bytes(12),'hex');
  insert into public.coaching_participants(
    user_id,workspace_id,coach_member_id,created_by_member_id,status,public_id
  ) values(p_user,v_actor.workspace_id,p_coach,v_actor.id,'active',v_public_id);
  insert into public.coaching_audit_events(
    workspace_id,actor_member_id,participant_user_id,action,changes
  ) values(
    v_actor.workspace_id,v_actor.id,p_user,'participant_adopted',
    jsonb_build_object('coach_member_id',p_coach,'preserved_existing_identity',true)
  );
  return v_public_id;
end
$function$;

revoke all on function public.coach_adopt_participant(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.coach_adopt_participant(uuid,uuid,uuid)
  to service_role;

create or replace function public.coach_reassign_participant(p_actor uuid,p_user uuid,p_coach uuid)
returns boolean
language plpgsql
set search_path to ''
as $function$
declare
  v_actor public.coaching_members%rowtype;
  v_old uuid;
begin
  select * into v_actor
  from public.coaching_members
  where id=p_actor and is_active;
  if not found or v_actor.role<>'admin' then raise exception 'admin_required'; end if;
  if not app_private.coaching_actor_can_access(v_actor.id,p_user,true) then
    raise exception 'participant_forbidden';
  end if;
  if p_coach is not null and not exists(
    select 1 from public.coaching_members
    where id=p_coach and workspace_id=v_actor.workspace_id
      and is_active and role in ('coach','admin')
    for share
  ) then raise exception 'coach_unavailable'; end if;
  select coach_member_id into v_old
  from public.coaching_participants
  where user_id=p_user
  for update;
  update public.coaching_participants
  set coach_member_id=p_coach,
      assignment_version=assignment_version+1,
      updated_at=now()
  where user_id=p_user;
  insert into public.coaching_audit_events(
    workspace_id,actor_member_id,participant_user_id,action,changes
  ) values(
    v_actor.workspace_id,v_actor.id,p_user,'participant_reassigned',
    jsonb_build_object('from',v_old,'to',p_coach)
  );
  return true;
end
$function$;

revoke all on function public.coach_reassign_participant(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.coach_reassign_participant(uuid,uuid,uuid)
  to service_role;

-- Import flow may assign an automatically enrolled Telegram identity only while it is unassigned.
create or replace function public.coach_assign_unassigned_participant(
  p_actor uuid,p_user uuid,p_coach uuid
)
returns boolean
language plpgsql
set search_path to ''
as $function$
declare
  v_actor public.coaching_members%rowtype;
  v_assignment public.coaching_participants%rowtype;
  v_updated integer;
begin
  select * into v_actor
  from public.coaching_members
  where id=p_actor and is_active
  for share;
  if not found or v_actor.role<>'admin' then raise exception 'admin_required'; end if;
  if not exists(
    select 1 from public.coaching_workspaces
    where id=v_actor.workspace_id and is_active and not operations_paused
  ) then raise exception 'workspace_unavailable'; end if;
  select * into v_assignment
  from public.coaching_participants
  where user_id=p_user and workspace_id=v_actor.workspace_id
  for update;
  if not found then raise exception 'participant_forbidden'; end if;
  if v_assignment.coach_member_id is not null then
    raise exception 'participant_already_assigned';
  end if;
  if p_coach is null or not exists(
    select 1 from public.coaching_members
    where id=p_coach and workspace_id=v_actor.workspace_id
      and is_active and role in ('coach','admin')
    for share
  ) then raise exception 'coach_unavailable'; end if;
  update public.coaching_participants
  set coach_member_id=p_coach,
      assignment_version=assignment_version+1,
      updated_at=now()
  where user_id=p_user and workspace_id=v_actor.workspace_id
    and coach_member_id is null;
  get diagnostics v_updated = row_count;
  if v_updated<>1 then raise exception 'participant_already_assigned'; end if;
  insert into public.coaching_audit_events(
    workspace_id,actor_member_id,participant_user_id,action,changes
  ) values(
    v_actor.workspace_id,v_actor.id,p_user,'participant_assigned',
    jsonb_build_object('from',null,'to',p_coach,'source','telegram_import')
  );
  return true;
end
$function$;

revoke all on function public.coach_assign_unassigned_participant(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.coach_assign_unassigned_participant(uuid,uuid,uuid)
  to service_role;

-- Telegram identities are removed from the internal portal only; their Telegram data remains.
-- Portal-only identities are deleted with their dependent database records.
create or replace function public.coach_delete_participant(p_actor uuid,p_user uuid)
returns text
language plpgsql
set search_path to ''
as $function$
declare
  v_actor public.coaching_members%rowtype;
  v_assignment public.coaching_participants%rowtype;
  v_telegram_user_id bigint;
begin
  select * into v_actor
  from public.coaching_members
  where id=p_actor and is_active
  for share;
  if not found or v_actor.role not in ('coach','admin') then
    raise exception 'coach_forbidden';
  end if;
  if not exists(
    select 1 from public.coaching_workspaces
    where id=v_actor.workspace_id and is_active and not operations_paused
  ) then raise exception 'workspace_unavailable'; end if;
  select * into v_assignment
  from public.coaching_participants
  where user_id=p_user and workspace_id=v_actor.workspace_id
  for update;
  if not found then raise exception 'participant_forbidden'; end if;
  if v_actor.role<>'admin' and v_assignment.coach_member_id is distinct from v_actor.id then
    raise exception 'participant_forbidden';
  end if;
  select telegram_user_id into v_telegram_user_id
  from public.bot_users
  where id=p_user
  for update;
  if not found then raise exception 'participant_forbidden'; end if;

  if v_telegram_user_id is not null then
    insert into public.coaching_audit_events(
      workspace_id,actor_member_id,participant_user_id,action,changes
    ) values(
      v_actor.workspace_id,v_actor.id,p_user,'participant_removed_from_portal',
      jsonb_build_object('telegram_data_preserved',true)
    );
    delete from public.coaching_participants
    where user_id=p_user and workspace_id=v_actor.workspace_id;
    return 'removed_from_portal';
  end if;

  if exists(select 1 from public.telegram_announcements where created_by=p_user) then
    raise exception 'participant_delete_restricted';
  end if;
  insert into public.coaching_audit_events(
    workspace_id,actor_member_id,participant_user_id,action,changes
  ) values(
    v_actor.workspace_id,v_actor.id,p_user,'participant_deleted',
    jsonb_build_object('telegram_data_preserved',false)
  );
  delete from public.platform_sessions where user_id=p_user;
  delete from public.bot_users where id=p_user;
  return 'deleted';
end
$function$;

revoke all on function public.coach_delete_participant(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.coach_delete_participant(uuid,uuid)
  to service_role;
