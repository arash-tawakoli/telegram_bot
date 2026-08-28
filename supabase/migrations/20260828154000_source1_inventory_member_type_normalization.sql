create or replace function app_private.normalize_immoscout_inventory_member_type()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_type text;
begin
  select l.property_type into v_type
  from public.listings l
  where l.source_id=1 and l.source_listing_key=new.external_id
  order by l.last_seen_at desc nulls last
  limit 1;
  if v_type is not null then new.property_type:=v_type; end if;
  return new;
end;
$$;

drop trigger if exists immoscout_inventory_members_normalize_type on public.immoscout_inventory_members;
create trigger immoscout_inventory_members_normalize_type
before insert or update of property_type,external_id on public.immoscout_inventory_members
for each row execute function app_private.normalize_immoscout_inventory_member_type();

create or replace function app_private.sync_immoscout_inventory_member_type_from_listing()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.source_id=1 and new.source_listing_key is not null and new.property_type is not null then
    update public.immoscout_inventory_members m
    set property_type=new.property_type
    where m.external_id=new.source_listing_key
      and m.property_type is distinct from new.property_type;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_sync_immoscout_inventory_member_type on public.listings;
create trigger listings_sync_immoscout_inventory_member_type
after insert or update of source_id,source_listing_key,property_type on public.listings
for each row execute function app_private.sync_immoscout_inventory_member_type_from_listing();

update public.immoscout_inventory_members m
set property_type=l.property_type
from public.listings l
where l.source_id=1
  and l.source_listing_key=m.external_id
  and l.property_type is not null
  and m.property_type is distinct from l.property_type;
