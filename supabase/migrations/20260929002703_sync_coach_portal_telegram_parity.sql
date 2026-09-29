alter table public.applicant_profiles
  alter column phone drop not null;

create or replace function public.coach_create_participant(
  p_actor uuid,
  p_coach uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_city text default 'Hamburg'::text,
  p_household_size smallint default null::smallint
)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_actor public.coaching_members%rowtype;
  v_user uuid;
  v_public_id text;
  v_email text;
  v_phone text;
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
  then raise exception 'participant_fields_required'; end if;

  v_email:=nullif(lower(btrim(coalesce(p_email,''))),'');
  if v_email is not null and v_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'invalid_email';
  end if;
  v_phone:=nullif(btrim(coalesce(p_phone,'')),'');

  insert into public.bot_users(
    telegram_user_id,chat_id,first_name,last_name,is_active,origin,plan_override
  )
  values(null,null,btrim(p_first_name),btrim(p_last_name),true,'coaching','free')
  returning id into v_user;

  insert into public.applicant_profiles(
    user_id,first_name,last_name,email,phone,city,household_size
  )
  values(
    v_user,btrim(p_first_name),btrim(p_last_name),v_email,
    v_phone,coalesce(nullif(btrim(p_city),''),'Hamburg'),p_household_size
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

create or replace function public.coach_create_participant_idempotent(
  p_actor uuid,
  p_coach uuid,
  p_request_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_city text default 'Hamburg'::text,
  p_household_size smallint default null::smallint
)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_actor public.coaching_members%rowtype;
  v_user uuid;
  v_existing_user uuid;
  v_existing_actor uuid;
  v_existing_workspace uuid;
  v_public_id text;
  v_claimed boolean := false;
  v_email text;
  v_phone text;
begin
  if p_request_id is null then
    raise exception 'request_id_required';
  end if;

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
  then raise exception 'participant_fields_required'; end if;

  v_email:=nullif(lower(btrim(coalesce(p_email,''))),'');
  if v_email is not null and v_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'invalid_email';
  end if;
  v_phone:=nullif(btrim(coalesce(p_phone,'')),'');

  insert into public.coaching_request_keys(
    request_id,workspace_id,actor_member_id,action
  )
  values(p_request_id,v_actor.workspace_id,v_actor.id,'create_participant')
  on conflict(request_id) do nothing;

  get diagnostics v_claimed = row_count;

  if not v_claimed then
    select participant_user_id,actor_member_id,workspace_id
      into v_existing_user,v_existing_actor,v_existing_workspace
    from public.coaching_request_keys
    where request_id=p_request_id;

    if v_existing_actor is distinct from v_actor.id
       or v_existing_workspace is distinct from v_actor.workspace_id then
      raise exception 'request_id_conflict';
    end if;

    if v_existing_user is not null then
      return v_existing_user;
    end if;

    raise exception 'request_in_progress';
  end if;

  insert into public.bot_users(
    telegram_user_id,chat_id,first_name,last_name,is_active,origin,plan_override
  )
  values(null,null,btrim(p_first_name),btrim(p_last_name),true,'coaching','free')
  returning id into v_user;

  insert into public.applicant_profiles(
    user_id,first_name,last_name,email,phone,city,household_size
  )
  values(
    v_user,btrim(p_first_name),btrim(p_last_name),v_email,
    v_phone,coalesce(nullif(btrim(p_city),''),'Hamburg'),p_household_size
  );

  v_public_id := 'cp_'||encode(extensions.gen_random_bytes(12),'hex');

  insert into public.coaching_participants(
    user_id,workspace_id,coach_member_id,created_by_member_id,status,public_id
  )
  values(v_user,v_actor.workspace_id,p_coach,v_actor.id,'active',v_public_id);

  update public.coaching_request_keys
  set participant_user_id=v_user
  where request_id=p_request_id;

  insert into public.coaching_audit_events(
    workspace_id,actor_member_id,participant_user_id,action,changes
  )
  values(
    v_actor.workspace_id,v_actor.id,v_user,'participant_created',
    jsonb_build_object('coach_member_id',p_coach,'request_id',p_request_id)
  );

  return v_user;
end
$function$;

create or replace function public.coach_set_application_preferences(
  p_actor uuid,
  p_user uuid,
  p_enabled boolean,
  p_daily_limit integer,
  p_timezone text,
  p_weekdays smallint[],
  p_window_start time without time zone,
  p_window_end time without time zone,
  p_immoscout boolean,
  p_kleinanzeigen boolean,
  p_immomio boolean,
  p_immowelt boolean
)
returns boolean
language plpgsql
set search_path to ''
as $function$
declare
  v_actor public.coaching_members%rowtype;
  v_current public.application_preferences%rowtype;
  v_global boolean;
begin
  select * into v_actor
  from public.coaching_members
  where id=p_actor and is_active;

  if not found or not app_private.coaching_actor_can_access(v_actor.id,p_user,false) then
    raise exception 'participant_forbidden';
  end if;

  select coalesce(b.auto_apply_enabled,false)
  into v_global
  from public.bot_users b
  where b.id=p_user and b.is_active;

  if not found then raise exception 'participant_unavailable'; end if;

  select * into v_current
  from public.application_preferences
  where user_id=p_user;

  insert into public.application_preferences(
    user_id,enabled,daily_limit,timezone,allowed_weekdays,
    send_window_start,send_window_end,
    immoscout_enabled,kleinanzeigen_enabled,immomio_enabled,immowelt_enabled
  )
  values(
    p_user,v_global,p_daily_limit,coalesce(nullif(p_timezone,''),'Europe/Berlin'),
    coalesce(p_weekdays,array[1,2,3,4,5,6,7]::smallint[]),
    p_window_start,p_window_end,
    coalesce(v_current.immoscout_enabled,false),
    coalesce(v_current.kleinanzeigen_enabled,false),
    coalesce(v_current.immomio_enabled,false),
    coalesce(v_current.immowelt_enabled,false)
  )
  on conflict(user_id) do update
  set daily_limit=excluded.daily_limit,
      timezone=excluded.timezone,
      allowed_weekdays=excluded.allowed_weekdays,
      send_window_start=excluded.send_window_start,
      send_window_end=excluded.send_window_end;

  if coalesce(v_current.immoscout_enabled,false) is distinct from coalesce(p_immoscout,false) then
    perform public.set_application_provider_enabled_shared(p_user,'immoscout',coalesce(p_immoscout,false));
  end if;
  if coalesce(v_current.kleinanzeigen_enabled,false) is distinct from coalesce(p_kleinanzeigen,false) then
    perform public.set_application_provider_enabled_shared(p_user,'kleinanzeigen',coalesce(p_kleinanzeigen,false));
  end if;
  if coalesce(v_current.immomio_enabled,false) is distinct from coalesce(p_immomio,false) then
    perform public.set_application_provider_enabled_shared(p_user,'immomio',coalesce(p_immomio,false));
  end if;
  if coalesce(v_current.immowelt_enabled,false) is distinct from coalesce(p_immowelt,false) then
    perform public.set_application_provider_enabled_shared(p_user,'immowelt',coalesce(p_immowelt,false));
  end if;

  if v_global is distinct from coalesce(p_enabled,false) then
    perform public.set_application_enabled_shared(p_user,coalesce(p_enabled,false));
  end if;

  insert into public.coaching_audit_events(
    workspace_id,actor_member_id,participant_user_id,action,changes
  )
  values(
    v_actor.workspace_id,v_actor.id,p_user,'application_preferences_changed',
    jsonb_build_object(
      'enabled',coalesce(p_enabled,false),
      'daily_limit',p_daily_limit,
      'timezone',coalesce(nullif(p_timezone,''),'Europe/Berlin'),
      'providers',jsonb_build_object(
        'immoscout',coalesce(p_immoscout,false),
        'kleinanzeigen',coalesce(p_kleinanzeigen,false),
        'immomio',coalesce(p_immomio,false),
        'immowelt',coalesce(p_immowelt,false)
      )
    )
  );

  return true;
end
$function$;

create or replace function public.coach_set_application_preferences(
  p_actor uuid,
  p_user uuid,
  p_enabled boolean,
  p_daily_limit integer,
  p_timezone text,
  p_weekdays smallint[],
  p_window_start time without time zone,
  p_window_end time without time zone,
  p_immoscout boolean,
  p_kleinanzeigen boolean,
  p_immomio boolean
)
returns boolean
language plpgsql
set search_path to ''
as $function$
declare
  v_immowelt boolean;
begin
  select coalesce(immowelt_enabled,false)
  into v_immowelt
  from public.application_preferences
  where user_id=p_user;

  return public.coach_set_application_preferences(
    p_actor,p_user,p_enabled,p_daily_limit,p_timezone,p_weekdays,
    p_window_start,p_window_end,p_immoscout,p_kleinanzeigen,p_immomio,
    coalesce(v_immowelt,false)
  );
end
$function$;

create or replace function public.coach_set_plan(p_actor uuid, p_user uuid, p_plan text)
returns boolean
language plpgsql
set search_path to ''
as $function$
declare
  v_actor public.coaching_members%rowtype;
  v_old text;
begin
  if p_plan not in ('free','premium') then raise exception 'invalid_plan'; end if;

  select * into v_actor
  from public.coaching_members
  where id=p_actor and is_active;

  if not found or v_actor.role<>'admin' then raise exception 'admin_required'; end if;

  if not app_private.coaching_actor_can_access(v_actor.id,p_user,true) then
    raise exception 'participant_forbidden';
  end if;

  select plan_override into v_old
  from public.bot_users
  where id=p_user
  for update;

  update public.bot_users
  set plan_override=p_plan,plan_override_expires_at=null,updated_at=now()
  where id=p_user;

  if p_plan='free' then
    perform public.set_application_enabled_shared(p_user,false);
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
