create or replace function public.preserve_verified_portal_warm_rent()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source_id in (1, 3)
     and new.warm_rent is null
     and old.warm_rent is not null
     and old.warm_rent_is_calculated is false then
    new.warm_rent := old.warm_rent;
    new.warm_rent_is_calculated := false;
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_verified_portal_warm_rent on public.listings;
create trigger preserve_verified_portal_warm_rent
before update of warm_rent on public.listings
for each row
execute function public.preserve_verified_portal_warm_rent();
