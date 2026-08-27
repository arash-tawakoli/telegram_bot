create or replace function app_private.queue_new_listing_delivery()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.sources s
    where s.id = new.source_id
      and s.enabled = true
      and s.last_success_at is not null
  ) then
    return new;
  end if;

  insert into public.delivery_events (
    profile_id, listing_id, dedupe_key, status, delivery_format
  )
  select distinct on (p.user_id)
    p.id,
    new.id,
    coalesce(new.cross_source_hash, new.source_id::text || ':' || new.source_listing_key),
    'pending',
    'photo_card'
  from public.search_profiles p
  join public.bot_users u on u.id = p.user_id
  where p.is_active = true
    and u.is_active = true
    and (
      coalesce(cardinality(p.property_types), 0) = 0
      or coalesce(new.property_type, 'Wohnung') = any(p.property_types)
    )
    and (
      p.max_warm_rent is null
      or coalesce(new.warm_rent, new.cold_rent) is null
      or coalesce(new.warm_rent, new.cold_rent) <= p.max_warm_rent
    )
    and (
      coalesce(p.min_rooms, 0) <= 0
      or new.rooms is null
      or new.rooms >= p.min_rooms
    )
    and (
      coalesce(p.min_area_sqm, 0) <= 0
      or new.area_sqm is null
      or new.area_sqm >= p.min_area_sqm
    )
    and (not p.wbs_only or coalesce(new.wbs_required, false))
    and (
      coalesce(p.furnished_preference, 'any') = 'any'
      or new.furnished is null
      or (p.furnished_preference in ('yes','furnished') and new.furnished = true)
      or (p.furnished_preference in ('no','unfurnished') and new.furnished = false)
    )
    and (
      coalesce(cardinality(p.districts), 0) = 0
      or 'Ganz Hamburg' = any(p.districts)
      or exists (
        select 1
        from unnest(p.districts) d
        where lower(concat_ws(' ', new.district, new.address, new.title)) like '%' || lower(d) || '%'
      )
    )
  order by p.user_id, p.updated_at desc, p.created_at desc
  on conflict do nothing;

  return new;
end;
$$;

create or replace function app_private.suppress_generic_source_legacy_delivery()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id not in (1,2,3) then
    new.warmed_up := false;
  end if;
  return new;
end;
$$;

drop trigger if exists sources_suppress_generic_legacy_delivery on public.sources;
create trigger sources_suppress_generic_legacy_delivery
before insert or update of warmed_up on public.sources
for each row execute function app_private.suppress_generic_source_legacy_delivery();

update public.sources
set warmed_up=false, updated_at=now()
where id not in (1,2,3) and warmed_up=true;
