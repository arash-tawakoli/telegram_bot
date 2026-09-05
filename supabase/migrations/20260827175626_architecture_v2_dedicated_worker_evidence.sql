-- Dedicated source-specific workers are live, verified production adapters.
-- Mark evidence independently from their underlying URL-discovery metadata; keep enumerable=false
-- until completeness has been explicitly proven to avoid false availability removals.
update public.source_connectors
set evidence_tier='K1', shadow_only=false
where source_id in (1,2,3) and priority=1;

update public.sources set delivery_mode='live' where id in (1,2,3);
