drop trigger if exists preserve_verified_portal_warm_rent on public.listings;
drop trigger if exists aa_preserve_verified_portal_warm_rent on public.listings;

create trigger aa_preserve_verified_portal_warm_rent
before update of warm_rent on public.listings
for each row
execute function public.preserve_verified_portal_warm_rent();
