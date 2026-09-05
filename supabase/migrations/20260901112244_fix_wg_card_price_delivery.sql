create or replace function app_private.fill_wg_card_rent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  m text[];
begin
  if new.source_id = 6
     and new.warm_rent is null
     and new.cold_rent is null then
    m := regexp_match(
      coalesce(new.raw->>'text', ''),
      '([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)\s*€\s*\|\s*[0-9]'
    );

    if m is not null then
      new.warm_rent := app_private.parse_eur(m[1]);
      new.warm_rent_is_calculated := false;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists listings_wg_card_rent on public.listings;
create trigger listings_wg_card_rent
before insert or update of raw, warm_rent, cold_rent on public.listings
for each row
when (new.source_id = 6)
execute function app_private.fill_wg_card_rent();

drop trigger if exists listings_queue_delivery_when_wg_rent_arrives on public.listings;
create trigger listings_queue_delivery_when_wg_rent_arrives
after update of warm_rent on public.listings
for each row
when (
  new.source_id = 6
  and new.fresh_delivery_eligible is true
  and old.warm_rent is null
  and new.warm_rent is not null
)
execute function app_private.queue_listing_delivery_v3();
