alter table public.saved_listings
  drop column if exists note,
  drop column if exists status;
