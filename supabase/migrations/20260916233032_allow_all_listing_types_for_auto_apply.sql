create or replace function app_private.application_listing_auto_apply_allowed(
  p_title text,
  p_property_type text,
  p_raw jsonb
)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select true
$$;
