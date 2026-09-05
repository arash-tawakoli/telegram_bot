alter table public.sources
  drop constraint if exists sources_poll_interval_minutes_check;

alter table public.sources
  add constraint sources_poll_interval_minutes_check
  check (poll_interval_minutes >= 1);
