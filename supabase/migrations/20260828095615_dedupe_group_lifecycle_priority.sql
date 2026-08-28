-- Production migration mirror: continuously select the best active source within a dedupe group.

create or replace function app_private.refresh_listing_dedupe_group(p_group_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_winner uuid;
begin
  if p_group_id is null then return null; end if;

  select l.id into v_winner
  from public.listings l
  join public.sources s on s.id = l.source_id
  where l.dedupe_group_id = p_group_id
    and l.is_active = true
    and l.quality_status <> 'rejected'
    and l.enrichment_delivery_eligible = true
  order by s.listing_priority asc,
    ((l.resolved_image_url is not null)::int
      + (l.address is not null)::int
      + (l.warm_rent is not null)::int
      + (l.cold_rent is not null)::int
      + (l.rooms is not null)::int
      + (l.area_sqm is not null)::int
      + (l.deposit is not null or l.deposit_text is not null)::int) desc,
    l.first_seen_at asc,
    l.id
  limit 1;

  if v_winner is null then
    update public.listings
    set is_primary_listing = false, duplicate_of_listing_id = null
    where dedupe_group_id = p_group_id;
  else
    update public.listings
    set is_primary_listing = (id = v_winner),
        duplicate_of_listing_id = case when id = v_winner then null else v_winner end
    where dedupe_group_id = p_group_id;
  end if;

  update public.listing_dedupe_groups
  set preferred_listing_id = v_winner, updated_at = now()
  where id = p_group_id;

  return v_winner;
end;
$$;

create or replace function app_private.refresh_listing_dedupe_group_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.dedupe_group_id is not null then
    perform app_private.refresh_listing_dedupe_group(old.dedupe_group_id);
  end if;
  if new.dedupe_group_id is not null and new.dedupe_group_id is distinct from old.dedupe_group_id then
    perform app_private.refresh_listing_dedupe_group(new.dedupe_group_id);
  end if;
  return new;
end;
$$;

drop trigger if exists listings_refresh_dedupe_on_availability on public.listings;
create trigger listings_refresh_dedupe_on_availability
after update of is_active on public.listings
for each row
when (old.is_active is distinct from new.is_active)
execute function app_private.refresh_listing_dedupe_group_trigger();

-- Establish the current winner for all existing groups.
do $$
declare g record;
begin
  for g in select id from public.listing_dedupe_groups loop
    perform app_private.refresh_listing_dedupe_group(g.id);
  end loop;
end;
$$;
