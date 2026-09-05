drop trigger if exists listings_queue_delivery_on_fresh_enable on public.listings;
create trigger listings_queue_delivery_on_fresh_enable
after update of fresh_delivery_eligible on public.listings
for each row
when (
  old.fresh_delivery_eligible is distinct from true
  and new.fresh_delivery_eligible is true
)
execute function app_private.queue_listing_delivery_v3();
