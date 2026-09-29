create or replace function app_private.application_provider_preference_enabled(
  p_user uuid,
  p_provider text
)
returns boolean
language sql
stable
set search_path to ''
as $function$
  select coalesce((
    select p.enabled
      and case p_provider
        when 'immoscout' then coalesce(p.immoscout_enabled,false)
        when 'kleinanzeigen' then coalesce(p.kleinanzeigen_enabled,false)
        when 'immomio' then coalesce(p.immomio_enabled,false)
        else false
      end
    from public.application_preferences p
    where p.user_id=p_user
  ),false)
$function$;

create or replace function public.set_application_enabled_shared(
  p_user uuid,
  p_enabled boolean
)
returns boolean
language plpgsql
set search_path to ''
as $function$
begin
  if not exists(select 1 from public.bot_users where id=p_user and is_active) then
    raise exception 'participant_unavailable';
  end if;
  if p_enabled and not app_private.user_is_premium(p_user) then
    raise exception 'premium_required';
  end if;

  insert into public.application_preferences(
    user_id,enabled,immoscout_enabled,kleinanzeigen_enabled,immomio_enabled
  )
  values(p_user,p_enabled,p_enabled,p_enabled,p_enabled)
  on conflict(user_id) do update
  set enabled=excluded.enabled,
      updated_at=now();

  update public.bot_users
  set auto_apply_enabled=p_enabled,updated_at=now()
  where id=p_user;

  if not p_enabled then
    update public.applications
    set status='failed',
        last_error='auto_apply_disabled',
        wait_reason=null,
        lease_until=null,
        next_attempt_at=null
    where user_id=p_user
      and status='pending'
      and submission_started_at is null;
  end if;

  return true;
end
$function$;

create or replace function app_private.sync_legacy_auto_apply_preferences()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  insert into public.application_preferences(
    user_id,enabled,immoscout_enabled,kleinanzeigen_enabled,immomio_enabled
  )
  values(
    new.id,
    new.auto_apply_enabled,
    new.auto_apply_enabled,
    new.auto_apply_enabled,
    new.auto_apply_enabled
  )
  on conflict (user_id) do update
  set enabled=excluded.enabled,
      updated_at=now();

  if not new.auto_apply_enabled then
    update public.applications
    set status='failed',
        last_error='auto_apply_disabled',
        wait_reason=null,
        lease_until=null,
        next_attempt_at=null
    where user_id=new.id
      and status='pending'
      and submission_started_at is null;
  end if;

  return new;
end
$function$;

create or replace function public.set_application_provider_enabled_shared(
  p_user uuid,
  p_provider text,
  p_enabled boolean
)
returns boolean
language plpgsql
set search_path to ''
as $function$
declare
  v_global boolean;
begin
  if p_provider not in ('immoscout','kleinanzeigen','immomio') then
    raise exception 'invalid_provider';
  end if;

  select u.auto_apply_enabled
  into v_global
  from public.bot_users u
  where u.id=p_user
    and u.is_active;

  if not found then
    raise exception 'participant_unavailable';
  end if;

  if p_enabled and not app_private.user_is_premium(p_user) then
    raise exception 'premium_required';
  end if;

  insert into public.application_preferences(
    user_id,enabled,immoscout_enabled,kleinanzeigen_enabled,immomio_enabled
  )
  values(
    p_user,
    coalesce(v_global,false),
    case when p_provider='immoscout' then p_enabled else coalesce(v_global,false) end,
    case when p_provider='kleinanzeigen' then p_enabled else coalesce(v_global,false) end,
    case when p_provider='immomio' then p_enabled else coalesce(v_global,false) end
  )
  on conflict(user_id) do update
  set immoscout_enabled=case
        when p_provider='immoscout' then p_enabled
        else public.application_preferences.immoscout_enabled
      end,
      kleinanzeigen_enabled=case
        when p_provider='kleinanzeigen' then p_enabled
        else public.application_preferences.kleinanzeigen_enabled
      end,
      immomio_enabled=case
        when p_provider='immomio' then p_enabled
        else public.application_preferences.immomio_enabled
      end,
      updated_at=now();

  if not p_enabled then
    update public.applications a
    set status='failed',
        last_error='provider_paused',
        wait_reason=null,
        lease_until=null,
        next_attempt_at=null
    from public.listings l
    where a.user_id=p_user
      and a.listing_id=l.id
      and a.status='pending'
      and a.submission_started_at is null
      and app_private.application_provider_target(
        l.source_id,l.raw,l.canonical_url
      )=p_provider;
  end if;

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
  v_actor public.coaching_members%rowtype;
begin
  select * into v_actor
  from public.coaching_members
  where id=p_actor and is_active;

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
    coalesce(p_immoscout,false),
    coalesce(p_kleinanzeigen,false),
    coalesce(p_immomio,false)
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

  if not p_enabled then
    update public.applications
    set status='failed',
        last_error='auto_apply_disabled',
        wait_reason=null,
        lease_until=null,
        next_attempt_at=null
    where user_id=p_user
      and status='pending'
      and submission_started_at is null;
  end if;

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
        'immoscout',coalesce(p_immoscout,false),
        'kleinanzeigen',coalesce(p_kleinanzeigen,false),
        'immomio',coalesce(p_immomio,false)
      )
    )
  );

  return true;
end
$function$;
