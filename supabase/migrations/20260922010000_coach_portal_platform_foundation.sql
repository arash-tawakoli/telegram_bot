-- Coach portal + channel-neutral application foundation.
-- Keeps bot_users.id as the canonical participant identity.

alter table public.bot_users
  alter column telegram_user_id drop not null,
  alter column chat_id drop not null;

alter table public.bot_users
  add column if not exists origin text not null default 'telegram';

alter table public.bot_users
  drop constraint if exists bot_users_origin_check;
alter table public.bot_users
  add constraint bot_users_origin_check
  check (origin in ('telegram','coaching','web','imported'));

alter table public.bot_users
  drop constraint if exists bot_users_telegram_pair_check;
alter table public.bot_users
  add constraint bot_users_telegram_pair_check
  check ((telegram_user_id is null) = (chat_id is null));

alter table public.delivery_events
  add column if not exists channel text not null default 'telegram';

alter table public.delivery_events
  drop constraint if exists delivery_events_channel_check;
alter table public.delivery_events
  add constraint delivery_events_channel_check
  check (channel in ('telegram','web'));

alter table public.delivery_events
  drop constraint if exists delivery_events_status_check;
alter table public.delivery_events
  add constraint delivery_events_status_check
  check (status in ('available','pending','processing','sent','failed','skipped'));

create index if not exists delivery_events_channel_status_retry_idx
  on public.delivery_events(channel,status,next_retry_at,created_at);

alter table public.platform_auth_flows
  add column if not exists origin text not null default 'telegram',
  add column if not exists issued_by uuid,
  add column if not exists return_target text not null default 'telegram',
  add column if not exists context jsonb not null default '{}'::jsonb;

alter table public.platform_auth_flows
  drop constraint if exists platform_auth_flows_origin_check;
alter table public.platform_auth_flows
  add constraint platform_auth_flows_origin_check
  check (origin in ('telegram','coach','shared'));

alter table public.platform_auth_flows
  drop constraint if exists platform_auth_flows_return_target_check;
alter table public.platform_auth_flows
  add constraint platform_auth_flows_return_target_check
  check (return_target in ('telegram','coach','success'));

create table if not exists public.coaching_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  operations_paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.coaching_workspaces(name)
values ('NexaLabs')
on conflict (name) do nothing;

create table if not exists public.coaching_members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.coaching_workspaces(id) on delete cascade,
  display_name text not null,
  role text not null default 'coach',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,id),
  constraint coaching_members_role_check check (role in ('admin','coach'))
);

create table if not exists public.coaching_participants (
  user_id uuid primary key references public.bot_users(id) on delete cascade,
  workspace_id uuid not null references public.coaching_workspaces(id) on delete cascade,
  coach_member_id uuid not null,
  created_by_member_id uuid,
  status text not null default 'active',
  retention_mode text not null default 'manual',
  retention_delete_on date,
  assignment_version integer not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id,coach_member_id)
    references public.coaching_members(workspace_id,id) on delete restrict,
  foreign key (workspace_id,created_by_member_id)
    references public.coaching_members(workspace_id,id) on delete set null,
  constraint coaching_participants_status_check
    check (status in ('active','archived','pending_deletion')),
  constraint coaching_participants_retention_check
    check (
      (retention_mode='manual' and retention_delete_on is null)
      or (retention_mode='delete_on_date' and retention_delete_on is not null)
    )
);

create index if not exists coaching_participants_workspace_coach_idx
  on public.coaching_participants(workspace_id,coach_member_id,status);

create table if not exists public.coaching_audit_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.coaching_workspaces(id) on delete cascade,
  actor_member_id uuid references public.coaching_members(id) on delete set null,
  participant_user_id uuid references public.bot_users(id) on delete set null,
  action text not null,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists coaching_audit_workspace_time_idx
  on public.coaching_audit_events(workspace_id,created_at desc);
create index if not exists coaching_audit_participant_time_idx
  on public.coaching_audit_events(participant_user_id,created_at desc)
  where participant_user_id is not null;

