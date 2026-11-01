alter table public.bot_users
  add column if not exists test_auto_apply_allowed boolean not null default false,
  add column if not exists test_auto_apply_enabled boolean not null default false,
  add column if not exists test_auto_apply_daily_limit integer not null default 1,
  add column if not exists test_auto_apply_enabled_at timestamptz,
  add column if not exists test_auto_apply_disabled_at timestamptz,
  add column if not exists test_auto_apply_updated_by_telegram_id bigint;

do $
declare
  v_owner_count integer;
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.bot_users'::regclass
      and conname='bot_users_test_auto_apply_daily_limit_check'
  ) then
    alter table public.bot_users
      add constraint bot_users_test_auto_apply_daily_limit_check
      check (test_auto_apply_daily_limit between 1 and 5);
  end if;

  select count(*) into v_owner_count
  from public.bot_users
  where telegram_user_id=8538226539;

  if v_owner_count<>1 then
    raise exception 'personal_auto_apply_test_owner_not_unique';
  end if;

  update public.bot_users
  set test_auto_apply_allowed=true,
      test_auto_apply_enabled=false,
      test_auto_apply_daily_limit=1,
      test_auto_apply_enabled_at=null,
      test_auto_apply_disabled_at=null
  where telegram_user_id=8538226539;
end
$;

comment on column public.bot_users.test_auto_apply_allowed is
  'Server-side allowlist for the isolated personal ImmoScout24 auto-apply test mode.';
comment on column public.bot_users.test_auto_apply_enabled is
  'Opt-in test mode; only ImmoScout24 central credentials are used and the regular global switch stays off.';
comment on column public.bot_users.test_auto_apply_daily_limit is
  'Daily real-application cap for the isolated personal test mode.';

