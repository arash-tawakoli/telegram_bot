-- Fresh-only feeds are partial by design; Wohnungsswap needs multi-connector traversal.
update public.sources
set coverage_strategy='generic', coverage_status='partial', updated_at=now()
where id in (9,12,22);
