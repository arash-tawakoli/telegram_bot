-- Only proven current-inventory lanes may create Telegram new-listing deliveries.
-- Baselines, deep coverage, additive fallbacks and stale recovery runs remain inventory-only.

create or replace function app_private.current_listing_is_delivery_fresh(
  p_source_id bigint,
  p_raw jsonb,
  p_requested boolean
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_source public.sources%rowtype;
  v_live_connector_count integer := 0;
  v_primary_enumerable boolean := false;
  v_primary_newest_first boolean := false;
begin
  select * into v_source
  from public.sources s
  where s.id = p_source_id;

  if not found
     or not coalesce(v_source.enabled, false)
     or v_source.runtime_mode <> 'live'
     or v_source.delivery_mode <> 'live'
     or v_source.baseline_completed_at is null
     or v_source.last_success_at is null
     or v_source.last_success_at < now() - interval '2 hours' then
    return false;
  end if;

  -- Vonovia is a stable provider snapshot whose worker historically requested false;
  -- only a delta following a recent successful snapshot may be promoted.
  if p_source_id = 5 then
    p_requested := true;
  end if;

  if not coalesce(p_requested, false) then
    return false;
  end if;

  select count(*)
  into v_live_connector_count
  from public.source_connectors c
  where c.source_id = p_source_id
    and c.enabled = true
    and coalesce(c.shadow_only, false) = false;

  select coalesce(c.enumerable, false),
         lower(coalesce(c.config ->> 'freshness_mode', '')) = 'newest_first'
  into v_primary_enumerable, v_primary_newest_first
  from public.source_connectors c
  where c.source_id = p_source_id
    and c.enabled = true
    and coalesce(c.shadow_only, false) = false
  order by c.priority
  limit 1;

  -- Dedicated discovery lanes with source-native freshness evidence.
  if p_source_id = 1 then
    return lower(coalesce(p_raw ->> 'provider', '')) = 'immoscout_mcp'
       and lower(coalesce(p_raw ->> 'query', '')) like '%neueste inserate%';
  elsif p_source_id = 2 then
    return lower(coalesce(p_raw ->> 'discovery_lane', '')) = 'front';
  elsif p_source_id = 3 then
    return lower(coalesce(p_raw ->> 'is_new', 'false')) = 'true';
  elsif p_source_id = 5 then
    return true;
  end if;

  -- Newest-first front pages are deliverable; their deep pages request false.
  if v_primary_newest_first then
    return true;
  end if;

  -- Dedicated tenant APIs are authoritative complete snapshots. Additional
  -- diagnostic connectors do not participate in their worker path.
  if v_source.coverage_strategy = 'tenant_api'
     and v_primary_enumerable
     and v_source.coverage_status = 'complete' then
    return true;
  end if;

  -- Other complete snapshots are trusted only with one live connector, so an
  -- additive fallback cannot introduce an old listing as a new delivery.
  if v_live_connector_count = 1
     and v_primary_enumerable
     and v_source.coverage_status = 'complete' then
    return true;
  end if;

  return false;
end;
$$;

create or replace function app_private.guard_current_listing_delivery()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Freshness is immutable after first discovery. A later parser or fallback
    -- may enrich a listing, but it may never promote an old row to "new".
    new.fresh_delivery_eligible := old.fresh_delivery_eligible;
    return new;
  end if;

  new.fresh_delivery_eligible := app_private.current_listing_is_delivery_fresh(
    new.source_id,
    coalesce(new.raw, '{}'::jsonb),
    coalesce(new.fresh_delivery_eligible, false)
  );
  return new;
end;
$$;

-- Replace the former source-specific Vonovia promotion with the central guard.
drop trigger if exists trg_vonovia_fresh_insert on public.listings;
drop function if exists public.mark_vonovia_fresh_insert();

drop trigger if exists zz_guard_current_listing_delivery on public.listings;
create trigger zz_guard_current_listing_delivery
before insert or update on public.listings
for each row
execute function app_private.guard_current_listing_delivery();

revoke all on function app_private.current_listing_is_delivery_fresh(bigint, jsonb, boolean)
  from public, anon, authenticated;
revoke all on function app_private.guard_current_listing_delivery()
  from public, anon, authenticated;

-- Normalize previously stored flags to the same policy. Already sent Telegram
-- messages are historical and cannot be recalled; this prevents re-queuing.
update public.listings l
set fresh_delivery_eligible = false
where coalesce(l.fresh_delivery_eligible, false) = true
  and not app_private.current_listing_is_delivery_fresh(
    l.source_id,
    coalesce(l.raw, '{}'::jsonb),
    true
  );

-- Do not release delayed/retry events that were created from an unverified lane,
-- an inactive listing, or a delivery already more than six hours old.
update public.delivery_events de
set status = 'skipped',
    next_retry_at = null,
    error_message = coalesce(de.error_message, 'freshness_guard: stale or unverified discovery')
from public.listings l
where l.id = de.listing_id
  and de.event_type = 'new_listing'
  and de.status in ('pending', 'failed')
  and (
    not coalesce(l.fresh_delivery_eligible, false)
    or not coalesce(l.is_active, false)
    or de.created_at < now() - interval '6 hours'
  );
