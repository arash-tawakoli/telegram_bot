drop trigger if exists trg_selected_sources_fresh_insert on public.listings;
drop function if exists public.mark_selected_sources_fresh_insert();
drop trigger if exists trg_vonovia_fresh_insert on public.listings;
create trigger trg_vonovia_fresh_insert
before insert on public.listings
for each row
when (new.source_id = 5)
execute function public.mark_vonovia_fresh_insert();
