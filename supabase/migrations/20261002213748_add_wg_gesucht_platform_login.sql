-- RECONSTRUCTED EQUIVALENT from the live catalog captured 2026-10-21.
-- Original historical SQL bytes were not recoverable; this migration restores the observed contract.

alter table public.platform_connections
  drop constraint if exists platform_connections_provider_check;
alter table public.platform_connections
  add constraint platform_connections_provider_check
  check (provider = any (array['immoscout','kleinanzeigen','immomio','immowelt','wg_gesucht']::text[]));
