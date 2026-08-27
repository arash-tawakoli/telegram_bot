-- Dedicated source-specific workers are verified production adapters.
-- Enumerability remains false until completeness is explicitly proven.
update public.source_connectors
set evidence_tier='K1', shadow_only=false
where source_id in (1,2,3) and priority=1;

update public.sources set delivery_mode='live' where id in (1,2,3);
