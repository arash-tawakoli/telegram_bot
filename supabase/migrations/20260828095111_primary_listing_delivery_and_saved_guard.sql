-- Production migration mirror: only enriched primary listings may be delivered or saved as canonical duplicates.

create or replace function app_private.require_enriched_delivery_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  l record;
begin
  select enrichment_delivery_eligible, enrichment_status, is_primary_listing, quality_status
  into l
  from public.listings
  where id = new.listing_id;

  if found and (
    coalesce(l.enrichment_delivery_eligible, false) = false
    or coalesce(l.enrichment_status, 'pending') <> 'done'
    or coalesce(l.is_primary_listing, false) = false
    or coalesce(l.quality_status, 'unchecked') = 'rejected'
  ) then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists delivery_events_require_enriched_listing on public.delivery_events;
create trigger delivery_events_require_enriched_listing
before insert on public.delivery_events
for each row execute function app_private.require_enriched_delivery_event();

create or replace function app_private.resolve_saved_listing_primary()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_primary uuid;
begin
  select coalesce(duplicate_of_listing_id, id)
  into v_primary
  from public.listings
  where id = new.listing_id;

  if v_primary is not null then new.listing_id := v_primary; end if;
  return new;
end;
$$;

drop trigger if exists saved_listings_resolve_primary on public.saved_listings;
create trigger saved_listings_resolve_primary
before insert or update of listing_id on public.saved_listings
for each row execute function app_private.resolve_saved_listing_primary();

-- Suppress any still-open work for non-primary duplicates.
update public.matches m
set status = 'suppressed', updated_at = now()
where status = 'matched'
  and exists (
    select 1 from public.listings l
    where l.id = m.listing_id and coalesce(l.is_primary_listing, false) = false
  );

update public.delivery_events de
set status = 'skipped', next_retry_at = null, error_message = 'Suppressed by higher-priority duplicate'
where status in ('pending','failed')
  and exists (
    select 1 from public.listings l
    where l.id = de.listing_id and coalesce(l.is_primary_listing, false) = false
  );
