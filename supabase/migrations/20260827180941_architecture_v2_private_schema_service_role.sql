revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to service_role;

revoke execute on all functions in schema app_private from public, anon, authenticated;
grant execute on all functions in schema app_private to service_role;

alter default privileges in schema app_private revoke execute on functions from public, anon, authenticated;
alter default privileges in schema app_private grant execute on functions to service_role;
