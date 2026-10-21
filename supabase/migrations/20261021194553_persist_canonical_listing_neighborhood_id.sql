
insert into app_private.hamburg_neighborhood_aliases(alias,neighborhood_id)
values ('neugraben',100),('fischbek',100)
on conflict (alias) do update set neighborhood_id=excluded.neighborhood_id;

alter table public.listings
  add column if not exists neighborhood_id smallint references public.hamburg_neighborhoods(id);

create or replace function public.sync_listing_neighborhood_id()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  new.neighborhood_id := public.normalize_hamburg_neighborhood(new.district);
  return new;
end;
$function$;

drop trigger if exists listings_sync_neighborhood_id on public.listings;
create trigger listings_sync_neighborhood_id
before insert or update of district on public.listings
for each row execute function public.sync_listing_neighborhood_id();

update public.listings
set neighborhood_id=public.normalize_hamburg_neighborhood(district)
where neighborhood_id is distinct from public.normalize_hamburg_neighborhood(district);

create index if not exists listings_neighborhood_id_idx on public.listings(neighborhood_id);