create table if not exists public.application_preferences (
  user_id uuid primary key references public.bot_users(id) on delete cascade,
  enabled boolean not null default false,
  daily_limit integer,
  timezone text not null default 'Europe/Berlin',
  allowed_weekdays smallint[] not null default array[1,2,3,4,5,6,7]::smallint[],
  send_window_start time,
  send_window_end time,
  immoscout_enabled boolean not null default false,
  kleinanzeigen_enabled boolean not null default false,
  immomio_enabled boolean not null default false,
  config_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_preferences_daily_limit_check
    check (daily_limit is null or daily_limit > 0),
  constraint application_preferences_weekdays_check
    check (allowed_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  constraint application_preferences_window_pair_check
    check ((send_window_start is null) = (send_window_end is null)),
  constraint application_preferences_version_check
    check (config_version > 0)
);

create or replace function app_private.validate_application_preferences()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then
    raise exception 'invalid_timezone';
  end if;
  new.updated_at := now();
  if tg_op='UPDATE' and row(
    new.enabled,new.daily_limit,new.timezone,new.allowed_weekdays,
    new.send_window_start,new.send_window_end,
    new.immoscout_enabled,new.kleinanzeigen_enabled,new.immomio_enabled
  ) is distinct from row(
    old.enabled,old.daily_limit,old.timezone,old.allowed_weekdays,
    old.send_window_start,old.send_window_end,
    old.immoscout_enabled,old.kleinanzeigen_enabled,old.immomio_enabled
  ) then
    new.config_version := old.config_version + 1;
  end if;
  return new;
end
$function$;

drop trigger if exists application_preferences_validate on public.application_preferences;
create trigger application_preferences_validate
before insert or update on public.application_preferences
for each row execute function app_private.validate_application_preferences();

insert into public.application_preferences(
  user_id,enabled,immoscout_enabled,kleinanzeigen_enabled,immomio_enabled
)
select
  u.id,
  u.auto_apply_enabled,
  u.auto_apply_enabled and exists(
    select 1 from public.platform_connections c
    where c.user_id=u.id and c.provider='immoscout' and c.status='connected'
  ),
  u.auto_apply_enabled and exists(
    select 1 from public.platform_connections c
    where c.user_id=u.id and c.provider='kleinanzeigen' and c.status='connected'
  ),
  u.auto_apply_enabled and exists(
    select 1 from public.platform_connections c
    where c.user_id=u.id and c.provider='immomio' and c.status='connected'
  )
from public.bot_users u
on conflict (user_id) do nothing;

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
    new.auto_apply_enabled and exists(
      select 1 from public.platform_connections c
      where c.user_id=new.id and c.provider='immoscout' and c.status='connected'
    ),
    new.auto_apply_enabled and exists(
      select 1 from public.platform_connections c
      where c.user_id=new.id and c.provider='kleinanzeigen' and c.status='connected'
    ),
    new.auto_apply_enabled and exists(
      select 1 from public.platform_connections c
      where c.user_id=new.id and c.provider='immomio' and c.status='connected'
    )
  )
  on conflict (user_id) do update
  set enabled=excluded.enabled,
      immoscout_enabled=case
        when excluded.enabled then public.application_preferences.immoscout_enabled or excluded.immoscout_enabled
        else public.application_preferences.immoscout_enabled end,
      kleinanzeigen_enabled=case
        when excluded.enabled then public.application_preferences.kleinanzeigen_enabled or excluded.kleinanzeigen_enabled
        else public.application_preferences.kleinanzeigen_enabled end,
      immomio_enabled=case
        when excluded.enabled then public.application_preferences.immomio_enabled or excluded.immomio_enabled
        else public.application_preferences.immomio_enabled end;
  return new;
end
$function$;

drop trigger if exists bot_users_sync_application_preferences on public.bot_users;
create trigger bot_users_sync_application_preferences
after insert or update of auto_apply_enabled on public.bot_users
for each row execute function app_private.sync_legacy_auto_apply_preferences();

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
    select p.enabled and case p_provider
      when 'immoscout' then p.immoscout_enabled
      when 'kleinanzeigen' then p.kleinanzeigen_enabled
      when 'immomio' then p.immomio_enabled
      else false
    end
    from public.application_preferences p
    where p.user_id=p_user
  ),false)
$function$;

create or replace function public.application_auto_apply_active(
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
    from public.bot_users u
    join public.listings l on l.id=p_listing
    where u.id=p_user
      and u.is_active
      and app_private.user_is_premium(u.id)
      and app_private.applicant_profile_complete(u.id)
      and app_private.application_provider_preference_enabled(
        u.id,
        app_private.application_provider_target(l.source_id,l.raw,l.canonical_url)
      )
      and app_private.application_target_ready(u.id,l.source_id,l.raw,l.canonical_url)
  )
$function$;

