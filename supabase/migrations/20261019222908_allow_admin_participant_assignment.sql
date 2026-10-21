-- RECONSTRUCTED EQUIVALENT from the live catalog captured 2026-10-21.
-- Original historical SQL bytes were not recoverable; this migration restores the observed contract.

CREATE OR REPLACE FUNCTION public.coach_assign_unassigned_participant(p_actor uuid, p_user uuid, p_coach uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

revoke all on function public.coach_assign_unassigned_participant(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.coach_assign_unassigned_participant(uuid,uuid,uuid) to service_role;
