-- Restore fresh-delivery semantics for WG-Gesucht and Vonovia without changing crawler architecture.

update public.source_connectors
set config = coalesce(config, '{}'::jsonb) || '{"freshness_mode":"newest_first"}'::jsonb
where source_id = 6
  and priority = 1
  and enabled = true;

create or replace function public.mark_vonovia_fresh_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.fresh_delivery_eligible is not true
     and exists (
       select 1
       from public.sources s
       where s.id = 5
         and s.baseline_completed_at is not null
     )
     and not exists (
       select 1
       from public.listings l
       where l.source_id = 5
         and l.source_listing_key = new.source_listing_key
     )
  then
    new.fresh_delivery_eligible := true;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_vonovia_fresh_insert on public.listings;
create trigger trg_vonovia_fresh_insert
before insert on public.listings
for each row
when (new.source_id = 5)
execute function public.mark_vonovia_fresh_insert();
