-- Retire unreachable routines whose backing tables were removed previously.
-- No CASCADE: an unexpected live dependency must stop this migration.
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['public.matches','public.source_field_capabilities',
    'public.immoscout_inventory_members','public.immoscout_inventory_partitions',
    'public.immoscout_inventory_runs','public.listing_occurrences',
    'public.source_scan_members','public.source_scan_state']
  LOOP
    IF to_regclass(relation) IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy backing table still exists: %', relation;
    END IF;
  END LOOP;
END $$;
DROP FUNCTION app_private.reconcile_listing_duplicates(uuid);
DROP FUNCTION app_private.refresh_operating_cost_capabilities();
DROP FUNCTION app_private.refresh_source_field_audit_status();
DROP FUNCTION app_private.refresh_source_field_capabilities_v2();
DROP FUNCTION app_private.refresh_source_field_capabilities();
DROP FUNCTION app_private.sync_immoscout_inventory_member_type_from_listing();
DROP FUNCTION public.claim_immoscout_inventory_partitions(uuid,integer);
DROP FUNCTION public.finalize_immoscout_inventory(uuid,integer);
DROP FUNCTION public.finalize_source_scan_cycle(smallint,uuid,integer);
DROP FUNCTION public.prune_immoscout_inventory(integer);
DROP FUNCTION public.start_immoscout_inventory(integer,uuid);
