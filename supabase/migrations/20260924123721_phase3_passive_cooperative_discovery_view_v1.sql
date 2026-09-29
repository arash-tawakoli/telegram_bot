
create or replace view app_private.cooperative_passive_discoveries as
select
  r.provider_entity,
  r.aliases,
  l.id as listing_id,
  l.source_id as portal_source_id,
  l.title,
  l.address,
  l.postal_code,
  l.city,
  l.canonical_url,
  l.first_seen_at,
  l.last_seen_at,
  l.is_active,
  l.fresh_delivery_eligible,
  l.raw->>'provider_object_ref' as provider_object_ref,
  l.raw->>'applicationLink' as application_link,
  l.raw->>'portal_enrichment_pending' as enrichment_pending
from public.cooperative_provider_registry r
join public.listings l
  on l.source_id in (1,3)
 and l.raw->>'provider_entity'=r.provider_entity
where r.active=true
  and r.registry_mode='passive';

comment on view app_private.cooperative_passive_discoveries is
'Read-only monitor for passive cooperative providers discovered by the existing global ImmoScout/Immowelt lanes.';
