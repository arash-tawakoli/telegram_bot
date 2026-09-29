
update public.listings
set fresh_delivery_eligible=false
where source_id=66
  and first_seen_at <= (select baseline_completed_at from public.sources where id=66);

update public.sources
set runtime_mode='live',
    delivery_mode='live',
    coverage_status='complete',
    notes='Direct public Immomio inventory verified in Shadow QA on 2026-09-24; source-worker enforces Hamburg city/ZIP filtering. Baseline inventory suppressed from initial delivery.',
    updated_at=now()
where id=66
  and baseline_completed_at is not null
  and last_success_at is not null
  and last_error_at is null;

update public.sources
set runtime_mode='shadow',
    delivery_mode='shadow',
    coverage_status='partial',
    notes='Shadow only. Official inventory page verified, but Supabase worker currently receives an HTTP/2 transport error. No production delivery until a stable Hamburg-city inventory path is verified.',
    updated_at=now()
where id=67;
