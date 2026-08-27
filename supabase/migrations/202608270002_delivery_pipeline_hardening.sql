alter table public.delivery_events
  add column if not exists recipient_user_id uuid references public.bot_users(id) on delete cascade;

create or replace function app_private.set_delivery_recipient_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select p.user_id into new.recipient_user_id
  from public.search_profiles p
  where p.id = new.profile_id;
  return new;
end;
$$;

drop trigger if exists delivery_events_set_recipient_user on public.delivery_events;
create trigger delivery_events_set_recipient_user
before insert or update of profile_id on public.delivery_events
for each row execute function app_private.set_delivery_recipient_user();

create unique index if not exists delivery_events_recipient_dedupe_active_uidx
  on public.delivery_events(recipient_user_id, dedupe_key)
  where recipient_user_id is not null and status <> 'skipped';

create index if not exists delivery_events_recipient_created_idx
  on public.delivery_events(recipient_user_id, created_at desc)
  where recipient_user_id is not null;

alter table public.delivery_events drop constraint if exists delivery_events_status_check;
alter table public.delivery_events
  add constraint delivery_events_status_check
  check (status in ('pending','processing','sent','failed','skipped'));

create index if not exists delivery_events_processing_lease_idx
  on public.delivery_events(last_attempt_at)
  where status='processing';

drop trigger if exists listings_queue_unknown_rent on public.listings;
drop trigger if exists listings_queue_new_delivery on public.listings;

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
      and s.warmed_up = true
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

create trigger listings_queue_new_delivery
after insert on public.listings
for each row execute function app_private.queue_new_listing_delivery();
