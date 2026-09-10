-- Defense in depth for a server-only Telegram backend. RLS remains deny-by-default.
REVOKE ALL ON TABLE public.source_jobs FROM PUBLIC, anon, authenticated;
ALTER TABLE app_private.coop_provider_index_requests ENABLE ROW LEVEL SECURITY;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

