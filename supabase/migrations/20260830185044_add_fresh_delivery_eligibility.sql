set lock_timeout = '5s';
alter table public.listings
  add column if not exists fresh_delivery_eligible boolean not null default false;
comment on column public.listings.fresh_delivery_eligible is 'True only when the listing was discovered through a source path that is trusted to represent current/new inventory for Telegram delivery.';
