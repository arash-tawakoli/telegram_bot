-- The coach-api uses the server-only service_role client to prepare member deletion.
-- Keep the private token table inaccessible to public API roles while allowing that
-- controlled deletion path to invalidate outstanding links.
grant select, update on table app_private.telegram_link_tokens to service_role;
