-- Prevent inventory backfills and delayed replays from being delivered as new listings.

create or replace function app_private.enforce_current_source_freshness()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not coalesce(new.fresh_delivery_eligible, false) then
    return new;
  end if;

  if new.source_id = 1
     and lower(coalesce(new.raw ->> 'query', '')) not like '%neueste inserate%' then
    new.fresh_delivery_eligible := false;
  elsif new.source_id = 2
     and coalesce(new.raw ->> 'lane', '') <> 'fast' then
    new.fresh_delivery_eligible := false;
  elsif new.source_id = 3
     and lower(coalesce(new.raw ->> 'is_new', 'false')) <> 'true' then
    new.fresh_delivery_eligible := false;
  end if;

  return new;
end;
$$;

drop trigger if exists zz_listings_enforce_current_source_freshness on public.listings;
create trigger zz_listings_enforce_current_source_freshness
before insert or update of fresh_delivery_eligible, raw
on public.listings
for each row
execute function app_private.enforce_current_source_freshness();

create or replace function app_private.enforce_current_delivery_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_first_seen_at timestamptz;
  v_is_active boolean;
begin
  if coalesce(new.event_type, 'new_listing') <> 'new_listing' then
    return new;
  end if;

  select l.first_seen_at, l.is_active
    into v_first_seen_at, v_is_active
  from public.listings l
  where l.id = new.listing_id;

  if not found then
    return new;
  end if;

  if not coalesce(v_is_active, false)
     or coalesce(new.created_at, now()) - v_first_seen_at > interval '3 hours' then
    new.status := 'skipped';
    new.next_retry_at := null;
    new.error_message := 'stale listing blocked by current-only delivery guard';
  end if;

  return new;
end;
$$;

drop trigger if exists delivery_events_enforce_current_only on public.delivery_events;
create trigger delivery_events_enforce_current_only
before insert on public.delivery_events
for each row
execute function app_private.enforce_current_delivery_event();

-- Freshness is a one-time delivery property, not a permanent listing property.
update public.listings
set fresh_delivery_eligible = false
where fresh_delivery_eligible is true
  and first_seen_at < now() - interval '3 hours';

update public.delivery_events de
set status = 'skipped',
    next_retry_at = null,
    error_message = 'stale listing blocked by current-only delivery guard'
from public.listings l
where l.id = de.listing_id
  and de.event_type = 'new_listing'
  and de.status in ('pending', 'failed')
  and de.created_at - l.first_seen_at > interval '3 hours';
