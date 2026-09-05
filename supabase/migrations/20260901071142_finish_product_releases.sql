-- Finish the interrupted product releases without changing source crawling or dedupe.

alter table public.referrals
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_credit_transaction_id text,
  add column if not exists reward_amount_cents integer not null default 499;

alter table public.referrals
  drop constraint if exists referrals_reward_amount_cents_check;
alter table public.referrals
  add constraint referrals_reward_amount_cents_check
  check (reward_amount_cents > 0 and reward_amount_cents <= 100000);

create unique index if not exists referrals_stripe_credit_transaction_uidx
  on public.referrals(stripe_credit_transaction_id)
  where stripe_credit_transaction_id is not null;

-- Legacy rows predate recipient-aware delivery. Backfill them before enforcing the invariant.
update public.delivery_events e
set recipient_user_id = p.user_id
from public.search_profiles p
where e.profile_id = p.id
  and e.recipient_user_id is null;

alter table public.delivery_events
  alter column recipient_user_id set not null;

-- The old profile-only uniqueness blocked one event per household recipient.
alter table public.delivery_events
  drop constraint if exists delivery_events_profile_id_dedupe_key_key;

create index if not exists delivery_events_change_id_idx
  on public.delivery_events(change_id);
create index if not exists route_cache_destination_id_idx
  on public.route_cache(destination_id);
create index if not exists saved_listings_household_id_idx
  on public.saved_listings(household_id);
create index if not exists search_profiles_household_id_idx
  on public.search_profiles(household_id);
create index if not exists user_source_mutes_source_id_idx
  on public.user_source_mutes(source_id);

-- Serialize household joins and enforce the two-member product limit in the database.
create or replace function app_private.enforce_household_member_limit()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_owner uuid;
  v_count integer;
begin
  select h.owner_user_id into v_owner
  from public.households h
  where h.id = new.household_id
  for update;

  if v_owner is null then
    raise exception 'household not found';
  end if;
  if new.role = 'owner' and new.user_id <> v_owner then
    raise exception 'household owner mismatch';
  end if;

  select count(*) into v_count
  from public.household_members hm
  where hm.household_id = new.household_id;

  if v_count >= 2 then
    raise exception 'household member limit reached';
  end if;
  return new;
end;
$function$;

drop trigger if exists household_members_enforce_limit on public.household_members;
create trigger household_members_enforce_limit
before insert on public.household_members
for each row execute function app_private.enforce_household_member_limit();

-- Capture only product-relevant changes, now including canonical URL changes.
create or replace function app_private.capture_listing_changes()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  f text[] := '{}';
  ov jsonb := '{}';
  nv jsonb := '{}';
begin
  if old.warm_rent is distinct from new.warm_rent then
    f := f || 'warm_rent'; ov := ov || jsonb_build_object('warm_rent', old.warm_rent); nv := nv || jsonb_build_object('warm_rent', new.warm_rent);
  end if;
  if old.cold_rent is distinct from new.cold_rent then
    f := f || 'cold_rent'; ov := ov || jsonb_build_object('cold_rent', old.cold_rent); nv := nv || jsonb_build_object('cold_rent', new.cold_rent);
  end if;
  if old.deposit is distinct from new.deposit then
    f := f || 'deposit'; ov := ov || jsonb_build_object('deposit', old.deposit); nv := nv || jsonb_build_object('deposit', new.deposit);
  end if;
  if old.rooms is distinct from new.rooms then
    f := f || 'rooms'; ov := ov || jsonb_build_object('rooms', old.rooms); nv := nv || jsonb_build_object('rooms', new.rooms);
  end if;
  if old.area_sqm is distinct from new.area_sqm then
    f := f || 'area_sqm'; ov := ov || jsonb_build_object('area_sqm', old.area_sqm); nv := nv || jsonb_build_object('area_sqm', new.area_sqm);
  end if;
  if old.available_from is distinct from new.available_from then
    f := f || 'available_from'; ov := ov || jsonb_build_object('available_from', old.available_from); nv := nv || jsonb_build_object('available_from', new.available_from);
  end if;
  if old.canonical_url is distinct from new.canonical_url then
    f := f || 'canonical_url'; ov := ov || jsonb_build_object('canonical_url', old.canonical_url); nv := nv || jsonb_build_object('canonical_url', new.canonical_url);
  end if;
  if old.is_active is distinct from new.is_active then
    f := f || 'is_active'; ov := ov || jsonb_build_object('is_active', old.is_active); nv := nv || jsonb_build_object('is_active', new.is_active);
  end if;

  if cardinality(f) > 0 then
    insert into public.listing_changes(listing_id, changed_fields, old_values, new_values)
    values (new.id, f, ov, nv);
  end if;
  return new;
