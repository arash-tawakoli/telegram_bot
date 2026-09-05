alter table public.delivery_events add column delivery_outcome_unknown boolean not null default false;
create index delivery_events_unknown_idx on public.delivery_events(created_at) where delivery_outcome_unknown;
