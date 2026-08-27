create unique index if not exists source_jobs_one_active_per_source_uidx
on public.source_jobs(source_id)
where status in ('enqueued','processing','retry');

alter table public.source_connectors drop constraint if exists source_connectors_evidence_tier_check;
alter table public.source_connectors add constraint source_connectors_evidence_tier_check check (evidence_tier in ('K1','K2','K3'));
alter table public.source_connectors drop constraint if exists source_connectors_connector_role_check;
alter table public.source_connectors add constraint source_connectors_connector_role_check check (connector_role in ('primary','fallback','enrichment','monitoring'));

alter table public.sources drop constraint if exists sources_delivery_mode_check;
alter table public.sources add constraint sources_delivery_mode_check check (delivery_mode in ('live','shadow'));

alter table public.listing_occurrences drop constraint if exists listing_occurrences_evidence_tier_check;
alter table public.listing_occurrences add constraint listing_occurrences_evidence_tier_check check (evidence_tier in ('K1','K2','K3'));
alter table public.listing_occurrences drop constraint if exists listing_occurrences_miss_count_check;
alter table public.listing_occurrences add constraint listing_occurrences_miss_count_check check (miss_count >= 0);

alter table public.matches drop constraint if exists matches_status_check;
alter table public.matches add constraint matches_status_check check (status in ('matched','suppressed'));

alter table public.notification_outbox drop constraint if exists notification_outbox_status_check;
alter table public.notification_outbox add constraint notification_outbox_status_check check (status in ('pending','queued','processing','sent','failed','skipped'));
alter table public.notification_outbox drop constraint if exists notification_outbox_attempts_check;
alter table public.notification_outbox add constraint notification_outbox_attempts_check check (attempts >= 0);

alter table public.source_jobs drop constraint if exists source_jobs_status_check;
alter table public.source_jobs add constraint source_jobs_status_check check (status in ('enqueued','processing','retry','done','dead'));
alter table public.source_jobs drop constraint if exists source_jobs_attempts_check;
alter table public.source_jobs add constraint source_jobs_attempts_check check (attempts >= 0);
