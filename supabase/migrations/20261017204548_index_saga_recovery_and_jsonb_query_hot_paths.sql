CREATE INDEX IF NOT EXISTS listings_raw_path_gin_idx
  ON public.listings USING gin (raw jsonb_path_ops);

CREATE INDEX IF NOT EXISTS listings_saga_recovery_candidates_idx
  ON public.listings (first_seen_at DESC, id)
  WHERE source_id IN (1, 3)
    AND is_active IS TRUE
    AND coalesce(is_primary_listing, false) IS TRUE
    AND coalesce(quality_status, 'unchecked') <> 'rejected'
    AND raw->>'provider_entity' = 'SAGA';

CREATE INDEX IF NOT EXISTS delivery_events_sent_recipient_listing_idx
  ON public.delivery_events (recipient_user_id, listing_id)
  WHERE status = 'sent' AND recipient_user_id IS NOT NULL;