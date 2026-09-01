-- Remove Partner mode and replace Stripe referral credits with a one-time
-- seven-day Premium entitlement for the referred user.

-- The old billing-maintenance worker only processed Stripe referral credits.
select cron.unschedule(jobid)
from cron.job
where jobname = 'billing-maintenance-daily';

-- Remove Partner-mode triggers before detaching the single-owner data.
drop trigger if exists saved_listings_sync_household on public.saved_listings;
drop trigger if exists household_members_cleanup_data on public.household_members;
drop trigger if exists household_members_enforce_limit on public.household_members;
drop trigger if exists household_members_initialize_data on public.household_members;

update public.saved_listings
set household_id = null,
    updated_at = now()
where household_id is not null;

update public.search_profiles
set household_id = null,
    updated_at = now()
where household_id is not null;

-- Deliver each listing only to the owner of the matching profile.
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
  join public.bot_users recipient_user
    on recipient_user.id = p.user_id
   and recipient_user.is_active = true
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
end;
$$;

-- Saved-listing change notifications are now user-owned only.
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
    change_id
  )
  select
    profile.id,
    new.listing_id,
    'change:' || new.id::text || ':' || s.user_id::text,
    'pending',
    'text',
    s.user_id,
    'listing_changed',
    new.id
  from public.saved_listings s
  join public.bot_users bu
    on bu.id = s.user_id
   and bu.is_active = true
  join lateral (
    select p.id
    from public.search_profiles p
    where p.user_id = s.user_id
    order by p.profile_slot
    limit 1
  ) profile on true
  where s.listing_id = new.listing_id
  on conflict do nothing;

  return new;
end;
$$;

-- Remove all Partner-mode database structures.
drop function if exists app_private.sync_household_saved_listing();
drop function if exists app_private.cleanup_household_member_data();
drop function if exists app_private.enforce_household_member_limit();
drop function if exists app_private.initialize_household_member_data();

alter table public.saved_listings drop column if exists household_id;
alter table public.search_profiles drop column if exists household_id;

drop table if exists public.household_invites;
drop table if exists public.household_members;
drop table if exists public.households;

-- Convert any already registered referral exactly once.
alter table public.referrals add column if not exists claimed_at timestamptz;

update public.bot_users bu
set referral_bonus_until = greatest(
      now(),
      coalesce(bu.referral_bonus_until, '-infinity'::timestamptz),
      coalesce(
        case
when bu.plan_override = 'premium' then bu.plan_override_expires_at
else null
        end,
        '-infinity'::timestamptz
      ),
      coalesce(
        case
when us.status in ('active', 'trialing') then us.current_period_end
else null
        end,
        '-infinity'::timestamptz
      )
    ) + interval '7 days',
    updated_at = now()
from public.referrals r
left join public.user_subscriptions us on us.user_id = r.referred_user_id
where bu.id = r.referred_user_id
  and r.status <> 'rejected';

update public.referrals
set status = 'claimed',
    claimed_at = coalesce(rewarded_at, now())
where status <> 'rejected';

drop function if exists public.grant_referral_reward(uuid);
drop function if exists public.qualify_referral_reward(uuid);

drop index if exists public.referrals_stripe_credit_transaction_uidx;
alter table public.referrals drop constraint if exists referrals_status_check;
alter table public.referrals drop constraint if exists referrals_reward_amount_cents_check;
alter table public.referrals drop column if exists qualified_at;
alter table public.referrals drop column if exists rewarded_at;
alter table public.referrals drop column if exists stripe_customer_id;
alter table public.referrals drop column if exists stripe_credit_transaction_id;
alter table public.referrals drop column if exists reward_amount_cents;
alter table public.referrals alter column status set default 'claimed';
alter table public.referrals
  add constraint referrals_status_check
  check (status in ('claimed', 'rejected'));

alter table public.bot_users drop column if exists referral_bonus_days;

create or replace function public.claim_referral_bonus(
  p_code text,
  p_referred_user_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referrer_user_id uuid;
  v_referral_id uuid;
  v_until timestamptz;
begin
  if p_referred_user_id is null or nullif(trim(p_code), '') is null then
    return null;
  end if;

  select rc.user_id
    into v_referrer_user_id
  from public.referral_codes rc
  where upper(rc.code) = upper(trim(p_code))
    and rc.active = true
  limit 1;

  if v_referrer_user_id is null or v_referrer_user_id = p_referred_user_id then
    return null;
  end if;

  insert into public.referrals(
    referrer_user_id,
    referred_user_id,
    status,
    claimed_at
  )
  values (
    v_referrer_user_id,
    p_referred_user_id,
    'claimed',
    now()
  )
  on conflict (referred_user_id) do nothing
  returning id into v_referral_id;

  if v_referral_id is null then
    return null;
  end if;

  select greatest(
      now(),
      coalesce(bu.referral_bonus_until, '-infinity'::timestamptz),
      coalesce(
        case
when bu.plan_override = 'premium' then bu.plan_override_expires_at
else null
        end,
        '-infinity'::timestamptz
      ),
      coalesce(
        case
when us.status in ('active', 'trialing') then us.current_period_end
else null
        end,
        '-infinity'::timestamptz
      )
    ) + interval '7 days'
    into v_until
  from public.bot_users bu
  left join public.user_subscriptions us on us.user_id = bu.id
  where bu.id = p_referred_user_id
  for update of bu;

  if v_until is null then
    raise exception 'referred user unavailable';
  end if;

  update public.bot_users
  set referral_bonus_until = v_until,
      updated_at = now()
  where id = p_referred_user_id;

  update public.delivery_events de
  set next_retry_at = null
  where de.status = 'pending'
    and de.profile_id in (
      select p.id
      from public.search_profiles p
      where p.user_id = p_referred_user_id
    )
    and de.next_retry_at is not null;

  return v_until;
end;
$$;

revoke all on function public.claim_referral_bonus(text, uuid) from public;
revoke all on function public.claim_referral_bonus(text, uuid) from anon;
revoke all on function public.claim_referral_bonus(text, uuid) from authenticated;
grant execute on function public.claim_referral_bonus(text, uuid) to service_role;
