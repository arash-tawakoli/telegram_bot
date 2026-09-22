create or replace function app_private.user_listing_matches_active_search(
  p_user uuid,
  p_listing uuid
)
returns boolean
language sql
stable
set search_path to ''
as $function$
  select exists(
    select 1
    from public.search_profiles p
    join public.listings l on l.id=p_listing
    where p.user_id=p_user
      and p.is_active
      and app_private.matches_property_filters(p,l)
  )
$function$;

create or replace function public.begin_application_submission(p_id uuid)
returns boolean
language plpgsql
set search_path to ''
as $function$
declare
  a public.applications%rowtype;
  l public.listings%rowtype;
  t jsonb;
  owner_id uuid;
  v_provider text;
  v_pref public.application_preferences%rowtype;
  v_local_now timestamp;
  v_local_date date;
  v_local_time time;
  v_iso_day smallint;
  v_used integer;
  v_window_ok boolean;
  v_next timestamptz;
begin
  select * into a from public.applications where id=p_id for update;
  if not found or a.status<>'pending' or a.submission_started_at is not null then
    return false;
  end if;

  select * into l from public.listings where id=a.listing_id;
  if not found then return false; end if;

  v_provider := app_private.application_provider_target(l.source_id,l.raw,l.canonical_url);

  select * into v_pref
  from public.application_preferences
  where user_id=a.user_id
  for update;

  if not found
     or not app_private.application_provider_preference_enabled(a.user_id,v_provider)
     or not exists(
       select 1
       from public.bot_users u
       join public.sources s on s.id=l.source_id
       where u.id=a.user_id
         and u.is_active
         and app_private.user_is_premium(u.id)
         and app_private.applicant_profile_complete(u.id)
         and app_private.user_listing_matches_active_search(u.id,l.id)
         and app_private.application_target_ready(u.id,l.source_id,l.raw,l.canonical_url)
         and app_private.application_listing_auto_apply_allowed(l.title,l.property_type,l.raw)
         and l.is_active
         and coalesce(l.quality_status,'unchecked')<>'rejected'
         and coalesce(l.is_primary_listing,false)
         and s.enabled
         and s.runtime_mode='live'
         and s.delivery_mode='live'
         and l.source_id=a.source_id
         and app_private.delivery_newness_qualified(l.id,statement_timestamp())
         and exists(
           select 1
           from public.delivery_events d
           where d.listing_id=l.id
             and d.recipient_user_id=u.id
             and d.event_type='new_listing'
             and (
               (d.channel='telegram' and d.status in ('pending','processing','sent'))
               or (d.channel='web' and d.status='available')
             )
         )
     )
  then
    update public.applications
    set status='failed',last_error='not_eligible',wait_reason=null,lease_until=null
    where id=p_id;
    return false;
  end if;

  v_local_now := now() at time zone v_pref.timezone;
  v_local_date := v_local_now::date;
  v_local_time := v_local_now::time;
  v_iso_day := extract(isodow from v_local_now)::smallint;

  if not (v_iso_day = any(v_pref.allowed_weekdays)) then
    update public.applications
    set wait_reason='weekday_blocked',
        next_attempt_at=now()+interval '6 hours',
        lease_until=null
    where id=p_id;
    return false;
  end if;

  v_window_ok := true;
  if v_pref.send_window_start is not null then
    if v_pref.send_window_start <= v_pref.send_window_end then
      v_window_ok := v_local_time >= v_pref.send_window_start
                     and v_local_time <= v_pref.send_window_end;
    else
      v_window_ok := v_local_time >= v_pref.send_window_start
                     or v_local_time <= v_pref.send_window_end;
    end if;
  end if;

  if not v_window_ok then
    update public.applications
    set wait_reason='outside_send_window',
        next_attempt_at=now()+interval '15 minutes',
        lease_until=null
    where id=p_id;
    return false;
  end if;

  if v_pref.daily_limit is not null and a.quota_local_date is distinct from v_local_date then
    select count(*) into v_used
    from public.applications q
    where q.user_id=a.user_id
      and q.quota_local_date=v_local_date
      and q.id<>a.id;

    if v_used >= v_pref.daily_limit then
      v_next := ((v_local_date+1)::timestamp at time zone v_pref.timezone);
      update public.applications
      set wait_reason='daily_limit',
          next_attempt_at=v_next,
          lease_until=null
      where id=p_id;
      return false;
    end if;
  end if;

  t:=app_private.immomio_application_target(l.raw,l.canonical_url);
  if t->>'status'='resolved' then
    insert into app_private.application_send_keys(user_id,provider,source_identifier,application_id)
    values(a.user_id,'immomio',(t->>'source_identifier')::uuid,a.id)
    on conflict do nothing;

    select k.application_id into owner_id
    from app_private.application_send_keys k
    where k.user_id=a.user_id
      and k.provider='immomio'
      and k.source_identifier=(t->>'source_identifier')::uuid;

    if owner_id is distinct from a.id then
      update public.applications
      set status='manual_required',last_error='duplicate_provider_object',wait_reason=null,lease_until=null
      where id=p_id;
      return false;
    end if;
  end if;

  update public.applications
  set status='processing',
      attempts=attempts+1,
      submission_started_at=now(),
      quota_local_date=v_local_date,
      wait_reason=null
  where id=p_id;

  return true;
end
$function$;
