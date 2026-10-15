-- Allow the allowlisted Super Admin to change regular Admin/Manager roles.
-- Stored roles remain admin/coach for compatibility; the Coach Portal maps coach to Manager.

create or replace function public.coach_change_member_role(
  p_actor uuid,
  p_member uuid,
  p_role text
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_actor public.coaching_members%rowtype;
  v_member public.coaching_members%rowtype;
  v_role text;
  v_old_role text;
begin
  v_role=case lower(btrim(coalesce(p_role,'')))
    when 'admin' then 'admin'
    when 'manager' then 'coach'
    when 'coach' then 'coach'
    else null
  end;

  if v_role is null then
    raise exception 'invalid_member_role';
  end if;

  select * into v_actor
  from public.coaching_members
  where id=p_actor
    and is_active
  for share;

  if not found
     or v_actor.role<>'admin'
     or v_actor.is_super_admin is not true
  then
    raise exception 'member_management_forbidden';
  end if;

  if p_actor=p_member then
    raise exception 'super_admin_protected';
  end if;

  select * into v_member
  from public.coaching_members
  where id=p_member
    and workspace_id=v_actor.workspace_id
  for update;

  if not found or v_member.is_super_admin is true then
    raise exception 'member_management_forbidden';
  end if;

  v_old_role=v_member.role;

  if v_old_role=v_role then
    return jsonb_build_object(
      'id',v_member.id,
      'display_name',v_member.display_name,
      'role',v_role,
      'changed',false
    );
  end if;

  update public.coaching_members
  set role=v_role,
      updated_at=now()
  where id=v_member.id;

  insert into public.coaching_audit_events(
    workspace_id,
    actor_member_id,
    action,
    changes
  )
  values(
    v_actor.workspace_id,
    v_actor.id,
    'coach_role_changed',
    jsonb_build_object(
      'member_id',v_member.id,
      'from_role',v_old_role,
      'to_role',v_role
    )
  );

  return jsonb_build_object(
    'id',v_member.id,
    'display_name',v_member.display_name,
    'role',v_role,
    'changed',true
  );
end
$function$;

revoke all on function public.coach_change_member_role(uuid,uuid,text)
  from public, anon, authenticated;

grant execute on function public.coach_change_member_role(uuid,uuid,text)
  to service_role;
