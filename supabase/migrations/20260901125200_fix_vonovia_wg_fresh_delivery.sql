-- Restore fresh-delivery semantics for WG-Gesucht and Vonovia without changing crawler architecture.

-- WG-Gesucht source 6 is a newest-first paginated search. The canonical worker
-- already honors this connector flag by marking only page 1 as delivery-fresh.
update public.source_connectors
set config = coalesce(config, '{}'::jsonb) || '{"freshness_mode":"newest_first"}'::jsonb
where source_id = 6
  and priority = 1
  and enabled = true;

-- Vonovia source 5 is a partial provider mirror. Keep the initial baseline blocked,
-- but mark a genuinely new source key as fresh once a baseline already exists.
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
