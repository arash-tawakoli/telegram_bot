create index if not exists canonical_listings_preferred_occurrence_idx on public.canonical_listings(preferred_occurrence_id) where preferred_occurrence_id is not null;
create index if not exists listing_occurrences_connector_idx on public.listing_occurrences(connector_id) where connector_id is not null;
create index if not exists matches_legacy_listing_idx on public.matches(listing_id);
create index if not exists notification_outbox_canonical_idx on public.notification_outbox(canonical_listing_id);
create index if not exists notification_outbox_listing_idx on public.notification_outbox(listing_id);
create index if not exists notification_outbox_match_idx on public.notification_outbox(match_id);
create index if not exists notification_outbox_profile_idx on public.notification_outbox(profile_id);
