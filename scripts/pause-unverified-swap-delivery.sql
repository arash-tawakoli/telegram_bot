-- Incident containment applied 2026-09-08 after the repaired parser exposed old inventory.
-- Previous source 21 delivery_mode: live. Crawling remains enabled.
-- Do not restore live until publication freshness has independent evidence and tests.
begin;
update public.sources set delivery_mode='shadow' where id=21 and delivery_mode='live';
update public.delivery_events d
set status='skipped',next_retry_at=null,
    error_message='Catalog coverage repair: publication freshness unverified; delivery paused'
from public.listings l
where l.id=d.listing_id and l.source_id=21
  and d.status in ('pending','failed') and not d.delivery_outcome_unknown;
commit;
