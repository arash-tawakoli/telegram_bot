create or replace function public.kleinanzeigen_public_inventory_acceptance()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with recent as (
  select id, finished_at, fetched_count, inserted_count,
         coalesce((metadata->>'snapshot_valid')::boolean,false) as snapshot_valid,
         coalesce((metadata->>'coverage_ratio')::numeric,0) as coverage_ratio
  from public.crawl_runs
  where source_id=2
    and connector_label='Kleinanzeigen Public HTML Full Inventory'
    and success=true
  order by finished_at desc
  limit 3
), agg as (
  select count(*)::int as runs,
         coalesce(min(fetched_count),0)::int as min_fetched,
         coalesce(min(coverage_ratio),0) as min_coverage,
         coalesce(bool_and(snapshot_valid),false) as all_valid,
         max(finished_at) as last_finished_at
  from recent
)
select jsonb_build_object(
  'ready', runs=3 and min_fetched>=3000 and min_coverage>=0.90 and all_valid,
  'runs', runs,
  'min_fetched', min_fetched,
  'min_coverage', min_coverage,
  'all_valid', all_valid,
  'last_finished_at', last_finished_at
) from agg;
$$;
revoke all on function public.kleinanzeigen_public_inventory_acceptance() from public, anon, authenticated;
grant execute on function public.kleinanzeigen_public_inventory_acceptance() to service_role;
