-- Remove the former partner/household mode and replace referral credits with
-- a one-time seven-day Premium entitlement for the referred account.

do $$
declare r record;
begin
  if to_regclass('cron.job') is not null then
    for r in select jobid from cron.job where jobname = 'billing-maintenance-daily'
    loop
      perform cron.unschedule(r.jobid);
    end loop;
  end if;
end
$$;

alter table public.referrals
  add column if not exists premium_granted_until timestamptz;

update public.bot_users u
set referral_bonus_until = greatest(now(), coalesce(u.referral_bonus_until, now())) + interval '7 days',
    updated_at = now()
from public.referrals r
where r.referred_user_id = u.id
  and r.status <> 'rejected'
  and r.premium_granted_until is null;

update public.referrals r
set status = 'rewarded',
    qualified_at = coalesce(r.qualified_at, now()),
    rewarded_at = coalesce(r.rewarded_at, now()),
    premium_granted_until = u.referral_bonus_until
from public.bot_users u
where u.id = r.referred_user_id
  and r.status <> 'rejected'
  and r.premium_granted_until is null;

do $$
declare r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('grant_referral_reward', 'qualify_referral_reward')
  loop
    execute format('drop function %I.%I(%s)', r.nspname, r.proname, r.args);
  end loop;
end
$$;

