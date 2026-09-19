alter table public.platform_auth_flows
  drop constraint if exists platform_auth_flows_provider_check;

alter table public.platform_auth_flows
  add constraint platform_auth_flows_provider_check
  check (provider = any (array['immoscout'::text, 'kleinanzeigen'::text, 'immomio'::text]));