revoke all on function public.application_auto_apply_active(uuid,uuid) from public,anon,authenticated;
grant execute on function public.application_auto_apply_active(uuid,uuid) to service_role;

alter table public.applications
  add column if not exists wait_reason text,
  add column if not exists quota_local_date date;

create index if not exists applications_user_quota_date_idx
  on public.applications(user_id,quota_local_date)
  where quota_local_date is not null;

create table if not exists public.application_events (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.applications(id) on delete cascade,
  user_id uuid not null references public.bot_users(id) on delete cascade,
  provider text,
  event_type text not null,
  status text,
  attempt integer,
  reason text,
  document_result text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists application_events_application_time_idx
  on public.application_events(application_id,created_at);
create index if not exists application_events_user_time_idx
  on public.application_events(user_id,created_at desc);
create index if not exists application_events_provider_time_idx
  on public.application_events(provider,created_at desc)
  where provider is not null;

create or replace function app_private.log_application_event()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_provider text;
  v_event text;
begin
  select app_private.application_provider_target(l.source_id,l.raw,l.canonical_url)
    into v_provider
  from public.listings l
  where l.id=new.listing_id;

  if tg_op='INSERT' then
    v_event := 'queued';
  elsif new.status is distinct from old.status then
    v_event := 'status_changed';
  elsif new.wait_reason is distinct from old.wait_reason then
    v_event := 'wait_changed';
  else
    return new;
  end if;

  insert into public.application_events(
    application_id,user_id,provider,event_type,status,attempt,reason,metadata
  )
  values(
    new.id,new.user_id,v_provider,v_event,new.status,new.attempts,
    coalesce(new.wait_reason,new.last_error),
    jsonb_build_object('source_id',new.source_id)
  );
  return new;
end
$function$;

drop trigger if exists applications_log_event on public.applications;
create trigger applications_log_event
after insert or update of status,wait_reason on public.applications
for each row execute function app_private.log_application_event();

create or replace function app_private.guard_application_opt_in()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.auto_apply_enabled and (tg_op='INSERT' or not coalesce(old.auto_apply_enabled,false)) then
    if not new.is_active
       or not app_private.user_is_premium(new.id)
       or not app_private.applicant_profile_complete(new.id)
       or not app_private.user_has_application_provider(new.id)
    then
      raise exception 'automatic applications are not available';
    end if;
  end if;
  return new;
end
$function$;

create or replace function app_private.enqueue_matched_application()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_provider text;
begin
  if coalesce(new.event_type,'new_listing') <> 'new_listing'
     or not app_private.delivery_newness_qualified(new.listing_id,statement_timestamp())
  then
    return new;
  end if;

  insert into public.applications(user_id, listing_id, source_id)
  select u.id, l.id, l.source_id
  from public.bot_users u
  join public.listings l on l.id=new.listing_id
  join public.sources s on s.id=l.source_id
  where u.id=new.recipient_user_id
    and u.is_active
    and app_private.user_is_premium(u.id)
    and app_private.applicant_profile_complete(u.id)
    and app_private.application_provider_preference_enabled(
      u.id,
      app_private.application_provider_target(l.source_id,l.raw,l.canonical_url)
    )
    and app_private.application_target_ready(u.id,l.source_id,l.raw,l.canonical_url)
    and app_private.application_listing_auto_apply_allowed(l.title,l.property_type,l.raw)
    and l.is_active
    and coalesce(l.quality_status,'unchecked')<>'rejected'
    and coalesce(l.is_primary_listing,false)
    and s.enabled
    and s.runtime_mode='live'
    and s.delivery_mode='live'
  on conflict(user_id,listing_id) do nothing;

  return new;
end
$function$;

create or replace function app_private.queue_listing_delivery_v3()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_group uuid;
  v_primary boolean;
  v_source_ready boolean;
  v_haystack text := lower(concat_ws(' ',new.property_type,new.title,new.district,new.address,new.raw::text));
begin
  if not coalesce(new.is_active,false) or coalesce(new.quality_status,'unchecked')='rejected' then
    return new;
  end if;

  if v_haystack ~ '(^|[[:space:]])(ich|wir)[[:space:]]+suche(n)?[[:space:]].{0,40}(wohnung|apartment|wg-zimmer|zimmer|haus)'
     or v_haystack ~ '[[:space:]]sucht[[:space:]]+(dringend[[:space:]]+)?(eine[nr]?[[:space:]]+)?(wohnung|apartment|wg-zimmer|zimmer|haus)'
     or v_haystack ~ '^[[:space:]]*(wohnung|apartment|wg-zimmer|zimmer|haus)[[:space:]]+gesucht'
  then
    return new;
  end if;

  select (s.enabled and s.runtime_mode='live' and s.delivery_mode='live')
    into v_source_ready
  from public.sources s
  where s.id=new.source_id;

  if not coalesce(v_source_ready,false) then
    perform app_private.assign_listing_dedupe(new.id);
    return new;
  end if;

  v_group := app_private.assign_listing_dedupe(new.id);

  select l.is_primary_listing into v_primary
  from public.listings l
  where l.id=new.id;

  if not coalesce(v_primary,false) or v_group is null then
    return new;
  end if;

  if not app_private.delivery_newness_qualified(new.id,statement_timestamp()) then
    return new;
  end if;

  insert into public.delivery_events(
    profile_id,listing_id,dedupe_key,status,delivery_format,
    recipient_user_id,next_retry_at,channel
  )
  select
    p.id,
    new.id,
    'group:'||v_group::text,
    case when owner_user.telegram_user_id is not null and owner_user.chat_id is not null
      then 'pending' else 'available' end,
    case when owner_user.telegram_user_id is not null and owner_user.chat_id is not null
      then 'photo_card' else 'web_match' end,
    p.user_id,
    null,
    case when owner_user.telegram_user_id is not null and owner_user.chat_id is not null
      then 'telegram' else 'web' end
  from public.search_profiles p
  join public.bot_users owner_user
    on owner_user.id=p.user_id
   and owner_user.is_active=true
  where p.is_active=true
    and (p.profile_slot=1 or app_private.user_is_premium(p.user_id))
    and app_private.matches_property_filters(p,new)
  on conflict do nothing;

  return new;
end
$function$;

create or replace function app_private.queue_saved_listing_change()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  insert into public.delivery_events(
    profile_id,listing_id,dedupe_key,status,delivery_format,
    recipient_user_id,event_type,change_id,next_retry_at,channel
  )
  select
    profile.id,
    new.listing_id,
    'change:'||new.id::text||':'||sl.user_id::text,
    case when u.telegram_user_id is not null and u.chat_id is not null
      then 'pending' else 'available' end,
    case when u.telegram_user_id is not null and u.chat_id is not null
      then 'photo_card' else 'web_match' end,
    sl.user_id,
    'listing_changed',
    new.id,
    null,
    case when u.telegram_user_id is not null and u.chat_id is not null
      then 'telegram' else 'web' end
  from public.saved_listings sl
  join public.bot_users u
    on u.id=sl.user_id
   and u.is_active=true
  join lateral (
    select p.id
    from public.search_profiles p
    where p.user_id=sl.user_id and p.is_active=true
    order by p.profile_slot,p.created_at
    limit 1
  ) profile on true
  where sl.listing_id=new.listing_id
  on conflict do nothing;

  return new;
end
$function$;

create or replace function app_private.prepare_current_delivery_queue()
returns integer
language plpgsql
set search_path to ''
as $function$
declare
  v_count integer;
begin
  with stopped as (
    update public.delivery_events de
    set status='skipped',
        next_retry_at=null,
        error_message=case
          when not coalesce(p.is_active,false) then 'inactive search profile blocked by delivery guard'
          when p.profile_slot>1 and not app_private.user_is_premium(p.user_id) then 'profile slot requires premium'
          when not coalesce(l.is_active,false) then 'inactive listing blocked by delivery guard'
          when coalesce(l.quality_status,'unchecked')='rejected' then 'rejected listing blocked by delivery guard'
          when not coalesce(l.is_primary_listing,false) then 'deduplicated listing blocked by delivery guard'
          when not coalesce(s.enabled,false) or s.runtime_mode<>'live' or s.delivery_mode<>'live'
            then 'source not live blocked by delivery guard'
          when not app_private.matches_property_filters(p,l)
            then 'listing no longer matches current profile/category filters'
          else 'listing is not qualified as <=24h new inventory'
        end
    from public.listings l, public.sources s, public.search_profiles p
    where l.id=de.listing_id
      and s.id=l.source_id
      and p.id=de.profile_id
      and de.status in ('available','pending','failed')
      and coalesce(de.delivery_outcome_unknown,false)=false
      and (
        not coalesce(p.is_active,false)
        or (p.profile_slot>1 and not app_private.user_is_premium(p.user_id))
        or not coalesce(l.is_active,false)
        or coalesce(l.quality_status,'unchecked')='rejected'
        or not coalesce(l.is_primary_listing,false)
        or not coalesce(s.enabled,false)
        or s.runtime_mode<>'live'
        or s.delivery_mode<>'live'
        or not app_private.matches_property_filters(p,l)
        or (
          coalesce(de.event_type,'new_listing')='new_listing'
          and not app_private.delivery_newness_qualified(l.id,statement_timestamp())
        )
      )
    returning de.id
  )
  select count(*) into v_count from stopped;
  return v_count;
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

create or replace function public.release_application_quota(p_id uuid)
returns boolean
language plpgsql
set search_path to ''
as $function$
begin
  update public.applications
  set quota_local_date=null
  where id=p_id
    and status in ('pending','failed')
    and sent_at is null;
  return found;
end
$function$;

revoke all on function public.release_application_quota(uuid) from public,anon,authenticated;
grant execute on function public.release_application_quota(uuid) to service_role;

create table if not exists app_private.telegram_link_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.bot_users(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists telegram_link_tokens_user_active_idx
  on app_private.telegram_link_tokens(user_id,expires_at)
  where consumed_at is null and invalidated_at is null;

create or replace function public.issue_telegram_link_token(
  p_user uuid,
  p_created_by uuid default null
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_token text;
begin
  if not exists(
    select 1 from public.bot_users
    where id=p_user and is_active and telegram_user_id is null and chat_id is null
  ) then
    raise exception 'participant_not_linkable';
  end if;

  update app_private.telegram_link_tokens
  set invalidated_at=now()
  where user_id=p_user
    and consumed_at is null
    and invalidated_at is null;

  v_token := 'link_'||encode(extensions.gen_random_bytes(24),'hex');

  insert into app_private.telegram_link_tokens(
    user_id,token_hash,created_by,expires_at
  )
  values(
    p_user,
    encode(extensions.digest(v_token,'sha256'),'hex'),
    p_created_by,
    now()+interval '20 minutes'
  );

  return v_token;
end
$function$;

revoke all on function public.issue_telegram_link_token(uuid,uuid) from public,anon,authenticated;
grant execute on function public.issue_telegram_link_token(uuid,uuid) to service_role;

create or replace function public.prepare_telegram_update(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_claim integer;
  v_update_id bigint := (p_payload->>'update_id')::bigint;
  v_user_id bigint := coalesce(
    (p_payload #>> '{callback_query,from,id}')::bigint,
    (p_payload #>> '{message,from,id}')::bigint
  );
  v_chat_id bigint := coalesce(
    (p_payload #>> '{callback_query,message,chat,id}')::bigint,
    (p_payload #>> '{message,chat,id}')::bigint
  );
  v_username text := coalesce(
    p_payload #>> '{callback_query,from,username}',
    p_payload #>> '{message,from,username}'
  );
  v_first_name text := coalesce(
    p_payload #>> '{callback_query,from,first_name}',
    p_payload #>> '{message,from,first_name}'
  );
  v_last_name text := coalesce(
    p_payload #>> '{callback_query,from,last_name}',
    p_payload #>> '{message,from,last_name}'
  );
  v_language_code text := coalesce(
    p_payload #>> '{callback_query,from,language_code}',
    p_payload #>> '{message,from,language_code}'
  );
  v_text text := coalesce(p_payload #>> '{message,text}','');
  v_start_param text;
  v_target uuid;
  v_link_id uuid;
  v_user public.bot_users%rowtype;
  v_subscription public.user_subscriptions%rowtype;
  v_is_new boolean := false;
begin
  if v_user_id is null or v_chat_id is null then
    raise exception 'missing telegram user or chat id';
  end if;

  v_claim := public.claim_telegram_update(p_payload);
  if v_claim <= 0 then
    return jsonb_build_object('claim',v_claim);
  end if;

  if v_text ~ '^/start[[:space:]]+link_[A-Za-z0-9_-]{20,64}$' then
    v_start_param := regexp_replace(v_text,'^/start[[:space:]]+','','');

    select t.id,t.user_id
      into v_link_id,v_target
    from app_private.telegram_link_tokens t
    where t.token_hash=encode(extensions.digest(v_start_param,'sha256'),'hex')
      and t.consumed_at is null
      and t.invalidated_at is null
      and t.expires_at>now()
    for update;

    if v_target is not null then
      if exists(
        select 1 from public.bot_users
        where telegram_user_id=v_user_id and id<>v_target
      ) then
        raise exception 'telegram_identity_conflict';
      end if;

      select * into v_user
      from public.bot_users
      where id=v_target
      for update;

      if not found or not v_user.is_active then
        raise exception 'telegram_link_target_unavailable';
      end if;

      if (v_user.telegram_user_id is not null and v_user.telegram_user_id<>v_user_id)
         or (v_user.chat_id is not null and v_user.chat_id<>v_chat_id)
      then
        raise exception 'telegram_identity_conflict';
      end if;

      update public.bot_users
      set telegram_user_id=v_user_id,
          chat_id=v_chat_id,
          username=v_username,
          first_name=coalesce(first_name,v_first_name),
          last_name=coalesce(last_name,v_last_name),
          language_code=v_language_code,
          last_start_at=now(),
          updated_at=now()
      where id=v_target
      returning * into v_user;

      update app_private.telegram_link_tokens
      set consumed_at=now()
      where id=v_link_id;
    end if;
  end if;

  if v_user.id is null then
    select * into v_user
    from public.bot_users
    where telegram_user_id=v_user_id;

    if found then
      if v_user.chat_id is distinct from v_chat_id
         or v_user.username is distinct from v_username
         or v_user.first_name is distinct from v_first_name
         or v_user.last_name is distinct from v_last_name
         or v_user.language_code is distinct from v_language_code
      then
        update public.bot_users
        set chat_id=v_chat_id,
            username=v_username,
            first_name=v_first_name,
            last_name=v_last_name,
            language_code=v_language_code,
            updated_at=now()
        where id=v_user.id
        returning * into v_user;
      end if;
    else
      insert into public.bot_users(
        telegram_user_id,chat_id,username,first_name,last_name,
        language_code,last_start_at,origin
      )
      values(
        v_user_id,v_chat_id,v_username,v_first_name,v_last_name,
        v_language_code,now(),'telegram'
      )
      returning * into v_user;
      v_is_new:=true;
    end if;
  end if;

  select * into v_subscription
  from public.user_subscriptions
  where user_id=v_user.id;

  return jsonb_build_object(
    'claim',v_claim,
    'is_new_user',v_is_new,
    'user',to_jsonb(v_user),
    'subscription',case when v_subscription.id is null then null else to_jsonb(v_subscription) end
  );
end
$function$;

create or replace function app_private.invalidate_participant_tickets()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op='UPDATE'
     and (
       new.coach_member_id is distinct from old.coach_member_id
       or new.status is distinct from old.status
       or new.assignment_version is distinct from old.assignment_version
     )
  then
    update public.platform_auth_flows
    set consumed_at=coalesce(consumed_at,now())
    where user_id=new.user_id and consumed_at is null;

    update app_private.telegram_link_tokens
    set invalidated_at=coalesce(invalidated_at,now())
    where user_id=new.user_id
      and consumed_at is null
      and invalidated_at is null;
  end if;
  return new;
end
$function$;

drop trigger if exists coaching_participant_invalidate_tickets on public.coaching_participants;
create trigger coaching_participant_invalidate_tickets
after update on public.coaching_participants
for each row execute function app_private.invalidate_participant_tickets();

create index if not exists application_document_package_items_document_id_idx
  on public.application_document_package_items(document_id);
create index if not exists application_document_packages_user_id_idx
  on public.application_document_packages(user_id);
create index if not exists application_document_transfers_user_id_idx
  on public.application_document_transfers(user_id);

alter table public.coaching_workspaces enable row level security;
alter table public.coaching_members enable row level security;
alter table public.coaching_participants enable row level security;
alter table public.coaching_audit_events enable row level security;
alter table public.application_preferences enable row level security;
alter table public.application_events enable row level security;

revoke all on table public.coaching_workspaces from anon,authenticated;
revoke all on table public.coaching_members from anon,authenticated;
revoke all on table public.coaching_participants from anon,authenticated;
revoke all on table public.coaching_audit_events from anon,authenticated;
revoke all on table public.application_preferences from anon,authenticated;
revoke all on table public.application_events from anon,authenticated;

comment on table public.application_preferences is
  'Canonical AutoApply preferences shared by Telegram and Coach Portal.';
comment on column public.bot_users.origin is
  'Participant creation origin. Telegram is optional; bot_users.id remains canonical.';
comment on column public.delivery_events.channel is
  'Delivery surface: telegram sends a Telegram card; web records an available portal match.';
