update public.sources set tier='K1', poll_interval_minutes=5, updated_at=now() where id=25;
update public.sources set tier='K3', poll_interval_minutes=30, updated_at=now() where id=61;

-- Keep the user-authored K1/K2/K3 classification independent from runtime health.
alter table public.sources drop constraint if exists sources_runtime_mode_check;
alter table public.sources add constraint sources_runtime_mode_check check (runtime_mode in ('live','shadow'));
alter table public.sources drop constraint if exists sources_coverage_status_check;
alter table public.sources add constraint sources_coverage_status_check check (coverage_status in ('unknown','partial','complete','degraded'));
