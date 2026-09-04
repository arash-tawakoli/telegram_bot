update public.source_connectors
set config = coalesce(config,'{}'::jsonb) || jsonb_build_object(
  'freshness_mode','newest_first',
  'freshness_policy','new_ids_after_baseline'
)
where source_id in (13,48)
  and priority = 1
  and enabled = true
  and coalesce(shadow_only,false) = false;
