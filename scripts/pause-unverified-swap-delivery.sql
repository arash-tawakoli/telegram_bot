-- Incident containment applied 2026-09-08 after the repaired parser exposed old inventory.
-- Follow-up containment: align scheduler and delivery state; source 21 stays disabled/shadow.
-- Do not restore live until publication freshness has independent evidence and tests.
begin;
update public.sources set enabled=false,runtime_mode='shadow',delivery_mode='shadow' where id=21
  and (enabled or runtime_mode<>'shadow' or delivery_mode<>'shadow');
update public.delivery_events d
set status='skipped',next_retry_at=null,
    error_message='Catalog coverage repair: publication freshness unverified; delivery paused'
from public.listings l
where l.id=d.listing_id and l.source_id=21
  and d.status in ('pending','failed') and not d.delivery_outcome_unknown;
commit;
