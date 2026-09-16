alter table public.platform_auth_flows
  alter column expires_at set default (now() + interval '30 minutes');
