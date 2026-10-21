-- RECONSTRUCTED EQUIVALENT from the live catalog captured 2026-10-21.
-- Original historical SQL bytes were not recoverable; this migration restores the observed contract.

-- Internal RPCs are server-mediated through service_role; public/authenticated roles must not execute them.
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app_private from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema app_private to service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema app_private revoke execute on functions from public;
