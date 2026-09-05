alter table public.listings
  add column if not exists resolved_image_url text,
  add column if not exists image_source text,
  add column if not exists image_status text not null default 'pending',
  add column if not exists image_last_checked_at timestamptz,
  add column if not exists image_error text,
  add column if not exists enrichment_status text not null default 'pending',
  add column if not exists enrichment_checked_at timestamptz,
  add column if not exists enrichment_error text,
  add column if not exists enrichment_evidence jsonb not null default '{}'::jsonb,
  add column if not exists field_conflicts jsonb not null default '{}'::jsonb,
  add column if not exists enrichment_delivery_eligible boolean not null default false;

alter table public.listings alter column enrichment_delivery_eligible set default true;

do $$ begin
  alter table public.listings add constraint listings_image_status_chk
    check (image_status in ('pending','direct','raw','detail_page','og_image','gallery','fallback','invalid','error'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.listings add constraint listings_enrichment_status_chk
    check (enrichment_status in ('pending','processing','done','retrying','error'));
exception when duplicate_object then null; end $$;

create index if not exists listings_enrichment_status_idx
  on public.listings(enrichment_status, enrichment_checked_at, last_seen_at desc);
create index if not exists listings_image_status_idx
  on public.listings(image_status, image_last_checked_at, last_seen_at desc);

create table if not exists public.listing_enrichment_jobs (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  queue_msg_id bigint unique,
  status text not null default 'queued',
  attempts integer not null default 0,
  error_message text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table public.listing_enrichment_jobs add constraint listing_enrichment_jobs_status_chk
    check (status in ('queued','processing','retrying','done','dead'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.listing_enrichment_jobs add constraint listing_enrichment_jobs_attempts_chk
    check (attempts >= 0);
exception when duplicate_object then null; end $$;

create index if not exists listing_enrichment_jobs_status_idx
  on public.listing_enrichment_jobs(status, queued_at, updated_at);
alter table public.listing_enrichment_jobs enable row level security;
revoke all on public.listing_enrichment_jobs from anon, authenticated;
grant select,insert,update,delete on public.listing_enrichment_jobs to service_role;

create table if not exists public.source_field_capabilities (
  source_id smallint primary key references public.sources(id) on delete cascade,
  audit_status text not null default 'no_sample',
  sample_size integer not null default 0,
  cold_rent_count integer not null default 0,
  cold_rent_coverage numeric(7,4) not null default 0,
  cold_rent_hint_count integer not null default 0,
  cold_rent_conflict_count integer not null default 0,
  warm_rent_count integer not null default 0,
  warm_rent_coverage numeric(7,4) not null default 0,
  warm_rent_hint_count integer not null default 0,
  warm_rent_conflict_count integer not null default 0,
  heating_costs_count integer not null default 0,
  heating_costs_coverage numeric(7,4) not null default 0,
  heating_costs_hint_count integer not null default 0,
  heating_costs_conflict_count integer not null default 0,
  additional_costs_count integer not null default 0,
  additional_costs_coverage numeric(7,4) not null default 0,
  additional_costs_hint_count integer not null default 0,
  additional_costs_conflict_count integer not null default 0,
  deposit_count integer not null default 0,
  deposit_coverage numeric(7,4) not null default 0,
  deposit_hint_count integer not null default 0,
  deposit_conflict_count integer not null default 0,
  area_sqm_count integer not null default 0,
  area_sqm_coverage numeric(7,4) not null default 0,
  area_sqm_hint_count integer not null default 0,
  area_sqm_conflict_count integer not null default 0,
  rooms_count integer not null default 0,
  rooms_coverage numeric(7,4) not null default 0,
  rooms_hint_count integer not null default 0,
  rooms_conflict_count integer not null default 0,
  direct_image_count integer not null default 0,
  resolved_image_count integer not null default 0,
  fallback_image_count integer not null default 0,
  image_coverage numeric(7,4) not null default 0,
  image_hint_count integer not null default 0,
  observed_fields jsonb not null default '{}'::jsonb,
  potential_fields jsonb not null default '{}'::jsonb,
  last_listing_at timestamptz,
  last_audited_at timestamptz not null default now()
);
alter table public.source_field_capabilities enable row level security;
revoke all on public.source_field_capabilities from anon, authenticated;
grant select,insert,update,delete on public.source_field_capabilities to service_role;

insert into public.source_field_capabilities(source_id)
select id from public.sources
on conflict (source_id) do nothing;

do $$ begin
  if not exists (select 1 from pgmq.list_queues() where queue_name='listing_enrichment') then
    perform pgmq.create('listing_enrichment');
  end if;
end $$;
