-- Keep coach preference writes on the same enablement rules as Telegram.
-- The 11-argument wrapper keeps the deployed coach-api callable during rollout.
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
  v_immowelt boolean;
begin
  select * into v_actor
  from public.coaching_members
  where id=p_actor and is_active;

  if not found or not app_private.coaching_actor_can_access(v_actor.id,p_user,false) then
    raise exception 'participant_forbidden';
  end if;

  v_immowelt:=coalesce(
    p_immowelt,
    (select immowelt_enabled from public.application_preferences where user_id=p_user),
    false
  );

  -- Checks active user, Premium, identity and a verified connected provider
  -- before enabling; disabling also cancels unsent pending applications.
  perform public.set_application_enabled_shared(p_user,p_enabled);

  insert into public.application_preferences(
    user_id,enabled,daily_limit,timezone,allowed_weekdays,
    send_window_start,send_window_end,
    immoscout_enabled,kleinanzeigen_enabled,immomio_enabled,immowelt_enabled
  )
  values(
    p_user,p_enabled,p_daily_limit,coalesce(nullif(p_timezone,''),'Europe/Berlin'),
    coalesce(p_weekdays,array[1,2,3,4,5,6,7]::smallint[]),
    p_window_start,p_window_end,
    coalesce(p_immoscout,false),coalesce(p_kleinanzeigen,false),
    coalesce(p_immomio,false),v_immowelt
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
      immomio_enabled=excluded.immomio_enabled,
      immowelt_enabled=excluded.immowelt_enabled,
      updated_at=now();

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
        'immomio',coalesce(p_immomio,false),
        'immowelt',v_immowelt
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
begin
  return public.coach_set_application_preferences(
    p_actor,p_user,p_enabled,p_daily_limit,p_timezone,p_weekdays,
    p_window_start,p_window_end,p_immoscout,p_kleinanzeigen,p_immomio,
    null
  );
end
$function$;

revoke all on function public.coach_set_application_preferences(
  uuid,uuid,boolean,integer,text,smallint[],
  time without time zone,time without time zone,boolean,boolean,boolean,boolean
) from public,anon,authenticated;
grant execute on function public.coach_set_application_preferences(
  uuid,uuid,boolean,integer,text,smallint[],
  time without time zone,time without time zone,boolean,boolean,boolean,boolean
) to service_role;

revoke all on function public.coach_set_application_preferences(
  uuid,uuid,boolean,integer,text,smallint[],
  time without time zone,time without time zone,boolean,boolean,boolean
) from public,anon,authenticated;
grant execute on function public.coach_set_application_preferences(
  uuid,uuid,boolean,integer,text,smallint[],
  time without time zone,time without time zone,boolean,boolean,boolean
) to service_role;

notify pgrst, 'reload schema';
