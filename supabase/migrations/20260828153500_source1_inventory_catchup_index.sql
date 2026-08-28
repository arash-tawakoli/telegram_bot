create index if not exists immoscout_inventory_runs_catchup_idx
  on public.immoscout_inventory_runs (catchup_of)
  where catchup_of is not null;