create or replace function public.redeem_referral_code(
  p_referred_user_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referrer_user_id uuid;
  v_referral_id uuid;
  v_premium_until timestamptz;
begin
  if p_referred_user_id is null or nullif(trim(p_code), '') is null then
    return jsonb_build_object('status', 'invalid_code');
  end if;

  select rc.user_id
    into v_referrer_user_id
  from public.referral_codes rc
  where lower(rc.code) = lower(trim(p_code))
  limit 1;

  if v_referrer_user_id is null then
    return jsonb_build_object('status', 'invalid_code');
  end if;

  if v_referrer_user_id = p_referred_user_id then
    return jsonb_build_object('status', 'self_referral');
  end if;

  select r.id, r.premium_granted_until
    into v_referral_id, v_premium_until
  from public.referrals r
  where r.referred_user_id = p_referred_user_id
  limit 1;

  if v_referral_id is not null then
    return jsonb_build_object(
      'status', 'already_redeemed',
      'premium_until', v_premium_until
    );
  end if;

  select greatest(now(), coalesce(u.referral_bonus_until, now())) + interval '7 days'
    into v_premium_until
  from public.bot_users u
  where u.id = p_referred_user_id
  for update;

  if v_premium_until is null then
    return jsonb_build_object('status', 'user_not_found');
  end if;

  insert into public.referrals(
    referrer_user_id,
    referred_user_id,
    status,
    qualified_at,
    rewarded_at,
    premium_granted_until
  ) values (
    v_referrer_user_id,
    p_referred_user_id,
    'rewarded',
    now(),
    now(),
    v_premium_until
  )
  on conflict (referred_user_id) do nothing
  returning id into v_referral_id;

  if v_referral_id is null then
    select r.premium_granted_until
      into v_premium_until
    from public.referrals r
    where r.referred_user_id = p_referred_user_id;

    return jsonb_build_object(
      'status', 'already_redeemed',
      'premium_until', v_premium_until
    );
  end if;

  update public.bot_users
  set referral_bonus_until = v_premium_until,
      updated_at = now()
  where id = p_referred_user_id;

  return jsonb_build_object(
    'status', 'granted',
    'premium_until', v_premium_until,
    'referrer_user_id', v_referrer_user_id
  );
end
$$;

revoke all on function public.redeem_referral_code(uuid, text) from public;
revoke all on function public.redeem_referral_code(uuid, text) from anon;
revoke all on function public.redeem_referral_code(uuid, text) from authenticated;
grant execute on function public.redeem_referral_code(uuid, text) to service_role;

create or replace function app_private.queue_listing_delivery_v3()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_group uuid;
  v_primary boolean;
  v_source_ready boolean;
  v_source_type text;
  v_haystack text := lower(concat_ws(' ', new.property_type, new.title, new.district, new.address, new.raw::text));
begin
  if new.quality_status = 'rejected'
     or not coalesce(new.enrichment_delivery_eligible, true)
     or not coalesce(new.fresh_delivery_eligible, false) then
    return new;
  end if;

  if v_haystack ~ '(^|[[:space:]])(ich|wir)[[:space:]]+suche(n)?[[:space:]].{0,40}(wohnung|apartment|wg-zimmer|zimmer|haus)'
     or v_haystack ~ '[[:space:]]sucht[[:space:]]+(dringend[[:space:]]+)?(eine[nr]?[[:space:]]+)?(wohnung|apartment|wg-zimmer|zimmer|haus)'
     or v_haystack ~ '^[[:space:]]*(wohnung|apartment|wg-zimmer|zimmer|haus)[[:space:]]+gesucht' then
    return new;
  end if;

  select (s.enabled and s.runtime_mode = 'live' and s.delivery_mode = 'live'), s.source_type
    into v_source_ready, v_source_type
  from public.sources s
  where s.id = new.source_id;

  if not coalesce(v_source_ready, false) then
    perform app_private.assign_listing_dedupe(new.id);
    return new;
  end if;

  v_group := app_private.assign_listing_dedupe(new.id);
  select l.is_primary_listing into v_primary
  from public.listings l
  where l.id = new.id;

  if not coalesce(v_primary, false) or v_group is null then
    return new;
  end if;

  insert into public.delivery_events(
    profile_id,
    listing_id,
    dedupe_key,
    status,
    delivery_format,
    recipient_user_id,
    next_retry_at
  )
  select
    p.id,
    new.id,
    'group:' || v_group::text,
    'pending',
    'photo_card',
    p.user_id,
    case
      when app_private.user_is_premium(p.user_id) then null
      else new.first_seen_at + interval '2 hours'
    end
  from public.search_profiles p
  join public.bot_users owner_user
    on owner_user.id = p.user_id
   and owner_user.is_active = true
  where p.is_active = true
    and (p.profile_slot = 1 or app_private.user_is_premium(p.user_id))
    and (v_source_type <> 'Baugenossenschaft' or app_private.user_is_premium(p.user_id))
    and (
      coalesce(cardinality(p.property_types), 0) = 0
      or (
        v_haystack ~ '(tauschwohnung|tauschangebot|wohnungstausch|wohnung[[:space:]-]*tausch|tausche)'
        and 'Tauschwohnung' = any(p.property_types)
      )
      or (
        v_haystack !~ '(tauschwohnung|tauschangebot|wohnungstausch|wohnung[[:space:]-]*tausch|tausche)'
        and coalesce(new.property_type, 'Wohnung') = any(p.property_types)
      )
    )
    and (
      p.max_warm_rent is null
      or (
        coalesce(nullif(new.warm_rent, 0), nullif(new.cold_rent, 0)) is not null
        and coalesce(nullif(new.warm_rent, 0), nullif(new.cold_rent, 0)) <= p.max_warm_rent
      )
    )
    and (not p.require_known_warm_rent or coalesce(new.warm_rent, 0) > 0)
    and (p.max_deposit is null or new.deposit is null or new.deposit <= p.max_deposit)
    and (not p.wbs_only or new.wbs_required is true)
    and (
      p.furnished_preference = 'any'
      or (p.furnished_preference = 'yes' and new.furnished is true)
      or (p.furnished_preference = 'no' and new.furnished is false)
    )
    and (coalesce(p.min_rooms, 0) <= 0 or new.rooms is null or new.rooms >= p.min_rooms)
    and (coalesce(p.min_area_sqm, 0) <= 0 or new.area_sqm is null or new.area_sqm >= p.min_area_sqm)
    and (
      p.location_mode = 'all_hamburg'
      or (p.location_mode = 'boroughs' and coalesce(cardinality(p.boroughs), 0) >= 7)
      or (
        p.location_mode = 'neighborhoods'
        and exists (
          select 1
          from unnest(p.neighborhoods) n
          where lower(concat_ws(' ', new.district, new.address, new.title, new.raw::text)) like '%' || lower(n) || '%'
        )
      )
      or (
        p.location_mode = 'boroughs'
        and exists (
          select 1
          from public.hamburg_neighborhoods hn
          join public.hamburg_boroughs hb on hb.id = hn.borough_id
          where hb.name = any(p.boroughs)
            and lower(concat_ws(' ', new.district, new.address, new.title, new.raw::text)) like '%' || lower(hn.name) || '%'
        )
      )
      or (
        coalesce(cardinality(p.districts), 0) > 0
        and (
          'Ganz Hamburg' = any(p.districts)
          or exists (
            select 1
            from unnest(p.districts) d
            where lower(concat_ws(' ', new.district, new.address, new.title, new.raw::text)) like '%' || lower(d) || '%'
          )
        )
      )
    )
  on conflict do nothing;

  return new;
end
$$;

do $$
declare r record;
begin
  for r in
    select t.tgname, n.nspname, c.relname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal
      and pn.nspname = 'app_private'
      and p.proname = 'queue_saved_listing_change'
  loop
    execute format('drop trigger %I on %I.%I', r.tgname, r.nspname, r.relname);
  end loop;
end
$$;

create or replace function app_private.queue_saved_listing_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.delivery_events(
    profile_id,
    listing_id,
    dedupe_key,
    status,
    delivery_format,
    recipient_user_id,
    event_type,
    change_id,
    next_retry_at
  )
  select
    profile.id,
    new.listing_id,
    'change:' || new.id::text || ':' || sl.user_id::text,
    'pending',
    'photo_card',
    sl.user_id,
    'listing_changed',
    new.id,
    null
  from public.saved_listings sl
  join public.bot_users u
    on u.id = sl.user_id
   and u.is_active = true
  join lateral (
    select p.id
    from public.search_profiles p
    where p.user_id = sl.user_id
      and p.is_active = true
    order by p.profile_slot, p.created_at
    limit 1
  ) profile on true
  where sl.listing_id = new.listing_id
  on conflict do nothing;

  return new;
end
$$;

create trigger listing_changes_queue_saved_notifications
  after insert on public.listing_changes
  for each row
  execute function app_private.queue_saved_listing_change();

update public.search_profiles set household_id = null where household_id is not null;
update public.saved_listings set household_id = null where household_id is not null;

drop trigger if exists saved_listings_sync_household on public.saved_listings;

do $$
declare r record;
begin
  for r in
    select t.tgname, n.nspname, c.relname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and c.relname in ('household_members', 'household_invites', 'households')
      and n.nspname = 'public'
  loop
    execute format('drop trigger %I on %I.%I', r.tgname, r.nspname, r.relname);
  end loop;
end
$$;

drop function if exists app_private.cleanup_household_member_data();
drop function if exists app_private.enforce_household_member_limit();
drop function if exists app_private.initialize_household_member_data();
drop function if exists app_private.sync_household_saved_listing();

alter table public.search_profiles drop column if exists household_id;
alter table public.saved_listings drop column if exists household_id;

drop table if exists public.household_invites;
drop table if exists public.household_members;
drop table if exists public.households;
