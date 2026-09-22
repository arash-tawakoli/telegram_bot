create index if not exists coaching_audit_actor_time_idx
  on public.coaching_audit_events(actor_member_id,created_at desc)
  where actor_member_id is not null;

create index if not exists coaching_participants_workspace_creator_idx
  on public.coaching_participants(workspace_id,created_by_member_id)
  where created_by_member_id is not null;

create or replace function app_private.coaching_actor_can_access(
  p_actor uuid,
  p_user uuid,
  p_admin_required boolean default false
)
returns boolean
language sql
stable
set search_path to ''
as $function$
  select exists(
    select 1
    from public.coaching_members m
    join public.coaching_workspaces w on w.id=m.workspace_id
    join public.coaching_participants cp on cp.workspace_id=m.workspace_id
    where m.id=p_actor
      and m.is_active
      and w.is_active
      and not w.operations_paused
      and cp.user_id=p_user
      and cp.status in ('active','archived','pending_deletion')
      and (m.role='admin' or (not p_admin_required and cp.coach_member_id=m.id))
  )
$function$;

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

  insert into public.coaching_participants(
    user_id,workspace_id,coach_member_id,created_by_member_id,status
  )
  values(v_user,v_actor.workspace_id,p_coach,v_actor.id,'active');

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

create or replace function public.coach_reassign_participant(
  p_actor uuid,
  p_user uuid,
  p_coach uuid
)
returns boolean
language plpgsql
set search_path to ''
as $function$
declare
  v_actor public.coaching_members%rowtype;
  v_old uuid;
begin
  select * into v_actor from public.coaching_members where id=p_actor and is_active;
  if not found or v_actor.role<>'admin' then raise exception 'admin_required'; end if;
  if not app_private.coaching_actor_can_access(v_actor.id,p_user,true) then
    raise exception 'participant_forbidden';
  end if;
  if not exists(
    select 1 from public.coaching_members
    where id=p_coach and workspace_id=v_actor.workspace_id and is_active
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
  )
  values(
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

create or replace function public.coach_set_plan(
  p_actor uuid,
  p_user uuid,
  p_plan text
)
returns boolean
language plpgsql
set search_path to ''
as $function$
declare
  v_actor public.coaching_members%rowtype;
  v_old text;
begin
  if p_plan not in ('free','premium') then raise exception 'invalid_plan'; end if;
  select * into v_actor from public.coaching_members where id=p_actor and is_active;
  if not found or v_actor.role<>'admin' then raise exception 'admin_required'; end if;
  if not app_private.coaching_actor_can_access(v_actor.id,p_user,true) then
    raise exception 'participant_forbidden';
  end if;

  select plan_override into v_old from public.bot_users where id=p_user for update;
  update public.bot_users
  set plan_override=p_plan,plan_override_expires_at=null,updated_at=now()
  where id=p_user;

  if p_plan='free' then
    update public.bot_users set auto_apply_enabled=false where id=p_user;
    update public.application_preferences set enabled=false where user_id=p_user;
  end if;

  insert into public.coaching_audit_events(
    workspace_id,actor_member_id,participant_user_id,action,changes
  )
  values(
    v_actor.workspace_id,v_actor.id,p_user,'plan_changed',
    jsonb_build_object('from',v_old,'to',p_plan)
  );
  return true;
end
$function$;

revoke all on function public.coach_set_plan(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.coach_set_plan(uuid,uuid,text) to service_role;

create or replace function public.coach_set_application_preferences(
  p_actor uuid,
  p_user uuid,
  p_enabled boolean,
  p_daily_limit integer,
  p_timezone text,
  p_weekdays smallint[],
  p_window_start time,
  p_window_end time,
  p_immoscout boolean,
  p_kleinanzeigen boolean,
  p_immomio boolean
)
returns boolean
language plpgsql
set search_path to ''
as $function$
declare
  v_actor public.coaching_members%rowtype;
begin
  select * into v_actor from public.coaching_members where id=p_actor and is_active;
  if not found or not app_private.coaching_actor_can_access(v_actor.id,p_user,false) then
    raise exception 'participant_forbidden';
  end if;

  if p_enabled and not app_private.user_is_premium(p_user) then
    raise exception 'premium_required';
  end if;

  insert into public.application_preferences(
    user_id,enabled,daily_limit,timezone,allowed_weekdays,
    send_window_start,send_window_end,
    immoscout_enabled,kleinanzeigen_enabled,immomio_enabled
  )
  values(
    p_user,p_enabled,p_daily_limit,coalesce(nullif(p_timezone,''),'Europe/Berlin'),
    coalesce(p_weekdays,array[1,2,3,4,5,6,7]::smallint[]),
    p_window_start,p_window_end,
    p_immoscout,p_kleinanzeigen,p_immomio
  )
  on conflict(user_id) do update
  set enabled=excluded.enabled,
      daily_limit=excluded.daily_limit,
      timezone=excluded.timezone,
      allowed_weekdays=excluded.allowed_weekdays,
      send_window_start=excluded.send_window_start,
      send_window_end=excluded.send_window_end,
      immoscout_enabled=excluded.immoscout_enabled,
      kleinanzeigen_enabled=excluded.kleinanzeigen_enabled,
      immomio_enabled=excluded.immomio_enabled;

  update public.bot_users
  set auto_apply_enabled=p_enabled,updated_at=now()
  where id=p_user;

  insert into public.coaching_audit_events(
    workspace_id,actor_member_id,participant_user_id,action,changes
  )
  values(
    v_actor.workspace_id,v_actor.id,p_user,'application_preferences_changed',
    jsonb_build_object(
      'enabled',p_enabled,
      'daily_limit',p_daily_limit,
      'timezone',coalesce(nullif(p_timezone,''),'Europe/Berlin'),
      'providers',jsonb_build_object(
        'immoscout',p_immoscout,
        'kleinanzeigen',p_kleinanzeigen,
        'immomio',p_immomio
      )
    )
  );
  return true;
end
$function$;

revoke all on function public.coach_set_application_preferences(
  uuid,uuid,boolean,integer,text,smallint[],time,time,boolean,boolean,boolean
) from public,anon,authenticated;
grant execute on function public.coach_set_application_preferences(
  uuid,uuid,boolean,integer,text,smallint[],time,time,boolean,boolean,boolean
) to service_role;
