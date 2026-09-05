update public.sources set poll_interval_minutes=2,updated_at=now() where id=2;
update public.sources set worker_slug='source-kleinanzeigen-fast',updated_at=now() where id=2;
create or replace function public.kleinanzeigen_public_inventory_ready() returns boolean language sql security invoker set search_path='' as $$ select count(*)>=3 from (select id from public.crawl_runs where source_id=2 and connector_label='Kleinanzeigen Public HTML Full Inventory' and success=true and coalesce((metadata->>'snapshot_valid')::boolean,false)=true and coalesce((metadata->>'unique_offers')::integer,0)>=3000 and finished_at>now()-interval '45 minutes' order by finished_at desc limit 3)s; $$;
revoke all on function public.kleinanzeigen_public_inventory_ready() from public,anon,authenticated;
grant execute on function public.kleinanzeigen_public_inventory_ready() to service_role;