create or replace function public.set_application_test_mode(
  p_user uuid,
  p_telegram_user_id bigint,
  p_enabled boolean
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_user public.bot_users%rowtype;
begin
  select *
  into v_user
  from public.bot_users
  where id=p_user
    and telegram_user_id=p_telegram_user_id
    and test_auto_apply_allowed
  for update;

  if not found then
    raise exception 'test_mode_forbidden';
  end if;

  if p_enabled is true and v_user.test_auto_apply_enabled is false then
    if not v_user.is_active then
      raise exception 'test_mode_forbidden';
    end if;
    if v_user.auto_apply_enabled then
      raise exception 'test_mode_global_auto_apply_active';
    end if;
    if not app_private.user_is_premium(p_user) then
      raise exception 'premium_required';
    end if;
    if not app_private.applicant_profile_identity_ready(p_user)
       or coalesce(cardinality(public.application_profile_missing_fields(p_user)),0)>0 then
      raise exception 'test_mode_profile_incomplete';
    end if;
    if not exists (
      select 1
      from public.search_profiles s
      where s.user_id=p_user
        and coalesce(s.is_active,true)
    ) then
      raise exception 'test_mode_search_profile_missing';
    end if;

    insert into public.application_preferences(
      user_id,enabled,immoscout_enabled,kleinanzeigen_enabled,immomio_enabled,immowelt_enabled
    )
    values(p_user,false,false,false,false,false)
    on conflict(user_id) do nothing;

    update public.applications
    set status='failed',
        last_error='test_mode_reset',
        wait_reason=null,
        lease_until=null,
        next_attempt_at=null
    where user_id=p_user
      and source_id=1
      and status='pending'
      and submission_started_at is null;

    update public.bot_users
    set test_auto_apply_enabled=true,
        test_auto_apply_enabled_at=now(),
        test_auto_apply_disabled_at=null,
        test_auto_apply_updated_by_telegram_id=p_telegram_user_id,
        updated_at=now()
    where id=p_user;
  elsif p_enabled is false and v_user.test_auto_apply_enabled is true then
    update public.bot_users
    set test_auto_apply_enabled=false,
        test_auto_apply_disabled_at=now(),
        test_auto_apply_updated_by_telegram_id=p_telegram_user_id,
        updated_at=now()
    where id=p_user;

    update public.applications
    set status='failed',
        last_error='test_mode_disabled',
        wait_reason=null,
        lease_until=null,
        next_attempt_at=null
    where user_id=p_user
      and source_id=1
      and status='pending'
      and submission_started_at is null
      and provider_state->>'test_mode'='true';
  end if;

  select *
  into v_user
  from public.bot_users
  where id=p_user;

  return jsonb_build_object(
    'allowed',v_user.test_auto_apply_allowed,
    'enabled',v_user.test_auto_apply_enabled,
    'daily_limit',v_user.test_auto_apply_daily_limit,
    'enabled_at',v_user.test_auto_apply_enabled_at,
    'disabled_at',v_user.test_auto_apply_disabled_at
  );
end
$function$;

revoke all on function public.set_application_test_mode(uuid,bigint,boolean) from public, anon, authenticated;
grant execute on function public.set_application_test_mode(uuid,bigint,boolean) to service_role;

create or replace function app_private.application_provider_preference_enabled(
  p_user uuid,
  p_provider text
)
returns boolean
language sql
stable
set search_path to ''
as $function$
  select case
    when exists (
      select 1
      from public.bot_users u
      where u.id=p_user
        and u.test_auto_apply_allowed
        and u.test_auto_apply_enabled
        and not u.auto_apply_enabled
    ) then p_provider='immoscout'
    else coalesce((
      select p.enabled
        and case p_provider
          when 'immoscout' then coalesce(p.immoscout_enabled,false)
          when 'kleinanzeigen' then coalesce(p.kleinanzeigen_enabled,false)
          when 'immomio' then coalesce(p.immomio_enabled,false)
          when 'immowelt' then coalesce(p.immowelt_enabled,false)
          else false
        end
      from public.application_preferences p
      where p.user_id=p_user
    ),false)
  end
$function$;

create or replace function app_private.application_target_ready(
  p_user uuid,
  p_source_id smallint,
  p_raw jsonb,
  p_canonical_url text
)
returns boolean
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_provider text;
  v_test_mode boolean;
begin
  v_provider:=app_private.application_provider_target(p_source_id,p_raw,p_canonical_url);

  select coalesce(
    u.test_auto_apply_allowed
    and u.test_auto_apply_enabled
    and not u.auto_apply_enabled,
    false
  )
  into v_test_mode
  from public.bot_users u
  where u.id=p_user;

  if coalesce(v_test_mode,false) then
    return v_provider='immoscout';
  end if;

  if v_provider is null
     or not exists(
       select 1
       from public.platform_connections c
       where c.user_id=p_user
         and c.provider=v_provider
         and c.status='connected'
     ) then
    return false;
  end if;

  if v_provider='immomio' then
    return true;
  end if;

  return exists(
    select 1
    from app_private.application_platforms p
    where p.source_id=p_source_id
      and p.verified_at is not null
  );
end
$function$;

create or replace function public.reconcile_listing_applications(p_listing_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_inserted integer := 0;
begin
  insert into public.applications(user_id,listing_id,source_id,provider_state)
  select distinct
    u.id,
    l.id,
    l.source_id,
    case
      when u.test_auto_apply_allowed
        and u.test_auto_apply_enabled
        and not u.auto_apply_enabled
        and target.provider='immoscout'
      then jsonb_build_object('test_mode',true)
      else '{}'::jsonb
    end
  from public.listings l
  join public.sources s on s.id=l.source_id
  join public.delivery_events d on d.listing_id=l.id
  join public.bot_users u on u.id=d.recipient_user_id
  cross join lateral (
    select app_private.application_provider_target(l.source_id,l.raw,l.canonical_url) as provider
  ) target
  where l.id=p_listing_id
    and target.provider is not null
    and d.event_type='new_listing'
    and d.channel='telegram'
    and d.status in ('pending','processing','sent')
    and coalesce(d.delivery_outcome_unknown,false)=false
    and app_private.delivery_newness_qualified(l.id,statement_timestamp())
    and u.is_active
    and app_private.user_is_premium(u.id)
    and app_private.applicant_profile_identity_ready(u.id)
    and app_private.application_provider_preference_enabled(u.id,target.provider)
    and app_private.application_target_ready(u.id,l.source_id,l.raw,l.canonical_url)
    and app_private.application_listing_auto_apply_allowed(l.title,l.property_type,l.raw)
    and l.is_active
    and coalesce(l.quality_status,'unchecked')<>'rejected'
    and coalesce(l.is_primary_listing,false)
    and s.enabled
    and s.runtime_mode='live'
    and s.delivery_mode='live'
  on conflict(user_id,listing_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end
$function$;

create or replace function public.claim_application()
returns setof public.applications
language plpgsql
set search_path to ''
as $function$
begin
  update public.applications a
  set status='manual_required', last_error='submission_unconfirmed'
  from public.listings l
  where l.id=a.listing_id
    and a.status='processing'
    and a.submission_started_at is not null
    and (a.lease_until is null or a.lease_until<now())
    and app_private.application_provider_target(l.source_id,l.raw,l.canonical_url) is distinct from 'immomio'
    and app_private.application_provider_target(l.source_id,l.raw,l.canonical_url) is distinct from 'kleinanzeigen';

  return query
  update public.applications a
  set lease_token=gen_random_uuid(), lease_until=now()+interval '3 minutes'
  where a.id=(
    select x.id
    from public.applications x
    join public.listings l on l.id=x.listing_id
    where x.status='pending'
      and x.submission_started_at is null
      and x.next_attempt_at<=now()
      and (x.lease_until is null or x.lease_until<now())
      and app_private.application_provider_target(l.source_id,l.raw,l.canonical_url) is distinct from 'immomio'
      and app_private.application_provider_target(l.source_id,l.raw,l.canonical_url) is distinct from 'kleinanzeigen'
      and (
        not exists(
          select 1
          from public.bot_users u
          where u.id=x.user_id
            and u.test_auto_apply_allowed
            and u.test_auto_apply_enabled
            and not u.auto_apply_enabled
        )
        or app_private.application_provider_target(l.source_id,l.raw,l.canonical_url)='immoscout'
      )
    order by x.next_attempt_at
    for update of x skip locked
    limit 1
  )
  returning a.*;
end
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
  v_test_mode_enabled boolean := false;
  v_test_daily_limit integer;
  v_test_enabled_at timestamptz;
  v_effective_daily_limit integer;
begin
  select * into a from public.applications where id=p_id for update;
  if not found or a.status<>'pending' or a.submission_started_at is not null then
    return false;
  end if;

  select * into l from public.listings where id=a.listing_id;
  if not found then return false; end if;

  v_provider := app_private.application_provider_target(l.source_id,l.raw,l.canonical_url);

  select
    coalesce(u.test_auto_apply_allowed and u.test_auto_apply_enabled and not u.auto_apply_enabled,false),
    u.test_auto_apply_daily_limit,
    u.test_auto_apply_enabled_at
  into v_test_mode_enabled,v_test_daily_limit,v_test_enabled_at
  from public.bot_users u
  where u.id=a.user_id;

  v_test_mode_enabled := coalesce(v_test_mode_enabled,false) and v_provider='immoscout';

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
         and app_private.applicant_profile_identity_ready(u.id)
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

  v_effective_daily_limit := case
    when v_test_mode_enabled then v_test_daily_limit
    else v_pref.daily_limit
  end;

  if v_effective_daily_limit is not null and a.quota_local_date is distinct from v_local_date then
    if v_test_mode_enabled then
      select count(*) into v_used
      from public.applications q
      where q.user_id=a.user_id
        and q.source_id=a.source_id
        and q.quota_local_date=v_local_date
        and q.created_at>=coalesce(v_test_enabled_at,statement_timestamp())
        and q.provider_state->>'test_mode'='true'
        and q.id<>a.id;
    else
      select count(*) into v_used
      from public.applications q
      where q.user_id=a.user_id
        and q.quota_local_date=v_local_date
        and q.id<>a.id;
    end if;

    if v_used >= v_effective_daily_limit then
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

create or replace function public.set_application_enabled_shared(p_user uuid,p_enabled boolean)
returns boolean
language plpgsql
set search_path to ''
as $function$
begin
  if not exists(select 1 from public.bot_users where id=p_user and is_active) then
    raise exception 'participant_unavailable';
  end if;

  if p_enabled and exists(
    select 1
    from public.bot_users u
    where u.id=p_user
      and u.test_auto_apply_allowed
      and u.test_auto_apply_enabled
  ) then
    raise exception 'test_mode_active';
  end if;

  if p_enabled and not app_private.user_is_premium(p_user) then
    raise exception 'premium_required';
  end if;
  if p_enabled and not app_private.applicant_profile_identity_ready(p_user) then
    raise exception 'profile_incomplete';
  end if;
  if p_enabled and not app_private.user_has_application_provider(p_user) then
    raise exception 'provider_required';
  end if;

  insert into public.application_preferences(
    user_id,enabled,immoscout_enabled,kleinanzeigen_enabled,immomio_enabled,immowelt_enabled
  )
  values(p_user,p_enabled,p_enabled,p_enabled,p_enabled,p_enabled)
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

create or replace function app_private.application_provider_preference_enabled(
  p_user uuid,
  p_provider text
)
returns boolean
language sql
stable
set search_path to ''
as $function$
  select case
    when exists (
      select 1
      from public.bot_users u
      where u.id=p_user
        and u.test_auto_apply_allowed
        and u.test_auto_apply_enabled
        and not u.auto_apply_enabled
    ) then p_provider='immoscout'
    else coalesce((
      select p.enabled
        and case p_provider
          when 'immoscout' then coalesce(p.immoscout_enabled,false)
          when 'kleinanzeigen' then coalesce(p.kleinanzeigen_enabled,false)
          when 'immomio' then coalesce(p.immomio_enabled,false)
          when 'immowelt' then coalesce(p.immowelt_enabled,false)
          else false
        end
      from public.application_preferences p
      where p.user_id=p_user
    ),false)
  end
$function$;

create or replace function app_private.application_target_ready(
  p_user uuid,
  p_source_id smallint,
  p_raw jsonb,
  p_canonical_url text
)
returns boolean
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_provider text;
  v_test_mode boolean;
begin
  v_provider:=app_private.application_provider_target(p_source_id,p_raw,p_canonical_url);

  select coalesce(
    u.test_auto_apply_allowed
    and u.test_auto_apply_enabled
    and not u.auto_apply_enabled,
    false
  )
  into v_test_mode
  from public.bot_users u
  where u.id=p_user;

  if coalesce(v_test_mode,false) then
    return v_provider='immoscout';
  end if;

  if v_provider is null
     or not exists(
       select 1
       from public.platform_connections c
       where c.user_id=p_user
         and c.provider=v_provider
         and c.status='connected'
     ) then
    return false;
  end if;

  if v_provider='immomio' then
    return true;
  end if;

  return exists(
    select 1
    from app_private.application_platforms p
    where p.source_id=p_source_id
      and p.verified_at is not null
  );
end
$function$;

comment on column public.bot_users.test_auto_apply_allowed is
  'Server-side allowlist for the isolated personal ImmoScout24 auto-apply test mode.';
comment on column public.bot_users.test_auto_apply_enabled is
  'Opt-in test mode; only ImmoScout24 central credentials are used and the regular global switch stays off.';
comment on column public.bot_users.test_auto_apply_daily_limit is
  'Daily real-application cap for the isolated personal test mode.';
