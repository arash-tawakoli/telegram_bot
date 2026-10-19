-- Permanently delete a participant from Telegram data and the internal portal in one database transaction.
-- The coaching_participants.user_id foreign key cascades on bot_users deletion, keeping the portal in sync.
create or replace function public.coach_delete_participant_permanently(p_actor uuid,p_user uuid)
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

  if exists(select 1 from public.telegram_announcements where created_by=p_user) then
    raise exception 'participant_delete_restricted';
  end if;

  insert into public.coaching_audit_events(
    workspace_id,actor_member_id,participant_user_id,action,changes
  ) values(
    v_actor.workspace_id,v_actor.id,p_user,'participant_deleted_permanently',
    jsonb_build_object('telegram_linked',v_telegram_user_id is not null,'portal_removed',true)
  );

  -- platform_sessions uses ON DELETE RESTRICT, so remove these before deleting the user.
  delete from public.platform_sessions where user_id=p_user;
  delete from public.bot_users where id=p_user;

  -- bot_users deletion cascades to coaching_participants and the participant's related application data.
  return 'deleted_permanently';
end
$function$;

revoke all on function public.coach_delete_participant_permanently(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.coach_delete_participant_permanently(uuid,uuid)
  to service_role;
