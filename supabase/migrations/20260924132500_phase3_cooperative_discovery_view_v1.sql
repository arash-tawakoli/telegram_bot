
create or replace view app_private.cooperative_discovery_candidates as
select
  l.id as listing_id,
  l.source_id,
  s.name as portal_source,
  l.source_listing_key,
  l.title,
  l.address,
  l.postal_code,
  l.canonical_url,
  l.first_seen_at,
  l.last_seen_at,
  l.is_active,
  l.fresh_delivery_eligible,
  l.raw->>'cooperative_candidate_text' as candidate_text
from public.listings l
join public.sources s on s.id=l.source_id
where l.raw->>'cooperative_candidate'='true'
  and nullif(l.raw->>'provider_entity','') is null;
