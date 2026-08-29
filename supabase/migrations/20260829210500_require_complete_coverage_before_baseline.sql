-- Prevent partial first scans from enabling Telegram delivery.
-- Keep an existing baseline only when the generic coverage state proves that
-- the source completed at least one full cycle.
update public.sources s
set baseline_completed_at=null, updated_at=now()
where s.baseline_completed_at is not null
  and not exists (
    select 1 from public.source_coverage_state cs
    where cs.source_id=s.id and cs.last_complete_at is not null
  )
  and s.coverage_status is distinct from 'complete';