end;
$function$;

-- Queue one event per actual recipient and apply every deterministic profile rule up front.
create or replace function app_private.queue_listing_delivery_v3()
returns trigger
language plpgsql
set search_path = ''
as $function$
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
    recipient.user_id,
    case
      when app_private.user_is_premium(p.user_id) then null
      else new.first_seen_at + interval '2 hours'
    end
  from public.search_profiles p
  join public.bot_users owner_user
    on owner_user.id = p.user_id
   and owner_user.is_active = true
  cross join lateral (
    select p.user_id as user_id
    union
    select hm.user_id
    from public.household_members hm
    where p.household_id is not null
      and hm.household_id = p.household_id
  ) recipient
  join public.bot_users recipient_user
    on recipient_user.id = recipient.user_id
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
    and not exists (
      select 1
      from public.listing_feedback f
      where f.user_id = recipient.user_id
        and f.dedupe_key = 'group:' || v_group::text
    )
    and not exists (
      select 1
      from public.user_source_mutes m
      where m.user_id = recipient.user_id
        and m.source_id = new.source_id
    )
  on conflict do nothing;

  return new;
end;
$function$;

-- Saved-listing changes are also recipient-aware and use the shared household profile.
create or replace function app_private.queue_saved_listing_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
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
    'change:' || new.id::text || ':' || recipient.user_id::text,
    'pending',
    'text',
    recipient.user_id,
    'listing_changed',
    new.id
  from public.saved_listings s
  cross join lateral (
    select s.user_id as user_id
    union
    select hm.user_id
    from public.household_members hm
    where s.household_id is not null
      and hm.household_id = s.household_id
  ) recipient
  join public.bot_users bu
    on bu.id = recipient.user_id
   and bu.is_active = true
  join lateral (
    select p.id
    from public.search_profiles p
    where (s.household_id is not null and p.household_id = s.household_id)
       or (s.household_id is null and p.user_id = s.user_id)
    order by p.profile_slot
    limit 1
  ) profile on true
  where s.listing_id = new.listing_id
  on conflict do nothing;

  return new;
end;
$function$;

-- Atomic, retryable Stripe webhook event claiming.
create or replace function public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_event_created bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text;
  v_updated_at timestamptz;
begin
  insert into public.stripe_webhook_events(
    event_id, event_type, event_created, status, attempts, updated_at
  ) values (
    p_event_id, p_event_type, p_event_created, 'processing', 1, now()
  )
  on conflict (event_id) do nothing;

  if found then
    return 'claimed';
  end if;

  select e.status, e.updated_at
    into v_status, v_updated_at
  from public.stripe_webhook_events e
  where e.event_id = p_event_id
  for update;

  if v_status = 'processed' then
    return 'duplicate';
  end if;
  if v_status = 'processing' and v_updated_at > now() - interval '10 minutes' then
    return 'busy';
  end if;

  update public.stripe_webhook_events
  set event_type = p_event_type,
      event_created = p_event_created,
      status = 'processing',
      attempts = attempts + 1,
      last_error = null,
      updated_at = now()
  where event_id = p_event_id;

  return 'claimed';
end;
$function$;

create or replace function public.finish_stripe_webhook_event(
  p_event_id text,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_status not in ('processed', 'failed') then
    raise exception 'invalid webhook status';
  end if;

  update public.stripe_webhook_events
  set status = p_status,
      processed_at = case when p_status = 'processed' then now() else processed_at end,
      last_error = case when p_status = 'failed' then left(coalesce(p_error, 'unknown error'), 2000) else null end,
      updated_at = now()
  where event_id = p_event_id;
end;
$function$;

create or replace function public.qualify_referral_reward(p_referred_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_referral_id uuid;
begin
  select r.id into v_referral_id
  from public.referrals r
  where r.referred_user_id = p_referred_user_id
    and r.status in ('subscribed', 'qualified')
    and r.rewarded_at is null
  for update;

  if v_referral_id is null then
    return null;
  end if;

  update public.referrals
  set status = 'qualified',
      qualified_at = coalesce(qualified_at, now())
  where id = v_referral_id;

  return v_referral_id;
end;
$function$;

revoke all on function public.claim_stripe_webhook_event(text, text, bigint) from public, anon, authenticated;
revoke all on function public.finish_stripe_webhook_event(text, text, text) from public, anon, authenticated;
revoke all on function public.qualify_referral_reward(uuid) from public, anon, authenticated;
grant execute on function public.claim_stripe_webhook_event(text, text, bigint) to service_role;
grant execute on function public.finish_stripe_webhook_event(text, text, text) to service_role;
grant execute on function public.qualify_referral_reward(uuid) to service_role;
