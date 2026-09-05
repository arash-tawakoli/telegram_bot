create or replace function public.mark_selected_sources_fresh_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.fresh_delivery_eligible is not true
     and new.source_id in (5, 6)
     and exists (
       select 1
       from public.sources s
       where s.id = new.source_id
         and s.baseline_completed_at is not null
     )
  then
    new.fresh_delivery_eligible := true;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_vonovia_fresh_insert on public.listings;
drop trigger if exists trg_selected_sources_fresh_insert on public.listings;
create trigger trg_selected_sources_fresh_insert
before insert on public.listings
for each row
when (new.source_id in (5, 6))
execute function public.mark_selected_sources_fresh_insert();
