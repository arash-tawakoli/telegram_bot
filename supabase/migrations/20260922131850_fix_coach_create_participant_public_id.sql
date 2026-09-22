create or replace function public.coach_create_participant(
  p_actor uuid,
  p_coach uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_city text default 'Hamburg',
  p_household_size smallint default null
)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_actor public.coaching_members%rowtype;
  v_user uuid;
  v_public_id text;
begin
  select * into v_actor
  from public.coaching_members
  where id=p_actor and is_active
  for share;

  if not found then raise exception 'actor_forbidden'; end if;

  if not exists(
    select 1 from public.coaching_workspaces
    where id=v_actor.workspace_id and is_active and not operations_paused
  ) then raise exception 'workspace_unavailable'; end if;

  if p_coach<>v_actor.id and v_actor.role<>'admin' then
    raise exception 'admin_required';
  end if;

  if not exists(
    select 1 from public.coaching_members
    where id=p_coach and workspace_id=v_actor.workspace_id and is_active
  ) then raise exception 'coach_unavailable'; end if;

  if nullif(btrim(p_first_name),'') is null
     or nullif(btrim(p_last_name),'') is null
     or nullif(btrim(p_email),'') is null
     or nullif(btrim(p_phone),'') is null
  then raise exception 'participant_fields_required'; end if;

  insert into public.bot_users(
    telegram_user_id,chat_id,first_name,last_name,is_active,origin,plan_override
  )
  values(null,null,btrim(p_first_name),btrim(p_last_name),true,'coaching','free')
  returning id into v_user;

  insert into public.applicant_profiles(
    user_id,first_name,last_name,email,phone,city,household_size
  )
  values(
    v_user,btrim(p_first_name),btrim(p_last_name),lower(btrim(p_email)),
    btrim(p_phone),coalesce(nullif(btrim(p_city),''),'Hamburg'),p_household_size
  );

  v_public_id := 'cp_'||encode(extensions.gen_random_bytes(12),'hex');

  insert into public.coaching_participants(
    user_id,workspace_id,coach_member_id,created_by_member_id,status,public_id
  )
  values(v_user,v_actor.workspace_id,p_coach,v_actor.id,'active',v_public_id);

  insert into public.coaching_audit_events(
    workspace_id,actor_member_id,participant_user_id,action,changes
  )
  values(
    v_actor.workspace_id,v_actor.id,v_user,'participant_created',
    jsonb_build_object('coach_member_id',p_coach)
  );

  return v_user;
end
$function$;

revoke all on function public.coach_create_participant(uuid,uuid,text,text,text,text,text,smallint)
  from public,anon,authenticated;
grant execute on function public.coach_create_participant(uuid,uuid,text,text,text,text,text,smallint)
  to service_role;
