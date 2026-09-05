-- Remove the disabled asynchronous enrichment runtime.
drop trigger if exists listings_queue_enrichment on public.listings;
drop function if exists app_private.enqueue_stale_listing_enrichment(integer) cascade;
drop function if exists app_private.queue_listing_enrichment_id(uuid) cascade;
drop function if exists app_private.queue_listing_enrichment_trigger() cascade;
drop function if exists public.claim_listing_enrichment_jobs(integer) cascade;
drop function if exists public.finish_listing_enrichment_job(uuid,bigint,integer,boolean,text) cascade;
select pgmq.drop_queue('listing_enrichment');
drop table if exists public.listing_enrichment_jobs cascade;

-- Remove old bridge triggers before dropping their tables.
drop trigger if exists delivery_events_sync_outbox on public.delivery_events;
drop trigger if exists notification_outbox_enqueue_delivery on public.notification_outbox;

-- Remove the v2 canonical/outbox bridge. v3 writes directly to delivery_events.
drop function if exists app_private.queue_new_listing_delivery() cascade;
drop function if exists app_private.outbox_enqueue_delivery_event() cascade;
drop function if exists app_private.sync_outbox_from_delivery_event() cascade;
drop function if exists app_private.process_availability_runs(integer) cascade;
drop function if exists app_private.reconcile_occurrence_evidence(integer) cascade;
drop function if exists app_private.sync_listing_architecture_trigger() cascade;
drop function if exists app_private.upsert_listing_architecture(uuid) cascade;
drop function if exists app_private.refresh_canonical_listing(uuid) cascade;
drop table if exists public.notification_outbox cascade;
drop table if exists public.matches cascade;
drop table if exists public.listing_occurrences cascade;
drop table if exists public.canonical_listings cascade;

-- Remove superseded source-specific inventory state. v3 uses source_coverage_state.
drop function if exists public.enqueue_immoscout_inventory_continuation() cascade;
drop table if exists public.immoscout_inventory_members cascade;
drop table if exists public.immoscout_inventory_partitions cascade;
drop table if exists public.immoscout_inventory_runs cascade;
drop table if exists public.source_scan_members cascade;
drop table if exists public.source_scan_state cascade;

-- Remove audit/cache/settings tables that are not on the production path.
drop table if exists public.source_field_capabilities cascade;
drop table if exists public.image_cache cascade;
drop table if exists public.app_settings cascade;

-- Remove obsolete telemetry/legacy-delivery helpers.
drop function if exists app_private.log_immomio_source_success() cascade;
drop function if exists app_private.suppress_generic_source_legacy_delivery() cascade;

-- Fallback images no longer require a function: dispatcher falls back to text.
drop trigger if exists listings_normalize_fallback_logo on public.listings;
drop function if exists app_private.normalize_listing_fallback_logo() cascade;
