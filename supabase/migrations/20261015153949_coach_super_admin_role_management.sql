-- Allow an active Super Admin to grant or revoke the Super Admin flag for another workspace member.
-- Stored role remains admin for Super Admins; is_super_admin carries the elevated capability.

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
  v_is_super_admin boolean;
  v_old_role text;
  v_old_is_super_admin boolean;
  v_active_super_admins integer;
begin
  case lower(btrim(coalesce(p_role,'')))
    when 'super_admin' then
      v_role='admin';
      v_is_super_admin=true;
    when 'admin' then
      v_role='admin';
      v_is_super_admin=false;
    when 'manager' then
      v_role='coach';
      v_is_super_admin=false;
    when 'coach' then
      v_role='coach';
      v_is_super_admin=false;
    else
      raise exception 'invalid_member_role';
  end case;

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

  if not found then
    raise exception 'member_management_forbidden';
  end if;

  v_old_role=v_member.role;
  v_old_is_super_admin=(v_member.is_super_admin is true);

  if v_old_is_super_admin and not v_is_super_admin then
    select count(*) into v_active_super_admins
    from public.coaching_members
    where workspace_id=v_actor.workspace_id
      and is_active
      and is_super_admin is true;
    if v_active_super_admins<=1 then
      raise exception 'super_admin_required';
    end if;
  end if;

  if v_old_role=v_role and v_old_is_super_admin=v_is_super_admin then
    return jsonb_build_object(
      'id',v_member.id,
      'display_name',v_member.display_name,
      'role',v_role,
      'is_super_admin',v_is_super_admin,
      'changed',false
    );
  end if;

  update public.coaching_members
  set role=v_role,
      is_super_admin=v_is_super_admin,
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
      'to_role',v_role,
      'from_is_super_admin',v_old_is_super_admin,
      'to_is_super_admin',v_is_super_admin
    )
  );

  return jsonb_build_object(
    'id',v_member.id,
    'display_name',v_member.display_name,
    'role',v_role,
    'is_super_admin',v_is_super_admin,
    'changed',true
  );
end
$function$;

revoke all on function public.coach_change_member_role(uuid,uuid,text)
  from public, anon, authenticated;

grant execute on function public.coach_change_member_role(uuid,uuid,text)
  to service_role;